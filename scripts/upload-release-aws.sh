#!/bin/bash
#
# Upload Release to S3/CloudFront
#
# This script uploads the built Electron app to an S3 bucket for auto-updates.
# It uses AWS CLI to upload files and invalidate the CloudFront cache.
#
# Required Environment Variables:
#   AWS_ACCESS_KEY_ID       - AWS access key
#   AWS_SECRET_ACCESS_KEY   - AWS secret key
#   AWS_REGION              - AWS region (default: us-east-1)
#   S3_BUCKET               - S3 bucket name (e.g., intent-updates)
#   CLOUDFRONT_DISTRIBUTION_ID - CloudFront distribution ID for cache invalidation
#
# Usage:
#   ./scripts/upload-release.sh [channel]
#
# Arguments:
#   channel - Update channel: stable, beta, or alpha (default: stable)
#
# Example:
#   # Upload to stable channel
#   S3_BUCKET=my-updates-bucket CLOUDFRONT_DISTRIBUTION_ID=E1234567890 ./scripts/upload-release.sh
#
#   # Upload to beta channel
#   S3_BUCKET=my-updates-bucket CLOUDFRONT_DISTRIBUTION_ID=E1234567890 ./scripts/upload-release.sh beta
#

set -e

# Configuration
VERSION=$(node -p "require('./package.json').version")
CHANNEL=${1:-stable}
AWS_REGION=${AWS_REGION}

# Validate required environment variables
if [ -z "$AWS_REGION" ]; then
  echo "❌ Error: AWS_REGION environment variable is required"
  echo "   Set it to your S3 bucket name, e.g., AWS_REGION=us-west-2"
  exit 1
fi

if [ -z "$S3_BUCKET" ]; then
  echo "❌ Error: S3_BUCKET environment variable is required"
  echo "   Set it to your S3 bucket name, e.g., S3_BUCKET=intent-updates"
  exit 1
fi

if [ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  echo "⚠️  Warning: CLOUDFRONT_DISTRIBUTION_ID not set, skipping cache invalidation"
fi

# Validate channel
if [[ ! "$CHANNEL" =~ ^(stable|beta|alpha)$ ]]; then
  echo "❌ Error: Invalid channel '$CHANNEL'. Must be stable, beta, or alpha"
  exit 1
fi

echo "📦 Uploading Intent by Augment v$VERSION to $CHANNEL channel..."
echo "   S3 Bucket: $S3_BUCKET"
echo "   Region: $AWS_REGION"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "❌ Error: AWS CLI is not installed"
  echo "   Install it with: brew install awscli"
  exit 1
fi

# Check if build files exist
DIST_DIR="dist-electron"
if [ ! -d "$DIST_DIR" ]; then
  echo "❌ Error: Build directory '$DIST_DIR' not found"
  echo "   Run 'pnpm run dist:mac' first to build the app"
  exit 1
fi

# Upload update manifests
echo "📤 Uploading update manifests..."

if [ -f "$DIST_DIR/latest-mac.yml" ]; then
  aws s3 cp "$DIST_DIR/latest-mac.yml" "s3://$S3_BUCKET/$CHANNEL/latest-mac.yml" \
    --content-type "application/x-yaml" \
    --region "$AWS_REGION"
  echo "   ✓ latest-mac.yml"
fi

# Upload ZIP files for current version only (required for auto-update)
echo "📤 Uploading ZIP files for v$VERSION..."

for zip_file in "$DIST_DIR"/*"$VERSION"*.zip; do
  if [ -f "$zip_file" ]; then
    filename=$(basename "$zip_file")
    aws s3 cp "$zip_file" "s3://$S3_BUCKET/$CHANNEL/$filename" \
      --content-type "application/zip" \
      --region "$AWS_REGION"
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
    aws s3 cp "$blockmap_file" "s3://$S3_BUCKET/$CHANNEL/$filename" \
      --content-type "application/octet-stream" \
      --region "$AWS_REGION"
    echo "   ✓ $filename"
  fi
done

# Upload DMG files for current version only (optional, for website downloads)
echo "📤 Uploading DMG files for v$VERSION..."

for dmg_file in "$DIST_DIR"/*"$VERSION"*.dmg; do
  if [ -f "$dmg_file" ]; then
    filename=$(basename "$dmg_file")
    aws s3 cp "$dmg_file" "s3://$S3_BUCKET/$CHANNEL/$filename" \
      --content-type "application/x-apple-diskimage" \
      --region "$AWS_REGION"
    echo "   ✓ $filename"
  fi
done

# Upload DMGs with fixed "latest" names for stable website links
echo "📤 Uploading 'latest' DMG links..."

# Upload the current version's arm64 DMG as Intent-latest-arm64.dmg
ARM64_DMG="$DIST_DIR/Intent by Augment-${VERSION}-arm64.dmg"
if [ -f "$ARM64_DMG" ]; then
  aws s3 cp "$ARM64_DMG" "s3://$S3_BUCKET/$CHANNEL/Intent-latest-arm64.dmg" \
    --content-type "application/x-apple-diskimage" \
    --region "$AWS_REGION"
  echo "   ✓ Intent-latest-arm64.dmg (→ $(basename "$ARM64_DMG"))"
else
  echo "   ⚠ arm64 DMG not found: $ARM64_DMG"
fi

# Upload release notes (if exists)
RELEASE_NOTES="$DIST_DIR/release-notes.json"
if [ -f "$RELEASE_NOTES" ]; then
  echo "📤 Uploading release notes..."
  aws s3 cp "$RELEASE_NOTES" "s3://$S3_BUCKET/$CHANNEL/release-notes.json" \
    --content-type "application/json" \
    --region "$AWS_REGION"
  echo "   ✓ release-notes.json"

  # Also upload versioned release notes for history
  aws s3 cp "$RELEASE_NOTES" "s3://$S3_BUCKET/$CHANNEL/release-notes-${VERSION}.json" \
    --content-type "application/json" \
    --region "$AWS_REGION"
  echo "   ✓ release-notes-${VERSION}.json"
else
  echo "⚠️  Release notes not found. Run 'pnpm run generate:release-notes' first."
fi

# Invalidate CloudFront cache
if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/$CHANNEL/*" \
    --region "$AWS_REGION" \
    --output text > /dev/null
  echo "   ✓ Cache invalidation requested for /$CHANNEL/*"
fi

echo ""
echo "✅ Release v$VERSION uploaded to $CHANNEL channel successfully!"
echo ""
echo "📋 Uploaded files:"
aws s3 ls "s3://$S3_BUCKET/$CHANNEL/" --region "$AWS_REGION" | grep -E "\.(yml|zip|dmg|blockmap)$" || true
