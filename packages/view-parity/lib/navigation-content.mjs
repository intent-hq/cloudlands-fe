import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
export {
  expectCode,
  expectNumberedRows,
  expectHit,
  clipboardPermission,
  nativeCopy,
} from './chat-reference.mjs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Ignored preparation only. No candidate module is imported or executed here.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function loadOriginalOracle(root, origin) {
  const source = (file) =>
    execFileSync('git', ['show', `${original}:${file}`], { cwd: root, encoding: 'utf8' });
  const targetsPath = 'src/shared/app-ui-targets.ts';
  const modifiersPath = 'src/shared/utils/link-helpers.ts';
  const navPath = 'src/lib/components/chat/NavLink.svelte';
  const targetsText = source(targetsPath);
  const modifiersText = source(modifiersPath);
  const navText = source(navPath);
  const sources = {
    [targetsPath]: digest(targetsText),
    [modifiersPath]: digest(modifiersText),
    [navPath]: digest(navText),
  };

  const prepare = (text, name) => {
    const erased = stripTypeScriptTypes(text, { mode: 'strip', sourceUrl: `${original}/${name}` });
    // Only export declarations are unwrapped for an isolated VM. A remaining
    // import is a hard failure, never resolved from candidate dependencies.
    assert.doesNotMatch(erased, /^\s*import\b/m, `Uncontrolled dependency in ${name}`);
    return erased.replace(/^export (?=function |const )/gm, '');
  };
  const context = vm.createContext({
    URL,
    window: Object.freeze({ location: Object.freeze({ origin }) }),
  });
  vm.runInContext(prepare(targetsText, targetsPath), context, { timeout: 1000 });
  vm.runInContext(prepare(modifiersText, modifiersPath), context, { timeout: 1000 });
  const start = navText.indexOf('  function getHighlightIdFromTarget(');
  const end = navText.indexOf('\n\n  async function handleClick(', start);
  assert.ok(start >= 0 && end > start, 'Immutable NavLink helper boundary missing');
  const highlightText = navText.slice(start, end);
  assert.equal((highlightText.match(/function getHighlightIdFromTarget/g) ?? []).length, 1);
  vm.runInContext(prepare(highlightText, navPath), context, { timeout: 1000 });

  return {
    evidence: {
      original,
      sources,
      highlightFunctionSha256: digest(highlightText),
      node: process.version,
      transformation: 'Node stripTypeScriptTypes mode=strip; export keyword removal only',
      dependencies:
        'Original app-ui-targets resolver, native URL, explicit origin; no candidate code',
    },
    admission: (target) => context.isResolvableNavTarget(target),
    highlight: (target) => context.getHighlightIdFromTarget(target),
    platformModifier: (flags, platform) =>
      context.isCmdClickModifier({ modifiers: flags }, platform),
  };
}

const ownFiles = [
  'packages/view-parity/lib/navigation-content.mjs',
  'packages/view-parity/tests/navigation-content.core.spec.mjs',
  'packages/view-parity/tests/navigation-content.extended.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
  ...[
    'functional',
    'manifest',
    'provenance',
    'browser',
    'agent-avatar',
    'compare',
    'chat-reference',
    'chat-transcript',
  ].map((name) => `packages/view-parity/lib/${name}.mjs`),
  'packages/view-parity/playwright.config.mjs',
  'packages/view-parity/scripts/run.mjs',
  'packages/view-parity/package.json',
  'pnpm-lock.yaml',
];
const originalSources = [
  'src/lib/components/editor/AugmentCodeSnippet.svelte',
  'src/shared/app-ui-targets.ts',
  'src/shared/utils/link-helpers.ts',
  'src/lib/utils/code-highlighter.ts',
  'src/lib/components/ui/CopyButton.svelte',
];
const profileFiles = [
  'apps/react/src/features/chat/components/nav-link.tsx',
  'apps/react/src/components/editor/augment-code-snippet.tsx',
  'apps/react/src/components/editor/code-block.tsx',
  'apps/react/src/components/ui/copy-button.tsx',
  'apps/react/src/catalog/navigation-content-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/store/ui-highlight/ui-highlight-selectors.ts',
  'apps/react/src/components/patterns/settings/highlight-target.ts',
  'src/lib/components/chat/NavLink.svelte',
  'src/lib/components/chat/nav-link-target.ts',
  'src/lib/components/editor/CodeBlock.svelte',
  'src/store/renderer/slices/ui-highlight/ui-highlight-slice.ts',
];
const generatedFiles = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (files, sha) =>
  Object.fromEntries(
    files.map((file) => [
      file,
      digest(execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot })),
    ]),
  );

