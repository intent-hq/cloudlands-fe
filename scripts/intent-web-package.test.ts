// @verify-changed-triggers: .github/workflows/intent-pr.yml, src/main/isolated-test-profile.ts, src/features/backend/main/backend-connection.ts, .github/workflows/publish-intent-web.yml, .github/workflows/intent-web-package.yml, .github/workflows/release-alpha.yml, scripts/fetch-tailcat.cjs, src/features/intent-web/main/intent-web-bin.ts
// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIN_NAME,
  PACKAGE_NAME,
  buildIntentWebPackage,
  generatedInputs,
  packageManifest,
  readPinnedTailcatVersion,
} from './build-intent-web-package.mjs';
import { MAX_PACKED_BYTES, REQUIRED_FILES, tarballProblems } from './smoke-intent-web-package.mjs';
import { compareVersions, publishPlan } from './intent-web-publish-plan.mjs';
import {
  CHANNEL_DIST_TAGS,
  channelFeedUrl,
  distTagFailure,
  feedVersion,
  syncPlan,
} from './intent-web-dist-tag-sync.mjs';

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

// The release-fast-path step that decides whether intent-pr.yml must run the
// package job: the `grep -z -E '<pattern>'` it matches changed paths against.
const intentPr = readYaml('.github/workflows/intent-pr.yml');
const relevanceRun: string = intentPr.jobs['release-fast-path'].steps.find(
  (s: { id?: string }) => s.id === 'intent-web-package',
).run;
const relevance = new RegExp(/grep -z -E '([^']+)'/.exec(relevanceRun)![1]);

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
  it('builds without generated desktop config, and the CI Gate covers every input', async () => {
    const work = mkdtempSync(join(tmpdir(), 'intent-web-build-'));
    try {
      const webDir = join(work, 'web');
      mkdirSync(webDir);
      writeFileSync(join(webDir, 'index.html'), '<!doctype html><html></html>');
      const { sourceFiles, bundleInputs } = await buildIntentWebPackage({
        root,
        outDir: join(work, 'package'),
        webDir,
      });
      expect(bundleInputs.some((id: string) => id.includes('isolated-test-profile'))).toBe(true);
      expect(bundleInputs.filter((id: string) => id.includes('build-config.generated'))).toEqual(
        [],
      );
      expect(generatedInputs(root, bundleInputs)).toEqual([]);
      // Every file the package is built from, bundled or copied, must make
      // the CI Gate run the package job when it changes.
      const bundled = bundleInputs
        .filter((id: string) => id.startsWith(`${root}/`) && !id.includes('/node_modules/'))
        .map((id: string) => id.slice(root.length + 1));
      expect(bundled.length).toBeGreaterThan(0);
      expect(sourceFiles).toEqual(
        expect.arrayContaining(['src/features/intent-web/package/README.md', 'LICENSE']),
      );
      expect([...bundled, ...sourceFiles].filter((file) => !relevance.test(file))).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
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
    const registry = { versions: ['2.275.1', '2.276.0'], distTags: { alpha: '2.276.0' } };
    expect(publishPlan('2.276.0', registry)).toEqual({
      publish: false,
      reason: '@intent-hq/web@2.276.0 is already published',
    });
  });

  it('publishes the newest version as alpha and never moves alpha backwards', () => {
    const registry = {
      versions: ['2.275.1', '2.277.0'],
      distTags: { alpha: '2.277.0', latest: '2.270.0' },
    };
    expect(publishPlan('2.278.0', registry)).toEqual({ publish: true, distTag: 'alpha' });
    expect(publishPlan('2.276.0', registry)).toEqual({ publish: true, distTag: 'backfill' });
    expect(publishPlan('2.276.0', { versions: ['2.275.0'], distTags: {} })).toEqual({
      publish: true,
      distTag: 'alpha',
    });
  });

  it('never sets the channel dist-tags latest or beta, even ahead of them', () => {
    // A bootstrap publish leaves latest on an alpha; the next alpha must not follow it.
    const registry = { versions: ['2.276.0'], distTags: { latest: '2.276.0', beta: '2.276.0' } };
    expect(publishPlan('2.277.0', registry)).toEqual({ publish: true, distTag: 'alpha' });
    expect(publishPlan('2.275.0', registry)).toEqual({ publish: true, distTag: 'alpha' });
  });

  it('keeps prereleases on next', () => {
    expect(
      publishPlan('3.0.0-beta.1', { versions: ['2.276.0'], distTags: { alpha: '2.276.0' } }),
    ).toEqual({ publish: true, distTag: 'next' });
  });
});

