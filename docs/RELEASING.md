# Release Process

This document describes the end-to-end release process for Intent (cloudlands-fe).

## Overview

Releases are built and published by the **Release Beta** workflow in GitHub Actions. The workflow:

1. Builds the macOS app with the bundled `intentd` sidecar (fetched from `intent-hq/intentd` main)
2. Signs and notarizes the app using Apple Developer ID certificates
3. Generates release notes by comparing commit ranges across both `cloudlands-fe` and `intentd` repos
4. Tags the `intentd` commit (`v{VERSION}`) used in the build
5. Publishes artifacts to `intent-hq/cloudlands-releases` on GitHub, including:
   - DMG installer, ZIP archive, blockmap files, and `latest-mac.yml` (auto-updater feed)
   - `release-manifest.json` — metadata capturing the exact `intentd` SHA and version
6. Opens a version-bump PR to update `package.json` on the `main` branch

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
  - Classic: `repo` scope on `intent-hq/cloudlands-fe`, `intent-hq/cloudlands-releases`, and `intent-hq/intentd`
  - Fine-grained: `Contents: Read and write` + `Pull requests: Read and write`, with repository access to `cloudlands-fe`, `cloudlands-releases`, and `intentd` (PR permissions unused for intentd)
- **`INTENTD_READ_PAT`** - Personal Access Token with read access to `intent-hq/intentd`, `intent-hq/cloudlands-fe`, and `intent-hq/cloudlands-releases`:
  - Classic: `repo` scope (read-only use)
  - Fine-grained: `Contents: Read-only` with repository access to all three repos (used for generating release notes and downloading release manifests)

**Important:** If `INTENTD_READ_PAT` expires, the workflow will fail at the "Checkout intentd" step with an authentication error.

## Cutting a Beta Release