export const test = base.extend({
  navigationFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_NAVIGATION_CONTENT_APPROVED, 'Exact native release required').toBe(
        '1',
      );
      const sha = process.env.PARITY_NAVIGATION_CONTENT_SHA;
      const testSha = process.env.PARITY_NAVIGATION_CONTENT_TEST_SHA;
      const root = process.env.PARITY_CANDIDATE_ROOT;
      const url = process.env.PARITY_CANDIDATE_URL;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
      expect(info.retry).toBe(0);
      expect(realpathSync(root)).not.toBe(realpathSync(repoRoot));
      const snapshot = () => ({
        runner: hashes(runnerFiles),
        source: hashes(originalSources, root),
        profile: hashes(profileFiles, root),
        generated: hashes(generatedFiles, root),
        candidate: candidateProvenance(root),
      });
      const before = snapshot();
      expect(before.runner).toEqual(committed(runnerFiles, testSha));
      expect(before.source).toEqual(committed(originalSources, original));
      expect(before.profile).toEqual(committed(profileFiles, sha));
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      try {
        await use();
      } finally {
        const after = snapshot();
        await info.attach('navigation-content-freeze.json', {
          body: JSON.stringify({ original, sha, testSha, root, url, before, after }, null, 2),
          contentType: 'application/json',
        });
        expect(after).toEqual(before);
      }
    },
    { auto: true },
  ],
  navigationNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('navigation-content-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
        if (!page.isClosed())
          await info.attach('navigation-content-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="navigation-content"] output')
                .allTextContents(),
              null,
              2,
            ),
            contentType: 'application/json',
          });
      }
    },
    { auto: true },
  ],
});
export { expect, outputJson };
export const field = (host, name) => host.getByLabel(name, { exact: true });
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const frame = (host, kind) => host.getByTestId(`${kind}-frame`);
export const nav = (host) => host.getByTestId('navigation-link');
export const excerpt = (host) => host.getByTestId('code-excerpt');
export const snippetFileButton = (host) => frame(host, 'code-excerpt').locator('button[title]');
export async function observations(host, kind) {
  await button(host, `Refresh ${kind} observations`).click();
  return outputJson(field(host, `${kind} observations`));
}
export async function clear(host, kind) {
  await button(host, `Clear ${kind} observations`).click();
}
export async function toggle(host, name, checked) {
  const control = host.getByRole('switch', { name, exact: true });
  if ((await control.getAttribute('aria-checked')) !== String(checked)) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(checked));
}
export async function choose(host, name, value) {
  const control = host
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'true');
}
export async function openContent(page) {
  const host = await openExample(page, 'navigation-content', 'navigation-content');
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemon: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: window.innerWidth,
      height: window.innerHeight,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })),
  ).toEqual({ preload: 'undefined', daemon: null, width: 420, height: 900, reduced: true });
  return host;
}
export async function oracle(page, info) {
  const result = loadOriginalOracle(repoRoot, new URL(page.url()).origin);
  await info.attach('navigation-original-oracle.json', {
    body: JSON.stringify(result.evidence, null, 2),
    contentType: 'application/json',
  });
  return result;
}
export async function callback(host, kind, name, activate, { revision = 0, mount = 0 } = {}) {
  const before = await observations(host, kind);
  await activate();
  const after = await observations(host, kind);
  expect(after.counts[name] ?? 0).toBe((before.counts[name] ?? 0) + 1);
  const record = after.callbacks.filter((entry) => entry.name === name).at(-1);
  expect(record).toMatchObject({ name, callbackRevision: revision, mountRevision: mount });
  return { record, observations: after };
}
export function expectLinkCall(
  record,
  {
    target,
    workspace = 'catalog-workspace-a',
    gate = true,
    type = 'click',
    ctrl = false,
    meta = false,
    detail = 1,
    phase = 3,
  },
) {
  expect(record.argumentCount).toBe(2);
  expect(record.arguments[0]).toBe(target);
  const options = record.arguments[1];
  expect(Object.keys(options).sort()).toEqual(['canOpenFile', 'event', 'workspaceId']);
  expect(options.workspaceId).toBe(workspace);
  expect(record.sameAsCurrentFileGate).toBe(true);
  if (gate)
    expect(options.canOpenFile).toEqual({ kind: 'function', objectId: record.currentFileGateId });
  else expect(options.canOpenFile).toBe('[undefined]');
  expect(options.event).toMatchObject({
    kind: 'native',
    type,
    isTrusted: true,
    eventPhase: phase,
    defaultPrevented: true,
    sameAsCapturedEvent: true,
    ctrlKey: ctrl,
    metaKey: meta,
    currentTarget: { tag: 'A' },
  });
  expect(options.event.objectId).toBe(record.lastCapturedEvent.objectId);
  if (type === 'click') expect(options.event.detail).toBe(detail);
  else expect(options.event.key).toBe('Enter');
}
export async function detached(handle) {
  await expect.poll(() => handle.evaluate((node) => node.isConnected)).toBe(false);
}

export async function capture(page, target, name, info) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const probe = async () => ({
    aria: await target.ariaSnapshot(),
    geometry: await target.evaluate((root) => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        frame: box(root),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        nodes: [...root.querySelectorAll('button,a,img,video,math,pre,table,[role]')].map(
          (node) => ({
            tag: node.localName,
            text: node.textContent,
            bounds: box(node),
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
          }),
        ),
      };
    }),
  });
  const before = await probe();
  const png = await stableLocatorScreenshot(
    page,
    target,
    async ({ png: attemptPng, ...attempt }) => {
      if (attemptPng)
        await info.attach(`${name}-attempt-${attempt.attempt}.png`, {
          body: attemptPng,
          contentType: 'image/png',
        });
      await info.attach(`${name}-attempt-${attempt.attempt}.json`, {
        body: JSON.stringify(
          { ...attempt, sha256: attemptPng ? digest(attemptPng) : null },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    },
  );
  const after = await probe();
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  await info.attach(`${name}-geometry-ax.json`, {
    body: JSON.stringify({ before, after, sha256: digest(png) }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capture must not alter geometry or semantics').toEqual(before);
}
