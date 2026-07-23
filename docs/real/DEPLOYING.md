# Deploying Intent

Intent releases are published to GitHub Releases on the public `intent-hq/cloudlands-releases` repository. The desktop app's auto-updater (electron-updater) pulls from rolling channel tags (`beta`, `stable`) on that repo.

## Release Channels

Intent uses a channel-based update model:

- **`beta`** — Rolling release tag for beta testing; auto-updater pulls from `https://github.com/intent-hq/cloudlands-releases/releases/download/beta/latest-mac.yml`
- **`stable`** — Rolling release tag for general availability; auto-updater pulls from `https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml`

Each workflow dispatch also creates an immutable versioned release (`v{version}`) for archival and rollback.

## Versioning — release-please Release PRs

Version numbers are computed from conventional commits by
[release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release-please.yml`, configured via
`release-please-config.json` + `.release-please-manifest.json`). Nobody types a
version number by hand.

**Flow:**

1. On every push to `main`, release-please opens (or updates) a **Release PR**
   that bumps `package.json` and regenerates `CHANGELOG.md` from the
   conventional commits since the last `v*` tag.
2. A human merges the Release PR when it's time to ship — that is the release
   timing gate.
3. On the merge, release-please creates the `v{version}` tag and a GitHub
   Release on `cloudlands-fe`. The workflow authenticates with `RELEASE_PAT`
   (not the default `GITHUB_TOKEN`) so the pushed tag triggers downstream
   workflows.

**Version math** (the app is ≥ 1.0, so full semver rules apply):

- `fix:` → patch (e.g. 2.0.13 → 2.0.14)
- `feat:` → minor (e.g. 2.0.13 → 2.1.0)
- `type!:` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer → major
  (e.g. 2.0.13 → 3.0.0)
- `chore:`, `docs:`, `refactor:`, etc. → no release on their own

**Conventions:**

- **Breaking changes** must be marked with `!` after the type/scope
  (`feat!: drop legacy settings migration`) or a `BREAKING CHANGE:` footer, or
  the major bump will be missed.
- **intentd sidecar pin bumps** must use `fix(sidecar):` (e.g.
  `fix(sidecar): bump intentd pin to 0.4.2`) so a new pinned daemon triggers at
  least a patch release. A plain `chore:` pin bump would not produce a release.
- **Plain versions only** — no prerelease suffixes (`-beta.N`). Beta vs. stable
  remains a *promotion* distinction on `cloudlands-releases`, not a version
  distinction.

**Why a GitHub Release on `cloudlands-fe` too?** Creating the tag via a GitHub
Release is how release-please operates, and the release body carries the
changelog for that version. It does not conflict with the publishing model:
`cloudlands-fe` is private, so user-facing artifacts live exclusively on the
public `intent-hq/cloudlands-releases` repo, while the `cloudlands-fe` release
is the internal changelog anchor for the tag.

**Bootstrap note (remove after the first release-please release):** the
pre-release-please tag `v2.0.13` points at a commit that is not on `main` (the
old workflow tagged its own bump commit and merged a squashed copy of it), so
release-please cannot bound the commit range from the tag alone.
`release-please-config.json` pins `last-release-sha` to `562af4d2` (the
`chore: bump version to 2.0.13` commit on `main`) so the first Release PR only
considers commits since v2.0.13. Once the first release-please release has
been merged and tagged (tags now land on `main`), **delete the
`last-release-sha` line** — leaving it in place would make every later Release
PR re-include already-released commits.

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

**Trigger:** Manual workflow dispatch from the GitHub Actions UI

**Input:**
- `version` — semver version string (e.g., `1.2.3`)

**What it does:**
1. Validates semver format (supports prerelease suffixes like `1.2.3-beta.1`)
2. Configures git token (RELEASE_PAT with repo scope for cross-repo operations)
3. Checks out `cloudlands-fe` main branch
4. Sets up pnpm and Node.js 22 with pnpm cache
5. Installs frontend dependencies with pnpm
6. Validates `INTENTD_READ_PAT` is configured
7. Reads the pinned intentd version from `intentd.version`
8. Fetches the pinned intentd release asset via `scripts/fetch-sidecar.cjs` (sha256-verified, staged at `resources/sidecar/intentd`); fails fast if the pinned release or its assets don't exist on `intent-hq/intentd`
9. Bumps version in `package.json`
10. Commits version bump and creates git tag `v{version}`
11. Imports macOS code signing certificate into a temporary keychain
12. Builds and packages the macOS app (`.dmg` + `.zip` + `.blockmap` + `latest-mac.yml`)
13. Signs and notarizes the app via `scripts/notarize.js` afterSign hook (the staged sidecar is signed by the `scripts/sign-sidecar.js` afterPack hook)
14. Generates release notes from the fe commit range; the intentd section references the pinned intentd release
15. Publishes artifacts to `intent-hq/cloudlands-releases`:
    - Creates immutable versioned release: `v{version}`
    - Updates rolling `beta` release tag (clobbers existing assets)
16. Pushes the tag `v{version}` to `cloudlands-fe`, then force-pushes the version-bump commit to a `release/v{version}-version-bump` branch and opens a PR to main (no tags are pushed to `intent-hq/intentd` — it releases on its own cycle)
17. Posts workflow summary with download URLs

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
