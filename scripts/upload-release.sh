#!/bin/bash
#
# Upload Release to Both GCP and AWS (Migration Script)
#
# This script uploads the built Electron app to BOTH GCP (primary) and AWS (legacy).
# Files are uploaded to GCP, and AWS manifests are rewritten to use absolute GCP URLs.
# This enables gradual migration of users from AWS to GCP.
#
# Migration Strategy:
#   - Files (ZIP, DMG) are uploaded to GCP only (primary source)
#   - Manifests (latest-mac.yml) are uploaded to BOTH with absolute GCP URLs
#   - Existing users checking AWS will download from GCP
#   - New users (with updated app) will check GCP directly
#
# Required Environment Variables:
#   # GCP (required)
#   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON key file
#   GCS_BUCKET                     - GCS bucket name (e.g., intent-updates)
#   GCP_PROJECT                    - GCP project ID
#   CLOUD_CDN_URL_MAP              - URL map name for Cloud CDN cache invalidation
#
#   # AWS (required for migration period)
#   AWS_ACCESS_KEY_ID              - AWS access key
#   AWS_SECRET_ACCESS_KEY          - AWS secret key
#   AWS_REGION                     - AWS region
#   S3_BUCKET                      - S3 bucket name
#   CLOUDFRONT_DISTRIBUTION_ID     - CloudFront distribution ID (optional)
#
# Usage:
#   ./scripts/upload-release.sh [channel]
#
# Arguments:
#   channel - Update channel: stable, beta, or alpha (default: stable)
#

set -e

# Configuration
# Use RELEASE_VERSION env var if set, otherwise read from package.json
VERSION=${RELEASE_VERSION:-$(node -p "require('./package.json').version")}
CHANNEL=${1:-stable}
GCP_CDN_BASE_URL="https://cdn.augmentcode.com"

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

# Validate AWS environment variables (required for migration)
AWS_ENABLED=true
if [ -z "$AWS_REGION" ] || [ -z "$S3_BUCKET" ]; then
  echo "⚠️  Warning: AWS environment variables not set, skipping AWS upload"
  echo "   Set AWS_REGION and S3_BUCKET to enable AWS migration uploads"
  AWS_ENABLED=false
fi

# Check if AWS CLI is installed (if AWS is enabled)
if [ "$AWS_ENABLED" = true ]; then
  if ! command -v aws &> /dev/null; then
    echo "⚠️  Warning: AWS CLI is not installed, skipping AWS upload"
    AWS_ENABLED=false
  fi
fi

echo "📦 Uploading Intent by Augment v$VERSION to $CHANNEL channel..."
echo "   Strategy: GCP (primary) + AWS manifests (migration)"
echo "   GCS Bucket: $GCS_BUCKET"
echo "   GCP Project: $GCP_PROJECT"
if [ "$AWS_ENABLED" = true ]; then
  echo "   S3 Bucket: $S3_BUCKET (migration manifests only)"
fi
echo ""

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
  echo "❌ Error: gcloud CLI is not installed"
  echo "   Install it from: https://cloud.google.com/sdk/docs/install"
  echo "   Or with: brew install --cask google-cloud-sdk"
  exit 1
fi

# Authenticate with GCP service account
echo "🔐 Authenticating with GCP..."
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --project="$GCP_PROJECT" --quiet
echo "   ✓ GCP authenticated"

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

# Helper function to URL-encode spaces in manifest filenames
# electron-updater requires URL-encoded filenames in the manifest
url_encode_manifest() {
  local input_file="$1"
  local output_file="$2"

  # URL-encode spaces in url: and path: lines (spaces -> %20)
  sed 's/\(url: \)\(.*\)/\1\2/; s/\(url: [^ ]*\) /\1%20/g; s/\(url: [^ ]*\) /\1%20/g; s/\(url: [^ ]*\) /\1%20/g' "$input_file" | \
  sed 's/\(path: \)\(.*\)/\1\2/; s/\(path: [^ ]*\) /\1%20/g; s/\(path: [^ ]*\) /\1%20/g; s/\(path: [^ ]*\) /\1%20/g' > "$output_file"
}

# Create temp directory for modified manifests
MANIFEST_TEMP_DIR=$(mktemp -d)
trap "rm -rf $MANIFEST_TEMP_DIR" EXIT

# Upload update manifests (with URL-encoded filenames)
echo "📤 Uploading update manifests..."

