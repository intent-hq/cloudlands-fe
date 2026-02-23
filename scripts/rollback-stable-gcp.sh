#!/bin/bash
#
# Rollback Stable Channel to a Previous Version (GCP)
#
# This script rewrites the stable channel manifests to point at a previous
# version's artifacts that already exist on GCS. It does NOT rebuild anything.
#
# Required Environment Variables:
#   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON key file
#   GCS_BUCKET                     - GCS bucket name (e.g., intent-updates)
#   GCP_PROJECT                    - GCP project ID
#   CLOUD_CDN_URL_MAP              - URL map name for Cloud CDN cache invalidation
#
# Usage:
#   ./scripts/rollback-stable-gcp.sh <version>
#
# Arguments:
#   version - Required: the version to roll back TO (e.g., 1.2.3)
#
# Example:
#   GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json \
#   GCS_BUCKET=intent-updates \
#   GCP_PROJECT=my-project \
#   CLOUD_CDN_URL_MAP=cdn-lb \
#   ./scripts/rollback-stable-gcp.sh 1.2.3
#

set -euo pipefail

CHANNEL="stable"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "❌ Error: version argument is required"
  echo "   Usage: $0 <version>"
  echo "   Example: $0 1.2.3"
  exit 1
fi

# Validate required environment variables
for var in GOOGLE_APPLICATION_CREDENTIALS GCS_BUCKET GCP_PROJECT CLOUD_CDN_URL_MAP; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Error: $var environment variable is required"
    exit 1
  fi
done

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
  echo "❌ Error: gcloud CLI is not installed"
  exit 1
fi

# Authenticate with service account
echo "🔐 Authenticating with service account..."
gcloud auth activate-service-account \
  --key-file="$GOOGLE_APPLICATION_CREDENTIALS" \
  --project="$GCP_PROJECT" \
  --quiet
echo "   ✓ Authenticated"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "   ⚠️  Rolling back stable channel → v$VERSION"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "   Bucket:      $GCS_BUCKET"
echo "   Project:     $GCP_PROJECT"
echo "   CDN URL Map: $CLOUD_CDN_URL_MAP"
echo ""

# --- Verify target version artifacts exist ---
echo "🔍 Verifying target version artifacts exist on GCS..."

PRODUCT_NAME="Intent by Augment"
ARM64_ZIP="${PRODUCT_NAME}-${VERSION}-arm64-mac.zip"
X64_ZIP="${PRODUCT_NAME}-${VERSION}-mac.zip"
ARM64_DMG="${PRODUCT_NAME}-${VERSION}-arm64.dmg"
X64_DMG="${PRODUCT_NAME}-${VERSION}.dmg"

MISSING=0
for file in "$ARM64_ZIP" "$X64_ZIP" "$ARM64_DMG" "$X64_DMG"; do
  if gcloud storage stat "gs://$GCS_BUCKET/$CHANNEL/$file" &>/dev/null; then
    echo "   ✓ $file"
  else
    echo "   ✗ $file NOT FOUND"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "❌ Error: some artifacts for v$VERSION are missing from gs://$GCS_BUCKET/$CHANNEL/"
  echo "   Rollback requires that the target version's artifacts still exist on GCS."
  exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# --- Rewrite manifests ---
echo ""
echo "📝 Rewriting update manifests..."

