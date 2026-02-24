#!/bin/bash
#
# Promote Beta Release to Stable Channel (GCP)
#
# This script copies release artifacts from the beta GCS prefix to the stable prefix,
# effectively promoting a beta release to stable for all users.
#
# Required Environment Variables:
#   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON key file
#   GCS_BUCKET                     - GCS bucket name (e.g., intent-updates)
#   GCP_PROJECT                    - GCP project ID
#   CLOUD_CDN_URL_MAP              - URL map name for Cloud CDN cache invalidation
#
# Usage:
#   ./scripts/promote-to-stable-gcp.sh [version]
#
# Arguments:
#   version - Optional: specific version to promote. If not provided, reads latest beta version.
#
# Example:
#   GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json \
#   GCS_BUCKET=intent-updates \
#   GCP_PROJECT=my-project \
#   CLOUD_CDN_URL_MAP=cdn-lb \
#   ./scripts/promote-to-stable-gcp.sh 1.2.3
#

set -e

# Validate required environment variables
for var in GOOGLE_APPLICATION_CREDENTIALS GCS_BUCKET GCP_PROJECT CLOUD_CDN_URL_MAP; do
  if [ -z "${!var}" ]; then
    echo "Error: $var environment variable is required"
    exit 1
  fi
done

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed"
  echo "  Install it from: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Authenticate with service account
echo "Authenticating with service account..."
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --project="$GCP_PROJECT" --quiet
echo "  Authenticated"

# Get version from beta channel
if [ -n "$1" ]; then
  VERSION="$1"
  echo "Promoting specified version: v$VERSION"
else
  echo "Fetching current beta version..."
  BETA_MANIFEST=$(gcloud storage cat "gs://$GCS_BUCKET/beta/latest-mac.yml" 2>/dev/null || true)

  if [ -z "$BETA_MANIFEST" ]; then
    echo "Error: Could not fetch beta manifest. Is there a beta release?"
    exit 1
  fi

  VERSION=$(echo "$BETA_MANIFEST" | grep "^version:" | sed 's/version: //')

  if [ -z "$VERSION" ]; then
    echo "Error: Could not extract version from beta manifest"
    exit 1
  fi

  echo "  Found beta version: v$VERSION"
fi

echo ""
echo "========================================"
echo "  Promoting Beta -> Stable"
echo "========================================"
echo ""
echo "  Version:    v$VERSION"
echo "  GCS Bucket: $GCS_BUCKET"
echo "  Project:    $GCP_PROJECT"
echo ""

# Validate beta artifacts exist
echo "Validating beta artifacts..."
BETA_FILES=$(gcloud storage ls "gs://$GCS_BUCKET/beta/" 2>/dev/null | grep -E "($VERSION|latest-mac)" || true)
if [ -z "$BETA_FILES" ]; then
  echo "Error: No beta artifacts found for v$VERSION"
  exit 1
fi
echo "  Beta artifacts found"
echo ""

# Copy update manifests
echo "Copying update manifests..."
for manifest in latest-mac.yml; do
  if gcloud storage ls "gs://$GCS_BUCKET/beta/$manifest" &>/dev/null; then
    gcloud storage cp "gs://$GCS_BUCKET/beta/$manifest" "gs://$GCS_BUCKET/stable/$manifest" --quiet
    echo "  $manifest"
  fi
done

# Copy versioned artifacts (zips, dmgs, blockmaps)
echo "Copying versioned artifacts..."
gcloud storage ls "gs://$GCS_BUCKET/beta/" 2>/dev/null | grep "$VERSION" | while IFS= read -r file_path; do
  filename=$(basename "$file_path")
  gcloud storage cp "$file_path" "gs://$GCS_BUCKET/stable/$filename" --quiet
  echo "  $filename"
done

# Copy "latest" DMG links
echo "Copying 'latest' DMG links..."
for dmg in Intent-latest-arm64.dmg Intent-latest.dmg; do
  if gcloud storage ls "gs://$GCS_BUCKET/beta/$dmg" &>/dev/null; then
    gcloud storage cp "gs://$GCS_BUCKET/beta/$dmg" "gs://$GCS_BUCKET/stable/$dmg" --quiet
    echo "  $dmg"
  fi
done

# Copy release notes
echo "Copying release notes..."
for notes_file in release-notes.json "release-notes-${VERSION}.json"; do
  if gcloud storage ls "gs://$GCS_BUCKET/beta/$notes_file" &>/dev/null; then
    gcloud storage cp "gs://$GCS_BUCKET/beta/$notes_file" "gs://$GCS_BUCKET/stable/$notes_file" --quiet
    echo "  $notes_file"
  fi
done

# Invalidate Cloud CDN cache
echo ""
echo "Invalidating Cloud CDN cache..."
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/stable/*" \
  --project="$GCP_PROJECT" \
  --quiet
echo "  Cache invalidation requested for /stable/*"

echo ""
echo "========================================"
echo "  Promoted v$VERSION to stable channel"
echo "========================================"
echo ""
echo "Stable channel files:"
gcloud storage ls "gs://$GCS_BUCKET/stable/" 2>/dev/null | grep -E "\.(yml|zip|dmg|blockmap)$" || true
echo ""
echo "CDN URLs:"
echo "  https://cdn.augmentcode.com/stable/latest-mac.yml"
echo "  https://cdn.augmentcode.com/stable/Intent-latest-arm64.dmg"
echo "  https://cdn.augmentcode.com/stable/Intent-latest.dmg"
echo ""
echo "Note: CDN cache invalidation may take a few minutes to complete."