if [ -f "$DIST_DIR/latest-mac.yml" ]; then
  url_encode_manifest "$DIST_DIR/latest-mac.yml" "$MANIFEST_TEMP_DIR/latest-mac.yml"
  upload_file "$MANIFEST_TEMP_DIR/latest-mac.yml" "$CHANNEL/latest-mac.yml" "application/x-yaml"
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
echo "🔄 Invalidating GCP Cloud CDN cache..."
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/$CHANNEL/*" \
  --project="$GCP_PROJECT" \
  --quiet
echo "   ✓ GCP cache invalidation requested for /$CHANNEL/*"

echo ""
echo "✅ GCP upload complete!"

# ============================================================================
# STEP 2: Upload manifests to AWS with absolute GCP URLs (migration)
# ============================================================================
if [ "$AWS_ENABLED" = true ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📤 STEP 2: Uploading manifests to AWS (migration)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   Rewriting manifest URLs to point to GCP CDN..."
  echo ""

  # Create temp directory for modified manifests
  AWS_TEMP_DIR=$(mktemp -d)
  trap "rm -rf $AWS_TEMP_DIR" EXIT

  # Function to rewrite manifest URLs to use absolute GCP CDN URLs with URL encoding
  rewrite_manifest_urls_for_aws() {
    local input_file="$1"
    local output_file="$2"

    # Step 1: Add the GCP CDN base URL prefix to url: and path: lines
    # Step 2: URL-encode spaces in filenames (spaces -> %20)
    # The manifest has lines like: url: Intent by Augment-0.1.0-arm64.zip
    # We need: url: https://cdn.augmentcode.com/stable/Intent%20by%20Augment-0.1.0-arm64.zip
    sed "s|^url: |url: ${GCP_CDN_BASE_URL}/${CHANNEL}/|g" "$input_file" | \
    sed "s|^  url: |  url: ${GCP_CDN_BASE_URL}/${CHANNEL}/|g" | \
    sed "s|^path: |path: ${GCP_CDN_BASE_URL}/${CHANNEL}/|g" | \
    sed 's/\(url: [^ ]*\) /\1%20/g' | \
    sed 's/\(url: [^ ]*\) /\1%20/g' | \
    sed 's/\(url: [^ ]*\) /\1%20/g' | \
    sed 's/\(url: [^ ]*\) /\1%20/g' | \
    sed 's/\(path: [^ ]*\) /\1%20/g' | \
    sed 's/\(path: [^ ]*\) /\1%20/g' | \
    sed 's/\(path: [^ ]*\) /\1%20/g' | \
    sed 's/\(path: [^ ]*\) /\1%20/g' > "$output_file"
  }

  # Rewrite and upload latest-mac.yml
  if [ -f "$DIST_DIR/latest-mac.yml" ]; then
    rewrite_manifest_urls_for_aws "$DIST_DIR/latest-mac.yml" "$AWS_TEMP_DIR/latest-mac.yml"
    aws s3 cp "$AWS_TEMP_DIR/latest-mac.yml" "s3://$S3_BUCKET/$CHANNEL/latest-mac.yml" \
      --content-type "application/x-yaml" \
      --region "$AWS_REGION"
    echo "   ✓ latest-mac.yml (with GCP URLs)"
  fi

  # Invalidate CloudFront cache (if configured)
  if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
    echo "🔄 Invalidating CloudFront cache..."
    aws cloudfront create-invalidation \
      --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "/$CHANNEL/*" \
      --region "$AWS_REGION" \
      --output text > /dev/null
    echo "   ✓ CloudFront cache invalidation requested for /$CHANNEL/*"
  fi

  echo ""
  echo "✅ AWS migration manifests uploaded!"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Release v$VERSION uploaded to $CHANNEL channel successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 GCP files:"
gcloud storage ls "gs://$GCS_BUCKET/$CHANNEL/" 2>/dev/null | grep -E "\.(yml|zip|dmg|blockmap)$" || true

echo ""
echo "🌐 CDN URLs (primary):"
echo "   https://cdn.augmentcode.com/$CHANNEL/latest-mac.yml"
echo "   https://cdn.augmentcode.com/$CHANNEL/Intent-latest-arm64.dmg"

if [ "$AWS_ENABLED" = true ]; then
  echo ""
  echo "🔄 Migration status:"
  echo "   AWS manifests now redirect downloads to GCP CDN"
  echo "   Users on old versions will download from GCP"
  echo "   Users on new versions check GCP directly"
fi
