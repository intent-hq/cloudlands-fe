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
Alpha, so each alpha publishes the matching npm version under the `latest`
dist-tag. It builds and smoke-tests the tarball on the release tag
(`intent-web-package.yml`), then publishes that tarball from a GitHub-hosted
runner with npm trusted publishing: OIDC, no `NPM_TOKEN`, provenance attached.

- A version that is already on npm is skipped, so reruns are safe.
- To publish a tag again (a failed run, or a Release Alpha rebuilt by hand),
  run the workflow manually with the tag:
  `gh workflow run publish-intent-web.yml --repo intent-hq/cloudlands-fe -f tag=v2.276.0`.
- A tag older than the current `latest` publishes under the `backfill`
  dist-tag, so `latest` never moves backwards.

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
   `npm publish /tmp/intent-web/intent-hq-web-<version>.tgz --access public`.
   npm asks for a one-time password.
3. On npmjs.com, open the package → **Settings** → **Trusted Publisher** and
   add a GitHub Actions publisher:
   - Organization or user: `intent-hq`
   - Repository: `cloudlands-fe`
   - Workflow filename: `publish-intent-web.yml`
   - Environment: leave empty
4. Recommended: in the same settings, under **Publishing access**, choose
   "Require two-factor authentication and disallow tokens". Trusted publishing
   keeps working.
5. Run `publish-intent-web.yml` by hand with the latest release tag to check the
   setup. It publishes that version, or skips it if step 2 already did.
