# Deploying Intent

Google Cloud Platform (GCP) is the primary release target for Intent. The current upload and promotion flow is built around Google Cloud Storage plus Cloud CDN. AWS scripts remain in the repository only for migration and legacy support.

## What the Release Scripts Expect

The deployment scripts assume release artifacts already exist in `dist-electron/`.

Typical macOS release preparation:

```bash
pnpm run version:patch        # or version:minor / version:major
pnpm run generate:release-notes
pnpm run dist:mac
```

Typical Windows release preparation:

```bash
pnpm run generate:release-notes
pnpm run dist:win
```

If `dist-electron/release-notes.json` is missing, the upload scripts warn and tell you to run `pnpm run generate:release-notes` first.

## Required GCP Environment Variables

All GCP upload and promotion scripts validate the same core environment variables:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
export GCS_BUCKET="intent-updates"
export GCP_PROJECT="my-gcp-project"
export CLOUD_CDN_URL_MAP="intent-cdn"
```

These variables are used by:

- `scripts/upload-release.sh`
- `scripts/upload-release-gcp.sh`
- `scripts/upload-release-windows-gcp.sh`
- `scripts/promote-to-stable-gcp.sh`

The scripts authenticate with:

```bash
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --project="$GCP_PROJECT" --quiet
```

## Release Channels

All release scripts use the same channel model:

- `stable` — default user channel
- `beta` — prerelease testing channel
- `alpha` — internal/early testing channel

The primary CDN endpoints are:

- `https://cdn.augmentcode.com/stable/latest-mac.yml`
- `https://cdn.augmentcode.com/beta/latest-mac.yml`
- `https://cdn.augmentcode.com/alpha/latest-mac.yml`

Windows uploads use `latest.yml` instead of `latest-mac.yml`.

## Primary Upload Flows

### Dual Upload Script: `upload-release.sh`

`pnpm run upload:stable`, `pnpm run upload:beta`, and `pnpm run upload:alpha` are aliases for:

```bash
bash scripts/upload-release.sh <channel>
```

This is the migration-oriented script. Its behavior is:

- uploads release files to GCP as the primary source of truth
- uploads `latest-mac.yml` to GCP
- rewrites the AWS-side manifest to point at GCP CDN URLs
- optionally publishes migration manifests to AWS for older clients still checking S3/CloudFront
- invalidates the GCP Cloud CDN path for the chosen channel

For macOS artifacts, it uploads:

- `latest-mac.yml`
- versioned `.zip` files
- versioned `.blockmap` files
- versioned `.dmg` files
- `Intent-latest-arm64.dmg`
- `release-notes.json`
- `release-notes-<version>.json`

## GCP-Only macOS Upload: `upload-release-gcp.sh`

Use the GCP-only script when you do not need the AWS migration step:

```bash
pnpm run upload:gcp-only:stable
# or
bash scripts/upload-release-gcp.sh stable
```

This script uploads the same macOS artifacts as the dual-upload flow, but only to GCP/Cloud CDN.

It also invalidates the selected CDN path:

```bash
gcloud compute url-maps invalidate-cdn-cache "$CLOUD_CDN_URL_MAP" \
  --path "/$CHANNEL/*" \
  --project "$GCP_PROJECT" \
  --quiet
```

## GCP-Only Windows Upload: `upload-release-windows-gcp.sh`

Windows releases use a separate GCP-only uploader:

```bash
bash scripts/upload-release-windows-gcp.sh stable
```

This script uploads Windows update artifacts to `gs://$GCS_BUCKET/<channel>/` and invalidates Cloud CDN.

It looks for and uploads:

- `latest.yml`
- versioned `.exe` installers
- versioned `.blockmap` files
- `Intent-latest-Setup.exe`

Primary Windows CDN endpoints:

- `https://cdn.augmentcode.com/<channel>/latest.yml`
- `https://cdn.augmentcode.com/<channel>/Intent-latest-Setup.exe`

## Promoting Beta to Stable on GCP

The primary stable-promotion flow is:

```bash
bash scripts/promote-to-stable-gcp.sh [version]
```

If no version is provided, the script reads `beta/latest-mac.yml` from GCS to discover the current beta version.

The promotion script copies these artifacts from `beta/` to `stable/` when present:

- `latest-mac.yml`
- versioned release files that match the chosen version
- `Intent-latest-arm64.dmg`
- `release-notes.json`
- `release-notes-<version>.json`

After copying, it invalidates `/stable/*` in Cloud CDN.

## Recommended GCP Release Sequences

### Stable macOS release

```bash
pnpm run version:patch
pnpm run generate:release-notes
pnpm run dist:mac
pnpm run upload:gcp-only:stable
```

### Beta macOS release

```bash
pnpm run version:patch
pnpm run generate:release-notes
pnpm run dist:mac
pnpm run upload:gcp-only:beta
```

### Promote tested beta to stable

```bash
bash scripts/promote-to-stable-gcp.sh
```

Or promote a specific version explicitly:

```bash
bash scripts/promote-to-stable-gcp.sh 1.2.3
```

## Release Notes

Release notes are generated with:

```bash
pnpm run generate:release-notes
```

The upload scripts look for `dist-electron/release-notes.json` and, when it exists, upload both:

- `release-notes.json`
- `release-notes-<version>.json`

This applies to both `upload-release.sh` and `upload-release-gcp.sh`, and `promote-to-stable-gcp.sh` also copies those files from beta to stable.

## AWS (Legacy / Migration Support)

AWS is no longer the primary deployment target.

The remaining AWS scripts are kept so older clients and migration workflows can continue to function:

- `scripts/upload-release.sh` can optionally publish AWS migration manifests if AWS settings are available.
- `scripts/promote-beta-to-stable.sh` is the legacy AWS beta-to-stable promotion script.

### AWS variables used by the migration/legacy flow

`upload-release.sh` checks for:

```bash
export AWS_REGION="us-west-2"
export S3_BUCKET="intent-downloads"
export CLOUDFRONT_DISTRIBUTION_ID="<optional-cloudfront-id>"
```

In practice, AWS CLI credentials must also already be available to `aws`, typically via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or a configured profile.

If `AWS_REGION` or `S3_BUCKET` is missing, `upload-release.sh` warns and skips the AWS migration upload rather than failing the GCP release.

### Legacy AWS promotion

```bash
bash scripts/promote-beta-to-stable.sh [version]
```

This script copies macOS beta artifacts from S3 to the stable S3 prefix, optionally invalidates CloudFront, and is intended only for legacy support.

## Operational Notes

- Always verify `dist-electron/` contains the expected artifacts before uploading.
- GCP upload success does not mean CDN invalidation is instantaneous; allow a few minutes for caches to refresh.
- Keep service-account files and cloud credentials out of version control.
- Prefer the GCP-only scripts for current releases unless you explicitly need the AWS migration path.
