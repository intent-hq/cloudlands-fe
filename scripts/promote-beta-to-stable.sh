#!/bin/bash
#
# Promote Beta Release to Stable Channel
#
# This script copies release artifacts from the beta S3 folder to the stable S3 folder,
# effectively promoting a beta release to stable for all users.
#
# Required Environment Variables:
#   AWS_ACCESS_KEY_ID       - AWS access key
#   AWS_SECRET_ACCESS_KEY   - AWS secret key
#   AWS_REGION              - AWS region (e.g., us-west-2)
#   S3_BUCKET               - S3 bucket name (e.g., intent-downloads)
#   CLOUDFRONT_DISTRIBUTION_ID - CloudFront distribution ID for cache invalidation
#
# Usage:
#   ./scripts/promote-beta-to-stable.sh [version]
#
# Arguments:
#   version - Optional: specific version to promote. If not provided, promotes latest beta.
#
# Example:
#   # Promote current beta to stable
#   ./scripts/promote-beta-to-stable.sh
#
#   # Promote specific version
#   ./scripts/promote-beta-to-stable.sh 1.2.3
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Validate required environment variables
if [ -z "$AWS_REGION" ]; then
  echo -e "${RED}❌ Error: AWS_REGION environment variable is required${NC}"
  exit 1
fi

if [ -z "$S3_BUCKET" ]; then
  echo -e "${RED}❌ Error: S3_BUCKET environment variable is required${NC}"
  exit 1
fi

