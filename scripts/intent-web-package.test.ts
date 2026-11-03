// @verify-changed-triggers: src/main/isolated-test-profile.ts, src/features/backend/main/backend-connection.ts, .github/workflows/publish-intent-web.yml, .github/workflows/intent-web-package.yml, .github/workflows/release-alpha.yml, scripts/fetch-tailcat.cjs, src/features/intent-web/main/intent-web-bin.ts
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIN_NAME,
  PACKAGE_NAME,
  bundle,
  generatedInputs,
  packageManifest,
  readPinnedTailcatVersion,
} from './build-intent-web-package.mjs';
import { MAX_PACKED_BYTES, REQUIRED_FILES, tarballProblems } from './smoke-intent-web-package.mjs';
import { compareVersions, publishPlan } from './intent-web-publish-plan.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load } = updaterRequire('js-yaml');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const readYaml = (file: string) => load(readFileSync(file, 'utf8'));

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
}
interface Job {
  'runs-on'?: string;
  uses?: string;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  with?: Record<string, string>;
  steps?: Step[];
}

describe('@intent-hq/web manifest', () => {
  const app = readJson('package.json');
  const manifest = packageManifest(app);

  it('publishes at the app version with an npx-able bin, engines and license', () => {
    expect(manifest.name).toBe(PACKAGE_NAME);
    expect(manifest.version).toBe(app.version);
    expect(manifest.bin).toEqual({ [BIN_NAME]: 'bin/intent-web.mjs' });
    expect(manifest.engines).toEqual({ node: app.engines.node });
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.type).toBe('module');
    expect(manifest.publishConfig).toEqual({ access: 'public' });
    // Provenance requires the repository to name the publishing repo.
    expect(manifest.repository.url).toBe('git+https://github.com/intent-hq/cloudlands-fe.git');
  });

  it('depends only on ws, at the range the desktop app ships', () => {
    expect(manifest.dependencies).toEqual({ ws: app.dependencies.ws });
    expect(manifest).not.toHaveProperty('devDependencies');
    expect(manifest).not.toHaveProperty('scripts');
  });

  it('fails instead of publishing a manifest without ws or engines', () => {
    expect(() => packageManifest({ ...app, dependencies: {} })).toThrow(/dependency on ws/);
    expect(() => packageManifest({ ...app, engines: undefined })).toThrow(/engines/);
  });

  it('ships only the bundle, the web build and the legal and readme files', () => {
    expect(manifest.files).toEqual(['bin', 'web', 'README.md', 'LICENSE', 'NOTICE']);
  });

  it('reads the tailcat version the desktop app pins', () => {
    const source = readFileSync('scripts/fetch-tailcat.cjs', 'utf8');
    expect(source).toContain(`const TAILCAT_VERSION = '${readPinnedTailcatVersion()}';`);
  });
});

