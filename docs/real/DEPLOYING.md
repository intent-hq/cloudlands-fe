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
- `INTENTD_READ_PAT` — Personal access token with read-only access to `intent-hq/intentd`

## Beta Release Workflow

The beta release workflow is defined in `.github/workflows/release-beta.yml`.

**Trigger:** Manual workflow dispatch from the GitHub Actions UI

**Input:**
- `version` — semver version string (e.g., `1.2.3`)

**What it does:**
1. Validates semver format
2. Checks out `cloudlands-fe` main branch
3. Validates `INTENTD_READ_PAT` is configured
4. Checks out `intent-hq/intentd` (main branch)
5. Builds the `intentd` sidecar binary (arm64, with Rust cache)
6. Installs frontend dependencies with pnpm
7. Bumps version in `package.json`
8. Commits version bump and creates git tag `v{version}`
9. Imports macOS code signing certificate into a temporary keychain
10. Builds and packages the macOS app (`.dmg` + `.zip` + `.blockmap` + `latest-mac.yml`)
11. Signs and notarizes the app via `scripts/notarize.js` afterSign hook
12. Publishes artifacts to `intent-hq/cloudlands-releases`:
    - Creates immutable versioned release: `v{version}`
    - Updates rolling `beta` release tag (clobbers existing assets)
13. Atomically pushes the version commit and tag to `cloudlands-fe`

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

To build the app locally for manual testing:

```bash
# Clone and build intentd sidecar (if not already available)
# In a sibling directory or separate location:
git clone https://github.com/intent-hq/intentd.git
cd intentd
cargo build --release --target aarch64-apple-darwin
INTENTD_BIN="$(pwd)/target/aarch64-apple-darwin/release/intentd"

# Return to cloudlands-fe repo root
cd /path/to/cloudlands-fe

# Build the frontend and package (set INTENTD_BIN to the built binary path)
pnpm run build
INTENTD_BIN="$INTENTD_BIN" pnpm run dist:mac
```

The packaged `.dmg` and `.zip` will be in `dist-electron/`.

**Note:** Local builds will not be signed or notarized unless you configure the signing environment variables locally (`CLOUDLANDS_APPLE_ID`, `CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD`, `CLOUDLANDS_APPLE_TEAM_ID`, or legacy `APPLE_*` equivalents).

## Operational Notes

- All release workflows run on GitHub Actions; there are no manual upload scripts
- Secrets are configured at the repository level and referenced in workflow YAML
- Release artifacts are public on `intent-hq/cloudlands-releases`
- The auto-updater uses the rolling channel tags (`beta`, `stable`) to find updates
- Versioned releases (`v{version}`) provide immutable archives for rollback
- Keep PATs and certificate passwords out of logs and transcripts