if [ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  echo -e "${YELLOW}⚠️  Warning: CLOUDFRONT_DISTRIBUTION_ID not set, skipping cache invalidation${NC}"
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo -e "${RED}❌ Error: AWS CLI is not installed${NC}"
  echo "   Install it with: brew install awscli"
  exit 1
fi

# Get version from beta channel
if [ -n "$1" ]; then
  VERSION="$1"
  echo -e "${BLUE}📦 Promoting specified version: v$VERSION${NC}"
else
  # Extract version from beta's latest-mac.yml
  echo -e "${BLUE}📋 Fetching current beta version...${NC}"
  BETA_MANIFEST=$(aws s3 cp "s3://$S3_BUCKET/beta/latest-mac.yml" - --region "$AWS_REGION" 2>/dev/null || true)

  if [ -z "$BETA_MANIFEST" ]; then
    echo -e "${RED}❌ Error: Could not fetch beta manifest. Is there a beta release?${NC}"
    exit 1
  fi

  VERSION=$(echo "$BETA_MANIFEST" | grep "^version:" | sed 's/version: //')

  if [ -z "$VERSION" ]; then
    echo -e "${RED}❌ Error: Could not extract version from beta manifest${NC}"
    exit 1
  fi

  echo -e "${GREEN}   Found beta version: v$VERSION${NC}"
fi

# Show what will be promoted
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Promoting Beta → Stable${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "   Version:    ${GREEN}v$VERSION${NC}"
echo -e "   S3 Bucket:  ${YELLOW}$S3_BUCKET${NC}"
echo -e "   Region:     ${YELLOW}$AWS_REGION${NC}"
echo ""

# List files to be promoted
echo -e "${BLUE}📋 Files to promote from beta/${NC}"
aws s3 ls "s3://$S3_BUCKET/beta/" --region "$AWS_REGION" | grep -E "(\.yml$|$VERSION)" || echo "   (no matching files found)"
echo ""

# Confirmation prompt
echo -e "${YELLOW}⚠️  This will overwrite stable channel files!${NC}"
read -p "   Are you sure you want to promote v$VERSION to stable? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}❌ Promotion cancelled${NC}"
  exit 1
fi

echo ""
echo -e "${BLUE}📤 Copying files from beta to stable...${NC}"

# Copy update manifests (--no-progress for cleaner output, no tags needed)
if aws s3 ls "s3://$S3_BUCKET/beta/latest-mac.yml" --region "$AWS_REGION" &>/dev/null; then
  aws s3 cp "s3://$S3_BUCKET/beta/latest-mac.yml" "s3://$S3_BUCKET/stable/latest-mac.yml" \
    --region "$AWS_REGION" --no-progress
  echo -e "   ${GREEN}✓${NC} latest-mac.yml"
fi

# Copy ZIP files for auto-update
echo -e "${BLUE}📤 Copying ZIP files...${NC}"
aws s3 ls "s3://$S3_BUCKET/beta/" --region "$AWS_REGION" | grep "$VERSION.*\.zip" | while read -r line; do
  # Extract filename (everything after the size column, handling spaces)
  file=$(echo "$line" | awk '{$1=$2=$3=""; print substr($0,4)}' | sed 's/^ *//')
  if [ -n "$file" ]; then
    aws s3 cp "s3://$S3_BUCKET/beta/$file" "s3://$S3_BUCKET/stable/$file" --region "$AWS_REGION" --no-progress
    echo -e "   ${GREEN}✓${NC} $file"
  fi
done

# Copy DMG files
echo -e "${BLUE}📤 Copying DMG files...${NC}"
aws s3 ls "s3://$S3_BUCKET/beta/" --region "$AWS_REGION" | grep "$VERSION.*\.dmg" | while read -r line; do
  # Extract filename (everything after the size column, handling spaces)
  file=$(echo "$line" | awk '{$1=$2=$3=""; print substr($0,4)}' | sed 's/^ *//')
  if [ -n "$file" ]; then
    aws s3 cp "s3://$S3_BUCKET/beta/$file" "s3://$S3_BUCKET/stable/$file" --region "$AWS_REGION" --no-progress
    echo -e "   ${GREEN}✓${NC} $file"
  fi
done

# Copy "latest" DMG links
echo -e "${BLUE}📤 Copying 'latest' DMG links...${NC}"
if aws s3 ls "s3://$S3_BUCKET/beta/Intent-latest-arm64.dmg" --region "$AWS_REGION" &>/dev/null; then
  aws s3 cp "s3://$S3_BUCKET/beta/Intent-latest-arm64.dmg" "s3://$S3_BUCKET/stable/Intent-latest-arm64.dmg" \
    --region "$AWS_REGION" --no-progress
  echo -e "   ${GREEN}✓${NC} Intent-latest-arm64.dmg"
fi

# Copy release notes
echo -e "${BLUE}📤 Copying release notes...${NC}"
if aws s3 ls "s3://$S3_BUCKET/beta/release-notes.json" --region "$AWS_REGION" &>/dev/null; then
  aws s3 cp "s3://$S3_BUCKET/beta/release-notes.json" "s3://$S3_BUCKET/stable/release-notes.json" \
    --region "$AWS_REGION" --no-progress
  echo -e "   ${GREEN}✓${NC} release-notes.json"
fi

# Copy versioned release notes
if aws s3 ls "s3://$S3_BUCKET/beta/release-notes-${VERSION}.json" --region "$AWS_REGION" &>/dev/null; then
  aws s3 cp "s3://$S3_BUCKET/beta/release-notes-${VERSION}.json" "s3://$S3_BUCKET/stable/release-notes-${VERSION}.json" \
    --region "$AWS_REGION" --no-progress
  echo -e "   ${GREEN}✓${NC} release-notes-${VERSION}.json"
fi

# Invalidate CloudFront cache for both channels
if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  echo ""
  echo -e "${BLUE}🔄 Invalidating CloudFront cache...${NC}"
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/stable/*" "/beta/*" \
    --region "$AWS_REGION" \
    --output text > /dev/null
  echo -e "   ${GREEN}✓${NC} Cache invalidation requested for /stable/* and /beta/*"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✅ Successfully promoted v$VERSION to stable channel!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}📋 Stable channel now contains:${NC}"
aws s3 ls "s3://$S3_BUCKET/stable/" --region "$AWS_REGION" | grep -E "\.(yml|zip|dmg)$" || true
echo ""
echo -e "${YELLOW}Note: CloudFront cache invalidation may take a few minutes to complete.${NC}"
echo -e "${YELLOW}      Users on the stable channel will receive this update automatically.${NC}"
