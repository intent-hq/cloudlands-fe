# Release Process

This document describes the end-to-end release process for Intent (cloudlands-fe).

## Overview

Releases are built and published by the **Release Beta** workflow in GitHub Actions. The workflow:

1. Builds the macOS app with the bundled `intentd` sidecar (fetched from `intent-hq/intentd` main)
2. Signs and notarizes the app using Apple Developer ID certificates
3. Publishes artifacts to `intent-hq/cloudlands-releases` on GitHub
4. Opens a version-bump PR to update `package.json` on the `main` branch

## Prerequisites

### Required Secrets

The following secrets must be configured in the `intent-hq/cloudlands-fe` repository settings. For the canonical secret inventory and setup details, see [DEPLOYING.md § Required GitHub Secrets](./real/DEPLOYING.md#required-github-secrets). Quick reference:

- **`CLOUDLANDS_MACOS_CERTIFICATE`** - Base64-encoded .p12 Developer ID Application certificate
- **`CLOUDLANDS_MACOS_CERTIFICATE_PWD`** - Password for the .p12 certificate
- **`CLOUDLANDS_KEYCHAIN_PASSWORD`** - Temporary keychain password for the build runner
- **`CLOUDLANDS_APPLE_ID`** - Apple ID email for notarization
- **`CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD`** - App-specific password for notarization
- **`CLOUDLANDS_APPLE_TEAM_ID`** - Apple Developer Team ID (e.g., `6947A73B2N`)
- **`RELEASE_PAT`** - Personal Access Token (classic or fine-grained) with:
  - Classic: `repo` scope on `intent-hq/cloudlands-fe` and `intent-hq/cloudlands-releases`
  - Fine-grained: `Contents: Read and write` + `Pull requests: Read and write` on both repos
- **`INTENTD_READ_PAT`** - Personal Access Token with read access to `intent-hq/intentd`:
  - Classic: `repo` scope (read-only use)
  - Fine-grained: `Contents: Read-only`

**Important:** If `INTENTD_READ_PAT` expires, the workflow will fail at the "Checkout intentd" step with an authentication error.

## Cutting a Beta Release

1. **Trigger the workflow**
   
   Go to [Actions > Release Beta](https://github.com/intent-hq/cloudlands-fe/actions/workflows/release-beta.yml) and click "Run workflow".
   
   Enter the version number in semver format (e.g., `2.0.5`). The workflow validates the format and checks that the tag doesn't already exist.

2. **Wait for the build**
   
   The workflow takes approximately 15-20 minutes. Monitor progress at:
   ```
   https://github.com/intent-hq/cloudlands-fe/actions
   ```

3. **Verify the versioned release**
   
   Once the workflow completes successfully:
   
   ```bash
   # View the release
   gh release view v<version> --repo intent-hq/cloudlands-releases
   
   # Check assets (should include DMG, ZIP, two .blockmap files, and latest-mac.yml)
   gh release view v<version> --repo intent-hq/cloudlands-releases --json assets --jq '.assets[].name'
   
   # Verify the version in latest-mac.yml
   curl -sL https://github.com/intent-hq/cloudlands-releases/releases/download/v<version>/latest-mac.yml | grep version
   ```

4. **Verify the rolling beta channel**
   
   The workflow also updates the rolling `beta` release tag:
   
   ```bash
   # Check the beta feed
   curl -sL https://github.com/intent-hq/cloudlands-releases/releases/download/beta/latest-mac.yml | grep version
   ```

5. **Merge the version-bump PR**

   The workflow automatically opens a PR to bump `package.json` to the new version. Review and merge it:

   ```bash
   # List open PRs
   gh pr list --repo intent-hq/cloudlands-fe

   # Review the version-bump PR
   gh pr view <PR-number> --repo intent-hq/cloudlands-fe

   # Wait for CI to pass
   gh pr checks <PR-number> --repo intent-hq/cloudlands-fe --watch

   # Merge the PR (the v<version> tag points to the commit on the release branch, not the merge commit)
   gh pr merge <PR-number> --repo intent-hq/cloudlands-fe --squash --delete-branch
   ```

   **Note:** The `v<version>` tag was created by the workflow and points to the version-bump commit on the release branch (`release/v<version>-version-bump`), not the squashed merge commit on `main`. This is expected — the tag references the exact commit that was built and released.

## Promoting to Stable

After verifying a beta release, promote it to the stable channel:

1. **Download the versioned release assets**
   
   ```bash
   VERSION="<version>"
   mkdir -p /tmp/release-assets
   cd /tmp/release-assets
   
   # Download all assets from the versioned release
   gh release download "v${VERSION}" --repo intent-hq/cloudlands-releases
   ```

2. **Replace assets on the rolling stable release**
   
   ```bash
   # Delete old assets from stable
   gh release view stable --repo intent-hq/cloudlands-releases --json assets --jq '.assets[].name' | \
     xargs -I {} gh release delete-asset stable {} --repo intent-hq/cloudlands-releases --yes
   
   # Upload new assets to stable
   gh release upload stable --repo intent-hq/cloudlands-releases *.dmg *.zip *.blockmap latest-mac.yml
   ```

3. **Verify the stable feed**

   ```bash
   # Check version
   curl -sL https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml | grep version

   # Verify the ZIP sha512 matches the versioned release (extract the top-level sha512 key)
   VERSIONED_SHA=$(curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/v${VERSION}/latest-mac.yml" | awk '/^sha512:/{print $2; exit}')
   STABLE_SHA=$(curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml" | awk '/^sha512:/{print $2; exit}')

   if [ "$VERSIONED_SHA" = "$STABLE_SHA" ]; then
     echo "✓ Stable feed matches versioned release"
   else
     echo "✗ Mismatch detected"
   fi
   ```

## Troubleshooting

### INTENTD_READ_PAT Expiry

**Symptom:** Workflow fails at "Checkout intentd" with authentication error.

**Fix:** The `INTENTD_READ_PAT` token has expired. Regenerate a fine-grained Personal Access Token with `Contents: Read-only` on `intent-hq/intentd` and update the secret in repository settings.

### Version-Bump PR Step Fails

**Symptom:** "Open version-bump PR to main" step fails with a permissions error, or the workflow completes but no PR is visible.

**Fix:** The `RELEASE_PAT` is missing `Pull requests: Read and write` (fine-grained) or the `repo` scope (classic). Update the token's permissions in GitHub settings. Note: the workflow is idempotent and will re-use an existing PR if the branch already exists.

### Build Fails During Notarization

**Symptom:** "Error: Notarization failed" in the build logs.

**Fix:** Check that `CLOUDLANDS_APPLE_ID` and `CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD` are correct. The app-specific password must be generated in your Apple ID account settings.

### Duplicate Version Tag

**Symptom:** "Tag v<version> already exists on origin" error.

**Fix:** A release with this version already exists. Use a different version number or delete the existing tag if it was created in error.

## Channel Switching in the App

Users can switch between beta and stable update channels in the app's Settings screen. The toggle writes to `local-prefs.json` and calls `autoUpdater.setFeedURL` to point to the appropriate rolling release tag (`beta` or `stable`).

## Release History

For the full release history and changelogs, see:

- [cloudlands-releases repository](https://github.com/intent-hq/cloudlands-releases/releases)
- [CHANGELOG.md](../CHANGELOG.md) (points to GitHub Releases for 2.x)