describe('@intent-hq/web channel dist-tag sync', () => {
  it('maps beta to the beta dist-tag and stable to latest, read from the releases feed', () => {
    expect(CHANNEL_DIST_TAGS).toEqual({ beta: 'beta', stable: 'latest' });
    expect(channelFeedUrl('beta')).toBe(
      'https://github.com/intent-hq/cloudlands-releases/releases/download/beta/latest-mac.yml',
    );
    expect(channelFeedUrl('stable')).toBe(
      'https://github.com/intent-hq/cloudlands-releases/releases/download/stable/latest-mac.yml',
    );
    expect(() => channelFeedUrl('alpha')).toThrow(/Unknown channel/);
  });

  it('reads the version a channel feed serves', () => {
    const feed =
      'files:\r\n  - url: Intent.dmg\r\n    sha512: abc\r\nversion: 2.276.0\r\npath: x\r\n';
    expect(feedVersion(feed)).toBe('2.276.0');
    expect(feedVersion("version: '2.276.1'\n")).toBe('2.276.1');
    expect(() => feedVersion('files: []\n')).toThrow(/no version/);
    expect(() => feedVersion('version: latest\n')).toThrow(/semver/);
  });

  const registry = {
    versions: ['2.274.0', '2.275.0', '2.276.0'],
    distTags: { alpha: '2.276.0', beta: '2.275.0', latest: '2.274.0' },
  };

  it('moves the channel dist-tag forward to the version the channel serves', () => {
    expect(syncPlan('beta', '2.276.0', registry)).toEqual({
      sync: true,
      distTag: 'beta',
      version: '2.276.0',
    });
    expect(syncPlan('stable', '2.275.0', registry)).toEqual({
      sync: true,
      distTag: 'latest',
      version: '2.275.0',
    });
    expect(
      syncPlan('beta', '2.276.0', { versions: ['2.276.0'], distTags: { alpha: '2.276.0' } }),
    ).toEqual({ sync: true, distTag: 'beta', version: '2.276.0' });
  });

  it('is a no-op when the dist-tag already points at the channel version', () => {
    expect(syncPlan('beta', '2.275.0', registry)).toEqual({
      sync: false,
      reason: 'beta already points at @intent-hq/web@2.275.0',
    });
  });

  it('never moves a dist-tag backwards', () => {
    expect(
      syncPlan('stable', '2.273.0', { ...registry, versions: ['2.273.0', ...registry.versions] }),
    ).toEqual({
      sync: false,
      reason:
        'latest points at @intent-hq/web@2.274.0, newer than the stable channel version 2.273.0; dist-tags never move backwards',
    });
  });

  it('skips a channel version that is not on npm, e.g. older than the first publish', () => {
    expect(syncPlan('stable', '2.200.0', registry)).toEqual({
      sync: false,
      reason: '@intent-hq/web@2.200.0 (stable) is not on npm',
    });
    expect(syncPlan('beta', '2.276.0', null)).toEqual({
      sync: false,
      reason: '@intent-hq/web is not on npm yet',
    });
  });

  it('names the trusted publisher setting and the manual fallback when npm rejects the tag', () => {
    const message = distTagFailure('2.276.0', 'beta');
    expect(message).toContain('Check "Allow npm dist-tag" under Allowed actions');
    expect(message).toContain('Settings → Trusted Publisher');
    expect(message).toContain(
      'https://github.blog/changelog/2026-09-30-opt-in-dist-tag-permissions-for-npm-trusted-publishing/',
    );
    expect(message).toContain('npm dist-tag add @intent-hq/web@2.276.0 beta');
    expect(message).toContain('docs/intent-web-package.md');
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

  const workflowName = (name: string) => readYaml(`.github/workflows/${name}.yml`).name;

  it('runs after each Release Alpha, Promote Beta and Release Stable, and on manual dispatch', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: [
        workflowName('release-alpha'),
        workflowName('promote-beta'),
        workflowName('release-stable'),
      ],
      types: ['completed'],
    });
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.tag.required).toBe(false);
    expect(inputs.channel).toMatchObject({ type: 'choice', options: ['none', 'beta', 'stable'] });
    expect(inputs.channel.default).toBe('none');
  });

  it('publishes only for successful tag-push Release Alpha runs or a dispatched tag', () => {
    expect(jobs.resolve.if).toContain("github.event.workflow_run.name == 'Release Alpha'");
    expect(jobs.resolve.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(jobs.resolve.if).toContain("github.event.workflow_run.event == 'push'");
    expect(jobs.resolve.if).toContain("inputs.tag != ''");
  });

  describe('channel sync job', () => {
    const sync = jobs['sync-channel'];
    const syncSteps = sync?.steps ?? [];

    it('runs after a successful Promote Beta or Release Stable, or a dispatched channel', () => {
      expect(sync).toBeDefined();
      expect(sync.needs).toBeUndefined();
      expect(sync.if).toContain("github.event.workflow_run.conclusion == 'success'");
      expect(sync.if).toContain("github.event.workflow_run.name == 'Promote Beta'");
      expect(sync.if).toContain("github.event.workflow_run.name == 'Release Stable'");
      expect(sync.if).toContain("inputs.channel != 'none'");
      const channel = syncSteps.find((s) => s.run?.includes('CHANNEL='));
      expect(channel?.run).toContain('beta');
      expect(channel?.run).toContain('stable');
    });

    it('checks out only the publication tools from the workflow commit', () => {
      const checkout = syncSteps.find((s) => s.uses?.startsWith('actions/checkout@'));
      expect(checkout?.with?.ref).toBe('${{ github.workflow_sha }}');
      expect(String(checkout?.with?.['persist-credentials'])).toBe('false');
      expect(checkout?.with?.['sparse-checkout']).toContain('scripts/intent-web-dist-tag-sync.mjs');
    });

    it('plans from the channel feed, then moves the dist-tag with trusted publishing', () => {
      expect(sync.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
      expect(sync['runs-on']).toBe('ubuntu-24.04');
      const plan = syncSteps.find((s) =>
        s.run?.includes('scripts/intent-web-dist-tag-sync.mjs "$CHANNEL"'),
      );
      const move = syncSteps.find((s) => s.run?.includes('npm dist-tag add'));
      expect(plan).toBeDefined();
      expect(move?.if).toBe("${{ steps.sync.outputs.sync == 'true' }}");
      expect(move?.run).toContain('npm dist-tag add "@intent-hq/web@${VERSION}" "$DIST_TAG"');
      // The failure message has one source: the script's distTagFailure.
      expect(move?.run).toContain(
        'node scripts/intent-web-dist-tag-sync.mjs --failure "$VERSION" "$DIST_TAG"',
      );
      expect(move?.run).not.toContain('Allow npm dist-tag');
      expect(syncSteps.indexOf(plan!)).toBeLessThan(syncSteps.indexOf(move!));
      // npm runs the OIDC exchange for `npm dist-tag` only from 11.21.0.
      const runs = syncSteps.map((s) => s.run ?? '').join('\n');
      expect(runs).toContain('npm install --global npm@^11.21.0');
      expect(runs).toContain('npm --version');
    });
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
    // Only the jobs that talk to npm may mint an OIDC token; neither runs code
    // built from the release tag.
    for (const [id, job] of Object.entries(jobs))
      if (id !== 'publish' && id !== 'sync-channel')
        expect(job.permissions?.['id-token'], id).toBeUndefined();
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(node?.with?.['registry-url']).toBe('https://registry.npmjs.org');
    expect(steps.map((s) => s.run ?? '').join('\n')).toContain('npm install --global npm@^11.21.0');
    const code = text.replace(/^\s*#.*$/gm, '');
    expect(code).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.NPM/);
  });

  it('plans before publishing, publicly, under the planned dist-tag', () => {
    const plan = steps.find((s) => s.run?.includes('scripts/intent-web-publish-plan.mjs'));
    const release = steps.find((s) => s.run?.includes('npm publish'));
    // A trusted publisher without "Allow npm publish" rejects the publish;
    // the error names that checkbox instead of a bare npm auth failure.
    expect(release?.run).toContain('if ! npm publish "$TARBALL"');
    expect(release?.run).toContain('Check \\"Allow npm publish\\" under Allowed actions');
    expect(plan).toBeDefined();
    expect(release?.if).toBe("${{ steps.plan.outputs.publish == 'true' }}");
    expect(release?.run).toContain('npm publish "$TARBALL" --access public --tag "$DIST_TAG"');
    expect(steps.indexOf(plan!)).toBeLessThan(steps.indexOf(release!));
  });
});