describe('@intent-hq/web bundle on a clean checkout', () => {
  const root = resolve('.');

  it('flags git-ignored generated inputs except the Paraglide output build:web makes', () => {
    const files = [
      'src/main/build-config.generated.ts',
      'src/shared/paraglide/messages.js',
      'src/features/intent-web/main/intent-web-cli.ts',
    ].map((file) => join(root, file));
    expect(
      generatedInputs(root, [...files, join(root, 'node_modules/ws/index.js'), '\0virtual']),
    ).toEqual(['src/main/build-config.generated.ts']);
  });

  // CI failed when the bundle reached src/main/build-config.generated.ts, which
  // exists only after a desktop build step, through backend-connection.ts.
  it('bundles without reading generated desktop build config', async () => {
    const out = mkdtempSync(join(tmpdir(), 'intent-web-bundle-'));
    try {
      const { inputs } = await bundle({
        root,
        outFile: join(out, 'intent-web.mjs'),
        tailcatVersion: '0.0.0-test',
      });
      expect(inputs.some((id: string) => id.includes('isolated-test-profile'))).toBe(true);
      expect(inputs.filter((id: string) => id.includes('build-config.generated'))).toEqual([]);
      expect(generatedInputs(root, inputs)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('@intent-hq/web tarball check', () => {
  const ok = REQUIRED_FILES.map((path) => ({ path })).concat([
    { path: 'web/app/immutable/entry.js' },
    { path: 'web/favicon.png' },
  ]);

  it('accepts a tarball with the required files under the size cap', () => {
    expect(tarballProblems({ files: ok, size: 18 * 1024 * 1024 })).toEqual([]);
  });

  it('reports missing files, sourcemaps, node_modules, strays and size', () => {
    const files = ok
      .filter(({ path }) => path !== 'web/index.html')
      .concat([
        { path: 'bin/intent-web.mjs.map' },
        { path: 'web/node_modules/x/index.js' },
        { path: 'src/main.ts' },
      ]);
    expect(tarballProblems({ files, size: MAX_PACKED_BYTES + 1 })).toEqual([
      'missing web/index.html',
      'sourcemap shipped: bin/intent-web.mjs.map',
      'node_modules shipped: web/node_modules/x/index.js',
      'unexpected file: src/main.ts',
      `packed size ${MAX_PACKED_BYTES + 1} bytes exceeds ${MAX_PACKED_BYTES} bytes`,
    ]);
  });
});

describe('@intent-hq/web publish plan', () => {
  it('orders release and prerelease versions by semver precedence', () => {
    expect(compareVersions('2.275.1', '2.275.1')).toBe(0);
    expect(compareVersions('2.275.10', '2.275.9')).toBeGreaterThan(0);
    expect(compareVersions('2.276.0', '2.275.99')).toBeGreaterThan(0);
    expect(compareVersions('3.0.0-beta.1', '3.0.0')).toBeLessThan(0);
    expect(compareVersions('3.0.0-beta.2', '3.0.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('3.0.0-alpha', '3.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('3.0.0-1', '3.0.0-alpha')).toBeLessThan(0);
    expect(() => compareVersions('v3.0.0', '3.0.0')).toThrow(/semver/);
  });

  it('fails with the bootstrap pointer when the package is not on npm', () => {
    expect(() => publishPlan('2.276.0', null)).toThrow(
      /not on npm yet.*docs\/intent-web-package\.md/,
    );
  });

  it('skips a version that is already published, so reruns are safe', () => {
    expect(publishPlan('2.276.0', { versions: ['2.275.1', '2.276.0'], latest: '2.276.0' })).toEqual(
      { publish: false, reason: '@intent-hq/web@2.276.0 is already published' },
    );
  });

  it('publishes the newest version as latest and never moves latest backwards', () => {
    const registry = { versions: ['2.275.1', '2.277.0'], latest: '2.277.0' };
    expect(publishPlan('2.278.0', registry)).toEqual({ publish: true, distTag: 'latest' });
    expect(publishPlan('2.276.0', registry)).toEqual({ publish: true, distTag: 'backfill' });
    expect(publishPlan('2.276.0', { versions: [], latest: null })).toEqual({
      publish: true,
      distTag: 'latest',
    });
  });

  it('keeps prereleases off latest', () => {
    expect(publishPlan('3.0.0-beta.1', { versions: ['2.276.0'], latest: '2.276.0' })).toEqual({
      publish: true,
      distTag: 'next',
    });
  });
});

describe('publish-intent-web.yml', () => {
  const file = '.github/workflows/publish-intent-web.yml';
  const text = readFileSync(file, 'utf8');
  const workflow = readYaml(file);
  const jobs = workflow.jobs as Record<string, Job>;
  const publish = jobs.publish;
  const steps = publish.steps ?? [];

  it('queues runs so a newer release never drops an older pending publish', () => {
    expect(workflow.concurrency).toEqual({
      group: 'publish-intent-web',
      'cancel-in-progress': false,
      queue: 'max',
    });
  });

  it('runs after each Release Alpha and on manual dispatch with a tag', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: [readYaml('.github/workflows/release-alpha.yml').name],
      types: ['completed'],
    });
    expect(workflow.on.workflow_dispatch.inputs.tag.required).toBe(true);
    expect(jobs.resolve.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(jobs.resolve.if).toContain("github.event.workflow_run.event == 'push'");
  });

  it('publishes the tarball built and smoke-tested from the release tag', () => {
    expect(jobs.package.uses).toBe('./.github/workflows/intent-web-package.yml');
    expect(jobs.package.with).toEqual({ ref: 'refs/tags/${{ needs.resolve.outputs.tag }}' });
    // Only the routing token reaches the build, never every repository secret.
    expect((jobs.package as { secrets?: unknown }).secrets).toEqual({
      CI_QUEUE_READ_TOKEN: '${{ secrets.CI_QUEUE_READ_TOKEN }}',
    });
    expect(readYaml('.github/workflows/intent-web-package.yml').on.workflow_call.secrets).toEqual({
      CI_QUEUE_READ_TOKEN: { required: false },
    });
    expect(publish.needs).toEqual(['resolve', 'package']);
    const download = steps.find((s) => s.uses?.startsWith('actions/download-artifact@'));
    expect(download?.with?.name).toBe('intent-web-package');
  });

  it('uses npm trusted publishing from a GitHub-hosted runner, without a token', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(publish['runs-on']).toBe('ubuntu-24.04');
    // Only the publish job may mint an OIDC token.
    for (const [id, job] of Object.entries(jobs))
      if (id !== 'publish') expect(job.permissions?.['id-token'], id).toBeUndefined();
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(node?.with?.['registry-url']).toBe('https://registry.npmjs.org');
    expect(steps.map((s) => s.run ?? '').join('\n')).toContain('npm install --global npm@^11.5.1');
    const code = text.replace(/^\s*#.*$/gm, '');
    expect(code).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.NPM/);
  });

  it('plans before publishing, publicly, under the planned dist-tag', () => {
    const plan = steps.find((s) => s.run?.includes('scripts/intent-web-publish-plan.mjs'));
    const release = steps.find((s) => s.run?.includes('npm publish'));
    expect(plan).toBeDefined();
    expect(release?.if).toBe("${{ steps.plan.outputs.publish == 'true' }}");
    expect(release?.run).toContain('npm publish "$TARBALL" --access public --tag "$DIST_TAG"');
    expect(steps.indexOf(plan!)).toBeLessThan(steps.indexOf(release!));
  });
});

describe('intent-web-package.yml', () => {
  const workflow = readYaml('.github/workflows/intent-web-package.yml');

  it('runs on pull requests touching the packaging, and as the publish build', () => {
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining([
        'src/features/intent-web/**',
        'scripts/build-intent-web-package.mjs',
        'scripts/smoke-intent-web-package.mjs',
        'package.json',
        'pnpm-lock.yaml',
      ]),
    );
    expect(workflow.on.workflow_call.inputs.ref.required).toBe(true);
  });

  it('builds the web UI and package, then runs the pack smoke test and keeps the tarball', () => {
    const runs = (workflow.jobs.package.steps as Step[]).map((s) => s.run ?? s.uses ?? '');
    const at = (needle: string) => runs.findIndex((r) => r.includes(needle));
    expect(at('pnpm run build:web')).toBeGreaterThan(at('pnpm install --frozen-lockfile'));
    expect(at('pnpm run build:intent-web-package')).toBeGreaterThan(at('pnpm run build:web'));
    expect(at('scripts/smoke-intent-web-package.mjs --pack-destination')).toBeGreaterThan(
      at('pnpm run build:intent-web-package'),
    );
    expect(at('actions/upload-artifact@')).toBeGreaterThan(
      at('scripts/smoke-intent-web-package.mjs'),
    );
  });
});
