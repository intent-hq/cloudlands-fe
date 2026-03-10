#!/bin/bash
#
# Upload Release to GCS/Cloud CDN
#
# This script uploads the built Electron app to a GCS bucket for auto-updates.
# It uses gcloud CLI to upload files and invalidate the Cloud CDN cache.
#
# Required IAM Permissions (custom role 'releaseUploader'):
#   - storage.objects.create       - Upload files to GCS
#   - storage.objects.delete       - Overwrite existing files
#   - storage.objects.list         - List bucket contents
#   - compute.urlMaps.invalidateCache - Invalidate Cloud CDN cache
#
# Required Environment Variables:
#   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON key file
#   GCS_BUCKET                     - GCS bucket name (e.g., intent-updates)
#   GCP_PROJECT                    - GCP project ID
#   CLOUD_CDN_URL_MAP              - URL map name for Cloud CDN cache invalidation
#
# Usage:
#   ./scripts/upload-release-gcp.sh [channel]
#
# Arguments:
#   channel - Update channel: stable, beta, or alpha (default: stable)
#
# Example:
#   GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json \
#   GCS_BUCKET=intent-updates \
#   GCP_PROJECT=my-project \
#   CLOUD_CDN_URL_MAP=cdn-lb \
#   ./scripts/upload-release-gcp.sh stable
#

set -e

# Configuration
# Use RELEASE_VERSION env var if set, otherwise read from package.json
VERSION=${RELEASE_VERSION:-$(node -p "require('./package.json').version")}
CHANNEL=${1:-stable}

# Validate required environment variables
if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "❌ Error: GOOGLE_APPLICATION_CREDENTIALS environment variable is required"
  echo "   Set it to the path of your service account JSON key file"
  echo "   e.g., GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json"
  exit 1
fi

if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "❌ Error: Service account key file not found: $GOOGLE_APPLICATION_CREDENTIALS"
  exit 1
fi

if [ -z "$GCS_BUCKET" ]; then
  echo "❌ Error: GCS_BUCKET environment variable is required"
  echo "   Set it to your GCS bucket name, e.g., GCS_BUCKET=intent-updates"
  exit 1
fi

if [ -z "$GCP_PROJECT" ]; then
  echo "❌ Error: GCP_PROJECT environment variable is required"
  echo "   Set it to your GCP project ID, e.g., GCP_PROJECT=my-project-123"
  exit 1
fi

if [ -z "$CLOUD_CDN_URL_MAP" ]; then
  echo "❌ Error: CLOUD_CDN_URL_MAP environment variable is required"
  echo "   Set it to your Cloud CDN URL map name"
  exit 1
fi

# Validate channel
if [[ ! "$CHANNEL" =~ ^(stable|beta|alpha)$ ]]; then
  echo "❌ Error: Invalid channel '$CHANNEL'. Must be stable, beta, or alpha"
  exit 1
fi

echo "📦 Uploading Intent by Augment v$VERSION to $CHANNEL channel..."
echo "   GCS Bucket: $GCS_BUCKET"
echo "   Project: $GCP_PROJECT"
echo "   CDN URL Map: $CLOUD_CDN_URL_MAP"
echo ""

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
  echo "❌ Error: gcloud CLI is not installed"
  echo "   Install it from: https://cloud.google.com/sdk/docs/install"
  echo "   Or with: brew install --cask google-cloud-sdk"
  exit 1
fi

# Authenticate with service account
echo "🔐 Authenticating with service account..."
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --project="$GCP_PROJECT" --quiet
echo "   ✓ Authenticated"

# Check if build files exist
DIST_DIR="dist-electron"
if [ ! -d "$DIST_DIR" ]; then
  echo "❌ Error: Build directory '$DIST_DIR' not found"
  echo "   Run 'pnpm run dist:mac' first to build the app"
  exit 1
fi

# Helper function to upload a file to GCS
upload_file() {
  local source_file="$1"
  local dest_path="$2"
  local content_type="$3"

  gcloud storage cp "$source_file" "gs://$GCS_BUCKET/$dest_path" \
    --content-type="$content_type" \
    --quiet
}