describe('intent-web-package.yml', () => {
  const workflow = readYaml('.github/workflows/intent-web-package.yml');

  it('is a reusable build: only the CI Gate job and the publish workflow start it', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
    expect(workflow.on.workflow_call.inputs.ref.required).toBe(true);
  });

  it('is required by the CI Gate on PRs and queue entries that reach the package', () => {
    const job = intentPr.jobs['intent-web-package'] as Job & { secrets?: unknown };
    expect(job.uses).toBe('./.github/workflows/intent-web-package.yml');
    expect(job.with).toEqual({ ref: '${{ github.event.pull_request.head.sha || github.sha }}' });
    expect(job.secrets).toEqual({ CI_QUEUE_READ_TOKEN: '${{ secrets.CI_QUEUE_READ_TOKEN }}' });
    expect(intentPr.jobs.gate.needs).toContain('intent-web-package');
    for (const file of [
      'scripts/build-intent-web-package.mjs',
      'scripts/smoke-intent-web-package.mjs',
      'scripts/intent-web-publish-plan.mjs',
      'scripts/intent-web-dist-tag-sync.mjs',
      'scripts/fetch-tailcat.cjs',
      'package.json',
      'pnpm-lock.yaml',
      'vite.config.mjs',
      'LICENSE',
      '.github/workflows/intent-web-package.yml',
      '.github/workflows/publish-intent-web.yml',
    ])
      expect(relevance.test(file), file).toBe(true);
    for (const file of ['src/lib/components/ui/button/button.svelte', 'docs/DESIGN_SYSTEM.md'])
      expect(relevance.test(file), file).toBe(false);
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
