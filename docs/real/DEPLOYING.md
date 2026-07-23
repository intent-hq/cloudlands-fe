# Deploying Intent

Intent releases are published to GitHub Releases on the public `intent-hq/cloudlands-releases` repository. The desktop app's auto-updater (electron-updater) pulls from rolling channel tags (`beta`, `stable`) on that repo.

## Release Channels

Intent uses a channel-based update model:

- **`beta`** — Rolling release tag for beta testing; auto-updater pulls from `https://github.com/intent-hq/cloudlands-releases/releases/download/beta/latest-mac.yml`
- **`stable`** — Rolling release tag for general availability; auto-updater pulls from `https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml`

Each workflow dispatch also creates an immutable versioned release (`v{version}`) for archival and rollback.

## Required GitHub Secrets

Release workflows require the following secrets configured on `intent-hq/cloudlands-fe`:

**macOS signing + notarization:**
- `CLOUDLANDS_MACOS_CERTIFICATE` — base64-encoded p12 certificate
- `CLOUDLANDS_MACOS_CERTIFICATE_PWD` — certificate password
- `CLOUDLANDS_KEYCHAIN_PASSWORD` — temporary keychain password
- `CLOUDLANDS_APPLE_ID` — Apple ID for notarization
- `CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD` — app-specific password from appleid.apple.com
- `CLOUDLANDS_APPLE_TEAM_ID` — 10-character team ID

**Repository access:**
- `RELEASE_PAT` — Personal access token with `repo` scope on `cloudlands-fe` + `cloudlands-releases`
- `INTENTD_READ_PAT` — Personal access token with read-only access to `intent-hq/intentd` (used to download the pinned intentd release assets while the repo is private)

## Beta Release Workflow

The beta release workflow is defined in `.github/workflows/release-beta.yml`.

**Trigger:** Push of a `v*.*.*` tag (created by release-please when its Release PR is merged). A `workflow_dispatch` fallback is available to (re)build an **existing** tag.

**Input (workflow_dispatch fallback only):**
- `tag` — existing tag to (re)build (e.g., `v2.1.0`)

**What it does:**
1. Resolves the release tag (from the tag push, or the dispatch input) and validates its format (supports prerelease suffixes like `v1.2.3-beta.1`)
2. Configures git token (RELEASE_PAT with repo scope for cross-repo operations)
3. Checks out the release tag
4. Verifies the tag matches the `package.json` version at that commit (guards against tags not created by release-please)
5. Fails if a `v{version}` release already exists on `intent-hq/cloudlands-releases` (duplicate-release protection)
6. Sets up pnpm and Node.js 22 with pnpm cache
7. Installs frontend dependencies with pnpm
8. Validates `INTENTD_READ_PAT` is configured
9. Reads the pinned intentd version from `intentd.version`
10. Fetches the pinned intentd release asset via `scripts/fetch-sidecar.cjs` (sha256-verified, staged at `resources/sidecar/intentd`); fails fast if the pinned release or its assets don't exist on `intent-hq/intentd`
11. Imports macOS code signing certificate into a temporary keychain
12. Builds and packages the macOS app (`.dmg` + `.zip` + `.blockmap` + `latest-mac.yml`)
13. Signs and notarizes the app via `scripts/notarize.js` afterSign hook (the staged sidecar is signed by the `scripts/sign-sidecar.js` afterPack hook)
14. Generates release notes from the fe commit range; the intentd section references the pinned intentd release
15. Publishes artifacts to `intent-hq/cloudlands-releases`:
    - Creates immutable versioned release: `v{version}`
    - Updates rolling `beta` release tag (clobbers existing assets)
16. Posts workflow summary with download URLs

The workflow no longer bumps `package.json`, creates tags, or opens version-bump PRs — release-please owns versioning and tagging (no tags are pushed to `intent-hq/intentd` — it releases on its own cycle).

**Output:**
- Versioned release on `cloudlands-releases`: `https://github.com/intent-hq/cloudlands-releases/releases/tag/v{version}`
- Rolling beta channel: `https://github.com/intent-hq/cloudlands-releases/releases/tag/beta`
- Auto-updater feed: `https://github.com/intent-hq/cloudlands-releases/releases/download/beta/latest-mac.yml`

## Promote-to-Stable Workflow

_(Not yet implemented — planned as a separate workflow)_

The promote-to-stable workflow will:
1. Identify the latest beta release from `intent-hq/cloudlands-releases`
2. Copy all artifacts to the `stable` rolling release tag
3. Create an immutable stable versioned release

## Rollback Workflow

_(Not yet implemented — planned as a separate workflow)_

The rollback workflow will restore a previous versioned release to a channel's rolling tag.

## Windows and Linux Builds

_(Not yet implemented — planned as separate platform matrix jobs in the release workflow)_

Windows and Linux builds will follow the same GitHub Releases model but ship unsigned (no Windows Authenticode cert available).

## Manual Local Build (Development / Testing)

To build the app locally for manual testing with the pinned intentd release:

```bash
# Fetch the pinned intentd sidecar (see intentd.version); set INTENTD_READ_PAT
# (or GH_TOKEN/GITHUB_TOKEN) while the intentd repo is private
node scripts/fetch-sidecar.cjs

# Build the frontend and package (point INTENTD_BIN at the staged sidecar)
pnpm run build
INTENTD_BIN="$(pwd)/resources/sidecar/intentd" pnpm run dist:mac
```

To build against a locally built intentd instead, point `INTENTD_BIN` at your
`cargo build --release` output (or omit it in the monorepo, where
`scripts/copy-sidecar.cjs` defaults to `packages/intentd/target/release`).

The packaged `.dmg` and `.zip` will be in `dist-electron/`.

**Note:** Local builds will not be signed or notarized unless you configure the signing environment variables locally (`CLOUDLANDS_APPLE_ID`, `CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD`, `CLOUDLANDS_APPLE_TEAM_ID`, or legacy `APPLE_*` equivalents).

## Operational Notes

- All release workflows run on GitHub Actions; there are no manual upload scripts
- Secrets are configured at the repository level and referenced in workflow YAML
- Release artifacts are public on `intent-hq/cloudlands-releases`
- The auto-updater uses the rolling channel tags (`beta`, `stable`) to find updates
- Versioned releases (`v{version}`) provide immutable archives for rollback
- Keep PATs and certificate passwords out of logs and transcripts