# Upload update manifests
echo "📤 Uploading update manifests..."

if [ -f "$DIST_DIR/latest-mac.yml" ]; then
  upload_file "$DIST_DIR/latest-mac.yml" "$CHANNEL/latest-mac.yml" "application/x-yaml"
  echo "   ✓ latest-mac.yml"
fi

# Upload ZIP files for current version only (required for auto-update)
echo "📤 Uploading ZIP files for v$VERSION..."

for zip_file in "$DIST_DIR"/*"$VERSION"*.zip; do
  if [ -f "$zip_file" ]; then
    filename=$(basename "$zip_file")
    upload_file "$zip_file" "$CHANNEL/$filename" "application/zip"
    echo "   ✓ $filename"
  fi
done

# Upload blockmap files for current version (retained for differential updates)
# Blockmaps are NOT overwritten - each version keeps its own blockmap on the server.
# This enables users on any previous version to do differential downloads to the latest.
echo "📤 Uploading blockmap files for v$VERSION..."

for blockmap_file in "$DIST_DIR"/*"$VERSION"*.blockmap; do
  if [ -f "$blockmap_file" ]; then
    filename=$(basename "$blockmap_file")
    upload_file "$blockmap_file" "$CHANNEL/$filename" "application/octet-stream"
    echo "   ✓ $filename"
  fi
done

# Upload DMG files for current version only (optional, for website downloads)
echo "📤 Uploading DMG files for v$VERSION..."

for dmg_file in "$DIST_DIR"/*"$VERSION"*.dmg; do
  if [ -f "$dmg_file" ]; then
    filename=$(basename "$dmg_file")
    upload_file "$dmg_file" "$CHANNEL/$filename" "application/x-apple-diskimage"
    echo "   ✓ $filename"
  fi
done

# Upload DMGs with fixed "latest" names for stable website links
echo "📤 Uploading 'latest' DMG links..."

# Upload the current version's arm64 DMG as Intent-latest-arm64.dmg
ARM64_DMG="$DIST_DIR/Intent by Augment-${VERSION}-arm64.dmg"
if [ -f "$ARM64_DMG" ]; then
  upload_file "$ARM64_DMG" "$CHANNEL/Intent-latest-arm64.dmg" "application/x-apple-diskimage"
  echo "   ✓ Intent-latest-arm64.dmg (→ $(basename "$ARM64_DMG"))"
else
  echo "   ⚠ arm64 DMG not found: $ARM64_DMG"
fi

# Upload release notes (if exists)
RELEASE_NOTES="$DIST_DIR/release-notes.json"
if [ -f "$RELEASE_NOTES" ]; then
  echo "📤 Uploading release notes..."
  upload_file "$RELEASE_NOTES" "$CHANNEL/release-notes.json" "application/json"
  echo "   ✓ release-notes.json"

  # Also upload versioned release notes for history
  upload_file "$RELEASE_NOTES" "$CHANNEL/release-notes-${VERSION}.json" "application/json"
  echo "   ✓ release-notes-${VERSION}.json"
else
  echo "⚠️  Release notes not found. Run 'pnpm run generate:release-notes' first."
fi

# Invalidate Cloud CDN cache
echo "🔄 Invalidating Cloud CDN cache..."
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/$CHANNEL/*" \
  --project="$GCP_PROJECT" \
  --quiet
echo "   ✓ Cache invalidation requested for /$CHANNEL/*"

echo ""
echo "✅ Release v$VERSION uploaded to $CHANNEL channel successfully!"
echo ""
echo "📋 Uploaded files:"
gcloud storage ls "gs://$GCS_BUCKET/$CHANNEL/" 2>/dev/null | grep -E "\.(yml|zip|dmg|blockmap)$" || true

echo ""
echo "🌐 CDN URLs:"
echo "   https://cdn.augmentcode.com/$CHANNEL/latest-mac.yml"
echo "   https://cdn.augmentcode.com/$CHANNEL/Intent-latest-arm64.dmg"
