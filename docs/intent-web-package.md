# Publishing @intent-hq/web

`@intent-hq/web` is the standalone browser server (`npx @intent-hq/web`); the
user guide is [Run Intent Web on a cloud machine](./intent-web.md). It
contains the web UI build (`web/`), the server and CLI bundled into
`bin/intent-web.mjs`, and one runtime dependency, `ws`. Its version is always
the cloudlands-fe version.

| Piece           | Where                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package build   | `pnpm run build:web && pnpm run build:intent-web-package` → `dist/intent-web-package` (`scripts/build-intent-web-package.mjs`)                         |
| Pack smoke test | `pnpm run smoke:intent-web-package` (`scripts/smoke-intent-web-package.mjs`)                                                                           |
| PR check        | `intent-pr.yml` job `intent-web-package` (calls `.github/workflows/intent-web-package.yml`), required by the CI Gate when the diff reaches the package |
| Publish         | `.github/workflows/publish-intent-web.yml`                                                                                                             |
| npm README      | `src/features/intent-web/package/README.md`                                                                                                            |

## How releases publish

`publish-intent-web.yml` runs after every successful tag-push run of Release
Alpha and publishes the matching npm version. It builds and smoke-tests the
tarball on the release tag (`intent-web-package.yml`), then publishes that
tarball from a GitHub-hosted runner with npm trusted publishing: OIDC, no
`NPM_TOKEN`, provenance attached.

- A version that is already on npm is skipped, so reruns are safe.
- To publish a tag again (a failed run, or a Release Alpha rebuilt by hand),
  run the workflow manually with the tag:
  `gh workflow run publish-intent-web.yml --repo intent-hq/cloudlands-fe -f tag=v2.276.0`.

## Dist-tags follow the release channels

| Dist-tag   | Points at                                 | Moved by                                              |
| ---------- | ----------------------------------------- | ----------------------------------------------------- |
| `alpha`    | the newest published alpha                | each publish (`scripts/intent-web-publish-plan.mjs`)  |
| `beta`     | the version the beta channel serves       | a successful Promote Beta run                         |
| `latest`   | the version the stable channel serves     | a successful Release Stable run                       |
| `backfill` | a tag older than `alpha`, published later | a publish by hand of an old tag, so `alpha` stays put |
| `next`     | a prerelease version                      | a publish of a prerelease tag                         |

So `npx @intent-hq/web` runs the stable version, and `@intent-hq/web@beta` or
`@intent-hq/web@alpha` the other channels. A publish never sets `beta` or
`latest`.

After a successful Promote Beta or Release Stable run, the workflow's
`sync-channel` job reads the version that channel now serves from its feed on
intent-hq/cloudlands-releases (`beta/latest-mac.yml`, `stable/latest-mac.yml`)
and moves the dist-tag there with `npm dist-tag add`
(`scripts/intent-web-dist-tag-sync.mjs`). The feed is the source of truth, so a
sync is safe to rerun and also repairs a missed one. To sync a channel by hand:
`gh workflow run publish-intent-web.yml --repo intent-hq/cloudlands-fe -f channel=stable`.

- No dist-tag ever moves backwards; a sync that would is skipped with a notice.
- A channel version that is not on npm (older than the first publish) is
  skipped with a notice.
- If npm rejects the change, the job fails naming the trusted publisher's
  **Allow `npm dist-tag`** setting (below). Until it is enabled, an `@intent-hq` owner can
  move the tag by hand: `npm dist-tag add @intent-hq/web@<version> <beta|latest>`.

## One-time bootstrap

Trusted publishing cannot create a package, so the first version is published
by hand. Until then the workflow fails with "@intent-hq/web is not on npm yet".

1. Get the tarball: download the `intent-web-package` artifact from a green
   run of the **Intent Web package** workflow on `main` (run it with
   `gh workflow run intent-web-package.yml --repo intent-hq/cloudlands-fe`), or
   build it locally:

   ```sh
   pnpm run build:web
   pnpm run build:intent-web-package
   node scripts/smoke-intent-web-package.mjs --pack-destination /tmp/intent-web
   ```

2. Sign in as an owner of the `@intent-hq` npm org with 2FA enabled
   (`npm login`), then publish:
   `npm publish /tmp/intent-web/intent-hq-web-<version>.tgz --access public --tag alpha`.
   npm asks for a one-time password. npm may stage the first publish instead
   of releasing it: the package page then shows only a `0.0.0-stage`
   placeholder. Approve the staged version (npm 11.15.0 or later; asks for a
   one-time password): `npm stage list @intent-hq/web`, then
   `npm stage approve <stage-id>`, or approve it on npmjs.com.
   Check the result with `npm view @intent-hq/web dist-tags`: it must list the
   version under `alpha`. If `latest` still points at `0.0.0-stage`, move it so
   a plain `npx @intent-hq/web` does not install the placeholder:
   `npm dist-tag add @intent-hq/web@<version> latest`. `latest` then stays on
   that alpha until a stable sync moves it to a newer stable version (tags
   never move backwards).
3. On npmjs.com, open the package → **Settings** → **Trusted Publisher** and
   add a GitHub Actions publisher:
   - Organization or user: `intent-hq`
   - Repository: `cloudlands-fe`
   - Workflow filename: `publish-intent-web.yml`
   - Environment: leave empty
   - Under **Allowed actions**, check both boxes (only `npm stage publish`
     is allowed by default):
     - **Allow `npm publish`**, so each alpha publishes. Without it the
       publish job fails and names this setting.
     - **Allow `npm dist-tag`**, so the channel sync can move `beta` and
       `latest`
       ([GitHub changelog of 2026-09-30](https://github.blog/changelog/2026-09-30-opt-in-dist-tag-permissions-for-npm-trusted-publishing/)).
       Without it the sync fails and the tags must be moved by hand (see above).

   These fields cannot be edited once the connection exists; to change one,
   delete the connection and create it again.

4. Recommended: in the same settings, under **Publishing access**, choose
   "Require two-factor authentication and disallow tokens". Trusted publishing
   keeps working.
5. npm marks a new trusted publisher "Pending validation" until it publishes
   once (within about two days). The next Release Alpha publishes through it
   and validates it. Running `publish-intent-web.yml` by hand for the version
   step 2 published only skips, so it does not validate the publisher.
