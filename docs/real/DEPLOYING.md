# Deploying Intent

## Prerequisites

- macOS (for Mac builds)
- pnpm installed
- Valid Apple Developer account with code signing certificates
- AWS credentials with access to S3 and CloudFront

## Environment Variables

Set the following environment variables before deploying:

### AWS Configuration

```bash
export AWS_REGION="us-west-2"
export AWS_ACCESS_KEY_ID="<your-aws-access-key>"
export AWS_SECRET_ACCESS_KEY="<your-aws-secret-key>"
export S3_BUCKET="intent-downloads"
export CLOUDFRONT_DISTRIBUTION_ID="E1JC56GOKS3JRC"
export AUTO_UPDATE_URL="https://dmdri9nt15ow8.cloudfront.net"
```

### Apple Notarization

```bash
export APPLE_ID="augment apple id email"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="augment apple id team id"
```

### Sentry (Error Tracking)

```bash
export SENTRY_DSN="find on the sentry dash"
```

## Deployment Steps

### 1. Bump Version

```bash
pnpm run version:patch
```

This increments the patch version (e.g., 1.0.0 → 1.0.1). For other version bumps:

- `pnpm run version:minor` - Minor version (1.0.0 → 1.1.0)
- `pnpm run version:major` - Major version (1.0.0 → 2.0.0)

### 2. Generate Release Notes

```bash
pnpm run generate:release-notes
```

This generates release notes from git commits since the last version change. The release notes include:

- Commit history with hashes and messages
- AI-generated summary (if `auggie --print` is available)

The generated `release-notes.json` is placed in `dist-electron/` and will be uploaded with the build.

### 3. Build the macOS Distribution

```bash
pnpm run dist:mac
```

This builds, signs, and notarizes the macOS application.

### 4. Upload to Stable Channel

```bash
pnpm run upload:stable
```

This uploads the built artifacts to S3 and invalidates the CloudFront cache.

## Quick Deploy (All Steps)

```bash
# Set environment variables first, then:
pnpm run version:patch
pnpm run generate:release-notes
pnpm run dist:mac
pnpm run upload:stable
```

## Beta Releases

Beta releases allow testing new features before they go to all users. Users must opt-in to beta updates via Settings → Updates → Enable Beta Updates.

### Deploy to Beta Channel

```bash
pnpm run version:patch
pnpm run generate:release-notes
pnpm run dist:mac
pnpm run upload:beta
```

### Promote Beta to Stable

Once a beta release has been tested and is ready for all users:

```bash
pnpm run promote:beta-to-stable
```

This copies all artifacts from the beta S3 folder to the stable folder and invalidates the CloudFront cache.

You can also promote a specific version:

```bash
pnpm run promote:beta-to-stable 1.2.3
```

### Update Channels

- **stable** - Default channel for all users
- **beta** - Pre-release channel for testing (opt-in via Settings)
- **alpha** - Internal testing channel

The auto-updater uses the CloudFront URL: `https://dmdri9nt15ow8.cloudfront.net/{channel}/`

## Release Notes

Release notes are automatically generated from git commits and displayed to users after they update to a new version.

### How It Works

1. **Generation**: `pnpm run generate:release-notes` finds all commits since the last version change in `package.json`
2. **Upload**: The upload scripts include `release-notes.json` in the S3 bucket alongside build artifacts
3. **Display**: On app launch, if the version changed since last run, the app fetches and displays release notes in a modal

### Manual Release Notes

If you want to customize release notes, edit `dist-electron/release-notes.json` after generating but before uploading.

## Notes

- The app will be available for download and auto-update after CloudFront cache invalidation completes (usually within a few minutes)
- Always test the build locally before deploying to production
- Keep AWS and Apple credentials secure - never commit them to version control
- Beta releases should be tested by internal team before promoting to stable
- Release notes are shown automatically to users on first launch after an update
