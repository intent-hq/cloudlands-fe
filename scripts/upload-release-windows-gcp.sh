#!/bin/bash
#
# Upload Windows Release to GCS/Cloud CDN
#
# This script uploads the built Windows Electron app to a GCS bucket for auto-updates.
# It uses gcloud CLI to upload files and invalidate the Cloud CDN cache.
#
# Required Environment Variables:
#   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON key file
#   GCS_BUCKET                     - GCS bucket name (e.g., intent-updates)
#   GCP_PROJECT                    - GCP project ID
#   CLOUD_CDN_URL_MAP              - URL map name for Cloud CDN cache invalidation
#
# Usage:
#   ./scripts/upload-release-windows-gcp.sh [channel]
#
# Arguments:
#   channel - Update channel: stable, beta, or alpha (default: stable)
#

set -euo pipefail

# Configuration
VERSION=${RELEASE_VERSION:-$(node -p "require('./package.json').version")}
CHANNEL=${1:-stable}
DIST_DIR="${DIST_DIR:-dist-electron}"

# Validate required environment variables
for var in GOOGLE_APPLICATION_CREDENTIALS GCS_BUCKET GCP_PROJECT CLOUD_CDN_URL_MAP; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Error: $var environment variable is required"
    exit 1
  fi
done

if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "❌ Error: Service account key file not found: $GOOGLE_APPLICATION_CREDENTIALS"
  exit 1
fi

# Validate channel
if [[ ! "$CHANNEL" =~ ^(stable|beta|alpha)$ ]]; then
  echo "❌ Error: Invalid channel '$CHANNEL'. Must be stable, beta, or alpha"
  exit 1
fi

echo "📦 Uploading Intent Windows v$VERSION to $CHANNEL channel..."
echo "   GCS Bucket: $GCS_BUCKET"
echo "   Project: $GCP_PROJECT"
echo ""

# Check gcloud CLI
if ! command -v gcloud &> /dev/null; then
  echo "❌ Error: gcloud CLI is not installed"
  exit 1
fi

# Authenticate with service account
echo "🔐 Authenticating with service account..."
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --project="$GCP_PROJECT" --quiet
echo "   ✓ Authenticated"

if [ ! -d "$DIST_DIR" ]; then
  echo "❌ Error: Build directory '$DIST_DIR' not found"
  echo "   Run 'npm run dist:win' first to build the app"
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

# Helper function to URL-encode spaces in manifest filenames
# electron-updater requires URL-encoded filenames in the manifest
url_encode_manifest() {
  local input_file="$1"
  local output_file="$2"

  # URL-encode spaces in url: and path: lines (spaces -> %20)
  # Use a loop to handle any number of spaces in filenames
  sed -e ':loop' -e 's/\(url: [^ ]*\) /\1%20/' -e 't loop' "$input_file" | \
  sed -e ':loop' -e 's/\(path: [^ ]*\) /\1%20/' -e 't loop' > "$output_file"
}

# Create temp directory for modified manifests
MANIFEST_TEMP_DIR=$(mktemp -d)
trap "rm -rf $MANIFEST_TEMP_DIR" EXIT

# Upload update manifest (with URL-encoded filenames)
echo "📤 Uploading update manifest..."

if [ -f "$DIST_DIR/latest.yml" ]; then
  url_encode_manifest "$DIST_DIR/latest.yml" "$MANIFEST_TEMP_DIR/latest.yml"
  upload_file "$MANIFEST_TEMP_DIR/latest.yml" "$CHANNEL/latest.yml" "application/x-yaml"
  echo "   ✓ latest.yml"
fi

# Upload EXE files for current version (Windows NSIS installers)
echo "📤 Uploading EXE files for v$VERSION..."

for exe_file in "$DIST_DIR"/*"$VERSION"*.exe; do
  if [ -f "$exe_file" ]; then
    filename=$(basename "$exe_file")
    upload_file "$exe_file" "$CHANNEL/$filename" "application/x-msdownload"
    echo "   ✓ $filename"
  fi
done

# Upload blockmap files for current version (for differential updates)
echo "📤 Uploading blockmap files for v$VERSION..."

for blockmap_file in "$DIST_DIR"/*"$VERSION"*.exe.blockmap; do
  if [ -f "$blockmap_file" ]; then
    filename=$(basename "$blockmap_file")
    upload_file "$blockmap_file" "$CHANNEL/$filename" "application/octet-stream"
    echo "   ✓ $filename"
  fi
done

# Upload EXE with fixed "latest" name for stable website links
echo "📤 Uploading 'latest' EXE link..."

SETUP_EXE="$DIST_DIR/Intent by Augment Setup ${VERSION}.exe"
if [ -f "$SETUP_EXE" ]; then
  upload_file "$SETUP_EXE" "$CHANNEL/Intent-latest-Setup.exe" "application/x-msdownload"
  echo "   ✓ Intent-latest-Setup.exe (→ $(basename "$SETUP_EXE"))"
else
  echo "   ⚠ Setup EXE not found: $SETUP_EXE"
fi

# Invalidate Cloud CDN cache
echo "🔄 Invalidating Cloud CDN cache..."
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/$CHANNEL/*" \
  --project="$GCP_PROJECT" \
  --quiet
echo "   ✓ Cache invalidation requested for /$CHANNEL/*"

echo ""
echo "✅ Windows release v$VERSION uploaded to $CHANNEL channel successfully!"
echo ""
echo "🌐 CDN URLs:"
echo "   https://cdn.augmentcode.com/$CHANNEL/latest.yml"
echo "   https://cdn.augmentcode.com/$CHANNEL/Intent-latest-Setup.exe"