rewrite_mac_manifest() {
  local manifest_name="latest-mac.yml"
  local versioned_manifest="latest-mac-${VERSION}.yml"
  local gcs_path="gs://$GCS_BUCKET/$CHANNEL"

  # Prefer versioned manifest if it exists
  if gcloud storage stat "$gcs_path/$versioned_manifest" &>/dev/null; then
    echo "   Using versioned manifest: $versioned_manifest"
    gcloud storage cp "$gcs_path/$versioned_manifest" "$gcs_path/$manifest_name" --quiet
    echo "   ✓ $manifest_name (from versioned copy)"
    return 0
  fi

  # No versioned manifest — download both ZIPs and build a merged manifest
  echo "   No versioned manifest found, rewriting $manifest_name..."

  # Download both ZIPs to compute sha512 (electron-builder uses base64-encoded sha512)
  echo "   Downloading $X64_ZIP to compute sha512 (this may take a moment)..."
  gcloud storage cp "$gcs_path/$X64_ZIP" "$TMPDIR/$X64_ZIP" --quiet
  echo "   Downloading $ARM64_ZIP to compute sha512 (this may take a moment)..."
  gcloud storage cp "$gcs_path/$ARM64_ZIP" "$TMPDIR/$ARM64_ZIP" --quiet

  local x64_sha512 x64_size arm64_sha512 arm64_size
  x64_sha512=$(openssl dgst -sha512 -binary "$TMPDIR/$X64_ZIP" | base64 | tr -d '\n')
  x64_size=$(stat -c%s "$TMPDIR/$X64_ZIP" 2>/dev/null || stat -f%z "$TMPDIR/$X64_ZIP")
  arm64_sha512=$(openssl dgst -sha512 -binary "$TMPDIR/$ARM64_ZIP" | base64 | tr -d '\n')
  arm64_size=$(stat -c%s "$TMPDIR/$ARM64_ZIP" 2>/dev/null || stat -f%z "$TMPDIR/$ARM64_ZIP")

  rm -f "$TMPDIR/$X64_ZIP" "$TMPDIR/$ARM64_ZIP"

  local x64_url arm64_url
  x64_url=$(echo "$X64_ZIP" | sed 's/ /%20/g')
  arm64_url=$(echo "$ARM64_ZIP" | sed 's/ /%20/g')

  cat > "$TMPDIR/$manifest_name" <<EOF
version: ${VERSION}
files:
  - url: ${x64_url}
    sha512: ${x64_sha512}
    size: ${x64_size}
  - url: ${arm64_url}
    sha512: ${arm64_sha512}
    size: ${arm64_size}
path: ${x64_url}
sha512: ${x64_sha512}
releaseDate: '$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'
EOF

  gcloud storage cp "$TMPDIR/$manifest_name" "$gcs_path/$manifest_name" \
    --content-type="application/x-yaml" --quiet
  echo "   ✓ $manifest_name (rewritten with both architectures)"
}

rewrite_mac_manifest

# --- Update "latest" DMG links ---
echo ""
echo "📤 Updating 'latest' DMG links..."

gcloud storage cp "gs://$GCS_BUCKET/$CHANNEL/$ARM64_DMG" \
  "gs://$GCS_BUCKET/$CHANNEL/Intent-latest-arm64.dmg" --quiet
echo "   ✓ Intent-latest-arm64.dmg → $ARM64_DMG"

gcloud storage cp "gs://$GCS_BUCKET/$CHANNEL/$X64_DMG" \
  "gs://$GCS_BUCKET/$CHANNEL/Intent-latest.dmg" --quiet
echo "   ✓ Intent-latest.dmg → $X64_DMG"

# --- Invalidate Cloud CDN cache ---
echo ""
echo "🔄 Invalidating Cloud CDN cache..."
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/$CHANNEL/*" \
  --project="$GCP_PROJECT" \
  --quiet
echo "   ✓ Cache invalidation requested for /$CHANNEL/*"

# --- Summary ---
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "   ✅ Stable channel rolled back to v$VERSION"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📋 Updated files:"
echo "   - stable/latest-mac.yml → v$VERSION (both architectures)"
echo "   - stable/Intent-latest-arm64.dmg → $ARM64_DMG"
echo "   - stable/Intent-latest.dmg → $X64_DMG"
echo ""
echo "🌐 CDN URLs (may take a few minutes to update):"
echo "   https://cdn.augmentcode.com/$CHANNEL/latest-mac.yml"
echo "   https://cdn.augmentcode.com/$CHANNEL/Intent-latest-arm64.dmg"
echo "   https://cdn.augmentcode.com/$CHANNEL/Intent-latest.dmg"

