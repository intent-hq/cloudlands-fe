#!/bin/bash
#
# Upload Banner Info to GCS/Cloud CDN
#
# Uploads a banner JSON file to the GCS bucket so the app can fetch it
# to display announcements, maintenance notices, etc.
#
# Prefer using the GitHub Action (Intent - Upload Banner) instead of this
# script — it uses OIDC auth and doesn't require a service account key.
#
# Required Environment Variables:
#   GOOGLE_APPLICATION_CREDENTIALS - Path to service account JSON key file
#   GCS_BUCKET                     - GCS bucket name (e.g., augment-intent-bucket)
#   GCP_PROJECT                    - GCP project ID
#   CLOUD_CDN_URL_MAP              - URL map name for Cloud CDN cache invalidation
#
# Usage:
#   ./scripts/upload-banner.sh <banner-file>
#
# Arguments:
#   banner-file - Path to the banner JSON file to upload
#
# Example:
#   # Upload a banner
#   GOOGLE_APPLICATION_CREDENTIALS=./sa-key.json \
#   GCS_BUCKET=augment-intent-bucket \
#   GCP_PROJECT=augment-intent \
#   CLOUD_CDN_URL_MAP=cdn-lb \
#   ./scripts/upload-banner.sh banner.json
#
#   # Clear the banner (upload empty array)
#   echo '[]' > /tmp/empty-banner.json
#   ./scripts/upload-banner.sh /tmp/empty-banner.json
#
# Banner JSON schema example:
#   [
#     {
#       "id": "my-banner",
#       "startAt": "2026-03-05T00:00:00Z",
#       "endAt": "2026-03-19T23:59:59Z",
#       "priority": 1,
#       "dismissable": true,
#       "message": "Try GPT-5.4 within Auggie, free for a limited time.",
#       "buttons": [
#         {
#           "text": "Learn more",
#           "action": { "type": "openUrl", "url": "https://augmentcode.com" }
#         }
#       ]
#     }
#   ]
#

set -e

BANNER_FILE=${1:-}

# Validate banner file argument
if [ -z "$BANNER_FILE" ]; then
  echo "❌ Error: Banner file path is required"
  echo "   Usage: ./scripts/upload-banner.sh <banner-file>"
  exit 1
fi

if [ ! -f "$BANNER_FILE" ]; then
  echo "❌ Error: Banner file not found: $BANNER_FILE"
  exit 1
fi

# Validate it's valid JSON
if ! python3 -m json.tool "$BANNER_FILE" > /dev/null 2>&1; then
  echo "❌ Error: $BANNER_FILE is not valid JSON"
  exit 1
fi

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

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
  echo "❌ Error: gcloud CLI is not installed"
  echo "   Install it from: https://cloud.google.com/sdk/docs/install"
  echo "   Or with: brew install --cask google-cloud-sdk"
  exit 1
fi

echo "📢 Uploading banner..."
echo "   File: $BANNER_FILE"
echo "   GCS Bucket: $GCS_BUCKET"
echo "   Project: $GCP_PROJECT"
echo ""

# Show banner contents
echo "📋 Banner contents:"
python3 -m json.tool "$BANNER_FILE"
echo ""

# Authenticate with service account
echo "🔐 Authenticating with service account..."
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --project="$GCP_PROJECT" --quiet
echo "   ✓ Authenticated"

# Upload banner file
echo "📤 Uploading banner.json..."
gcloud storage cp "$BANNER_FILE" "gs://$GCS_BUCKET/stable/banner.json" \
  --content-type="application/json" \
  --quiet
echo "   ✓ banner.json uploaded"

# Invalidate Cloud CDN cache for the banner file
echo "🔄 Invalidating Cloud CDN cache..."
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/stable/banner.json" \
  --project="$GCP_PROJECT" \
  --quiet
echo "   ✓ Cache invalidation requested for /stable/banner.json"

echo ""
echo "✅ Banner uploaded successfully!"
echo ""
echo "🌐 CDN URL:"
echo "   https://cdn.augmentcode.com/stable/banner.json"