1. **Trigger the workflow**

   Go to [Actions > Release Beta](https://github.com/intent-hq/cloudlands-fe/actions/workflows/release-beta.yml) and click "Run workflow".

   Enter the version number in semver format (e.g., `2.0.5`). The workflow validates the format and checks that the tag doesn't already exist.

   **Optional:** Provide the `intentd_base_sha` workflow input when the previous release has no intentd tag and no `release-manifest.json` (e.g., first automated release after manual releases, or a gap in the release sequence). This is the baseline intentd commit SHA for computing release notes. The workflow auto-resolves the base SHA from: (1) intentd tag matching the previous cloudlands-fe release, (2) `release-manifest.json` from the previous release, or (3) the `intentd_base_sha` input. If all three fail, the workflow errors with a clear message requiring the input.

2. **Wait for the build**

   The workflow takes approximately 15-20 minutes. Monitor progress at:
   ```
   https://github.com/intent-hq/cloudlands-fe/actions
   ```

3. **Verify the versioned release**

   Once the workflow completes successfully:

   ```bash
   VERSION="<version>"

   # View the release
   gh release view "v${VERSION}" --repo intent-hq/cloudlands-releases

   # Check assets (should include DMG, ZIP, two .blockmap files, latest-mac.yml, and release-manifest.json)
   gh release view "v${VERSION}" --repo intent-hq/cloudlands-releases --json assets --jq '.assets[].name'

   # Verify the version in latest-mac.yml
   curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/v${VERSION}/latest-mac.yml" | grep version

   # Inspect the release manifest (captures intentd SHA and version)
   curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/v${VERSION}/release-manifest.json" | jq .

   # Verify intentd tag was created and view the tag reference
   gh api "repos/intent-hq/intentd/git/refs/tags/v${VERSION}" --jq '.ref'
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

After verifying a beta release, promote it to the stable channel using the **Release Stable** workflow:

1. **Trigger the workflow**

   Go to [Actions > Release Stable](https://github.com/intent-hq/cloudlands-fe/actions/workflows/release-stable.yml) and click "Run workflow".

   Enter the version number to promote (e.g., `2.0.7`). The version must:
   - Exist as a published versioned release (`v{VERSION}`) on `intent-hq/cloudlands-releases`
   - Use stable semver format (`X.Y.Z` only — no prerelease or build suffixes)
   - Be greater than the current stable version (or be the first promotion)

2. **What the workflow does**

   The workflow automatically:
   - Downloads all assets from the versioned release `v{VERSION}`
   - Uploads new assets to the rolling `stable` release tag with `--clobber` (versioned assets first, then `latest-mac.yml` last for atomic feed switch)
   - Deletes old versioned assets from the previous stable promotion (only after new assets are uploaded and live)
   - Verifies the `sha512` hash in `latest-mac.yml` matches the versioned release (with retries for CDN propagation)
   - Aggregates release notes from all versions in the range `(prevStable, VERSION]`
   - Updates the stable release body with the aggregated notes

   The workflow is **idempotent** — re-running with the same version is safe and updates assets/notes to match.

3. **Verify the stable feed**

   ```bash
   VERSION="<version>"

   # Check version
   curl -sL https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml | grep version

   # Verify the ZIP sha512 matches the versioned release
   VERSIONED_SHA=$(curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/v${VERSION}/latest-mac.yml" | awk '/^sha512:/{print $2; exit}')
   STABLE_SHA=$(curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml" | awk '/^sha512:/{print $2; exit}')

   if [ "$VERSIONED_SHA" = "$STABLE_SHA" ]; then
     echo "✓ Stable feed matches versioned release"
   else
     echo "✗ Mismatch detected"
   fi

   # View aggregated release notes
   gh release view stable --repo intent-hq/cloudlands-releases
   ```

## Troubleshooting

### INTENTD_READ_PAT Expiry

**Symptom:** Workflow fails at "Checkout intentd" with authentication error.

**Fix:** The `INTENTD_READ_PAT` token has expired. Regenerate a fine-grained Personal Access Token with `Contents: Read-only` on `intent-hq/intentd` and update the secret in repository settings.

### RELEASE_PAT Permissions

**Symptom:** "Open version-bump PR to main" step fails with a permissions error, or the workflow completes but no PR is visible. Alternatively, "Push intentd tag" step fails.

**Fix:** The `RELEASE_PAT` is missing required permissions:
- For cloudlands-fe PRs: `Pull requests: Read and write` (fine-grained) or `repo` scope (classic)
- For intentd tags: `Contents: Read and write` on `intent-hq/intentd` (fine-grained) or `repo` scope (classic)

Update the token's permissions in GitHub settings. Note: the workflow is idempotent and will re-use an existing PR if the branch already exists.

### Build Fails During Notarization

**Symptom:** "Error: Notarization failed" in the build logs.

**Fix:** Check that `CLOUDLANDS_APPLE_ID` and `CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD` are correct. The app-specific password must be generated in your Apple ID account settings.

### Duplicate Version Tag

**Symptom:** "Tag v<version> already exists on origin" error (on cloudlands-fe or intentd).

**Fix:** A release with this version already exists. Use a different version number or delete the existing tag if it was created in error.

### Release Notes Generation Fails

**Symptom:** Workflow fails with "Could not resolve intentd base SHA. This is the first release and requires the intentd_base_sha workflow input."

**Fix:** The workflow cannot find an intentd tag matching the previous cloudlands-fe release, and the previous release has no `release-manifest.json` asset, and no `intentd_base_sha` input was provided. Re-run the workflow and provide the `intentd_base_sha` input — the baseline intentd commit SHA for computing release notes (e.g., the intentd SHA from the last manual beta or the intentd commit used in the previous release). Future releases will auto-resolve the base from the intentd tag or manifest.

### Stable Promotion SHA Mismatch

**Symptom:** "sha512 mismatch after N retries" error in the stable promotion workflow.

**Fix:** This typically indicates CDN propagation delay or incomplete asset upload. Wait a few minutes and re-run the workflow (it's idempotent). If the issue persists, verify the versioned release assets are intact and use the manual fallback procedure below.

## Manual Fallback — Stable Promotion

If the automated **Release Stable** workflow fails and cannot be fixed by re-running, you can promote manually:

1. **Download the versioned release assets**

   ```bash
   VERSION="<version>"
   mkdir -p /tmp/release-assets
   cd /tmp/release-assets
   gh release download "v${VERSION}" --repo intent-hq/cloudlands-releases
   ```

2. **Replace assets on the rolling stable release**

   ```bash
   # Delete old assets from stable
   gh release view stable --repo intent-hq/cloudlands-releases --json assets --jq '.assets[].name' | \
     xargs -I {} gh release delete-asset stable {} --repo intent-hq/cloudlands-releases --yes

   # Upload new assets to stable (latest-mac.yml last for atomic switch)
   gh release upload stable --repo intent-hq/cloudlands-releases --clobber \
     *.dmg *.zip *.blockmap release-manifest.json
   gh release upload stable --repo intent-hq/cloudlands-releases --clobber \
     latest-mac.yml
   ```

3. **Verify sha512 hash**

   ```bash
   VERSIONED_SHA=$(curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/v${VERSION}/latest-mac.yml" | awk '/^sha512:/{print $2; exit}')
   STABLE_SHA=$(curl -sL "https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml" | awk '/^sha512:/{print $2; exit}')

   if [ "$VERSIONED_SHA" = "$STABLE_SHA" ]; then
     echo "✓ Stable feed matches versioned release"
   else
     echo "✗ Mismatch detected — wait for CDN propagation or check assets"
   fi
   ```

4. **Update stable release notes manually (optional)**

   Download release notes from each version in the range and concatenate them, then:
   ```bash
   gh release edit stable --repo intent-hq/cloudlands-releases --notes-file aggregated-notes.md
   ```

## Channel Switching in the App

Users can switch between beta and stable update channels in the app's Settings screen. The toggle writes to `local-prefs.json` and calls `autoUpdater.setFeedURL` to point to the appropriate rolling release tag (`beta` or `stable`).

## Release History

For the full release history and changelogs, see:

- [cloudlands-releases repository](https://github.com/intent-hq/cloudlands-releases/releases)
- [CHANGELOG.md](../CHANGELOG.md) (points to GitHub Releases for 2.x)
