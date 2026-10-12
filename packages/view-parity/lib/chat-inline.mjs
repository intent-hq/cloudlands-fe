import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Original source is the oracle. Real caller inputs do not establish paired
// source images, remote-image behavior, full motion or pending-job cancellation.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourceFiles = [
  'src/lib/components/chat/InlineMarkdownSnippet.svelte',
  'src/lib/components/chat/inline-markdown-snippet.ts',
  'src/lib/utils/markdown-processor.ts',
  'src/lib/utils/markdown-worker.ts',
  'src/lib/utils/html-sanitizer.ts',
  'src/lib/components/settings/mcp/McpIcon.svelte',
  'src/lib/icons/phosphor-icons.ts',
  'src/lib/components/shared/icons/fa-proxy.ts',
  'src/lib/components/shared/icons/FaWrapper.svelte',
];
// Keep pristine003 hashes separately from the released canonical map extraction.
const extractedSources = new Set([
  'src/lib/components/settings/mcp/McpIcon.svelte',
  'src/lib/icons/phosphor-icons.ts',
]);
const ownFiles = [
  'packages/view-parity/lib/chat-inline.mjs',
  'packages/view-parity/tests/chat-inline.core.spec.mjs',
  'packages/view-parity/tests/chat-inline.extended.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
  'packages/view-parity/lib/chat-transcript.mjs',
  'packages/view-parity/lib/functional.mjs',
  'packages/view-parity/lib/browser.mjs',
  'packages/view-parity/lib/provenance.mjs',
  'packages/view-parity/lib/manifest.mjs',
  'packages/view-parity/lib/agent-avatar.mjs',
  'packages/view-parity/lib/compare.mjs',
  'packages/view-parity/playwright.config.mjs',
  'packages/view-parity/scripts/run.mjs',
  'packages/view-parity/package.json',
  'pnpm-lock.yaml',
  'node_modules/phosphor-svelte/package.json',
  'node_modules/phosphor-svelte/lib/BrainIcon.svelte',
  'node_modules/phosphor-svelte/lib/HardDrivesIcon.svelte',
  'node_modules/phosphor-svelte/lib/DatabaseIcon.svelte',
  'node_modules/phosphor-svelte/lib/CloudIcon.svelte',
  'node_modules/phosphor-svelte/lib/GearIcon.svelte',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = (files) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(repoRoot, file)))]));
const committedHashes = (files, sha) =>
  Object.fromEntries(
    files.map((file) => [
      file,
      digest(execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot })),
    ]),
  );

export const test = base.extend({
  inlineFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_INLINE_APPROVED,
        'Coordinator must release the exact committed tests, independent candidate, dependencies and URL',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_INLINE_SHA;
      const testSha = process.env.PARITY_CHAT_INLINE_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retries are authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Never execute the shared editing checkout').not.toBe(
        realpathSync(repoRoot),
      );
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = hashes(runnerFiles);
      const sourceBefore = hashes(sourceFiles);
      expect(hashes(ownFiles), 'Tests must match the released committed test freeze').toEqual(
        committedHashes(ownFiles, testSha),
      );
      const originalHashes = committedHashes(sourceFiles, original);
      const unchanged = sourceFiles.filter((file) => !extractedSources.has(file));
      expect(hashes(unchanged), 'Unextracted original sources must remain unchanged').toEqual(
        committedHashes(unchanged, original),
      );
      expect(sourceBefore, 'Current source bindings must match the released extraction').toEqual(
        committedHashes(sourceFiles, sha),
      );
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(sourceFiles);
        const candidateAfter = candidateProvenance(root);
        await info.attach('chat-inline-freeze.json', {
          body: JSON.stringify(
            {
              original,
              originalHashes,
              sha,
              testSha,
              root,
              before,
              after,
              sourceBefore,
              sourceAfter,
              candidate,
              candidateAfter,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after, 'Verification code changed during the attempt').toEqual(before);
        expect(sourceAfter).toEqual(sourceBefore);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  inlineNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('chat-inline-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  inlineObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          await info.attach('chat-inline-observations.json', {
            body: JSON.stringify(
              await page.locator('[data-functional-example="chat-inline"] pre').allTextContents(),
              null,
              2,
            ),
            contentType: 'application/json',
          });
        }
      }
    },
    { auto: true },
  ],
});

export { expect };

export async function captureInline(page, frame, name, info) {
  const measure = () =>
    frame.evaluate((root) => {
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        root: rect(root),
        content: [...root.querySelectorAll('div, span, strong, em, code, svg, img')].map(
          (node) => ({ tag: node.localName, bounds: rect(node) }),
        ),
      };
    });
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const before = await measure();
  await captureTranscript(page, frame, name, info);
  const after = await measure();
  await info.attach(name + '-content-geometry.json', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'The observed content must not move during capture').toEqual(before);
}

export async function openInline(page) {
  const host = await openExample(page, 'chat-inline', 'chat-inline');
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemonUrl: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
    })),
  ).toEqual({
    preload: 'undefined',
    daemonUrl: null,
    width: 420,
    height: 900,
    reduced: true,
    dark: false,
  });
  await page.evaluate(() => document.fonts.ready);
  return host;
}

export function exercise(host, kind) {
  const section = host.getByTestId(`inline-${kind}`);
  return {
    section,
    frame: section.getByTestId(`inline-${kind}-frame`),
    leaf: section.getByTestId(`inline-${kind}-leaf`),
    state: () => outputJson(section.getByTestId(`inline-${kind}-state`)),
  };
}

export const field = (section, name) => section.getByRole('textbox', { name, exact: true });
export const numberField = (section, name) =>
  section.getByRole('spinbutton', { name, exact: true });
export const button = (section, name) => section.getByRole('button', { name, exact: true });
export const markdown = (item) => item.leaf.getByTestId('inline-markdown-content');
export const limit = (item) =>
  numberField(item.section, 'Maximum visible characters, blank for default');
export const icon = (item) => item.leaf.locator(':scope > div');

export async function mount(item, name, checked) {
  const control = item.section.getByRole('switch', { name: 'Mount ' + name, exact: true });
  if ((await control.isChecked()) !== checked) await control.press('Space');
  await expect(control).toBeChecked({ checked });
  await expect(item.leaf).toHaveCount(checked ? 1 : 0);
}

export async function applyIcon(item, name, key) {
  await field(item.section, 'Icon name').fill(name);
  const apply = button(item.section, 'Apply icon name');
  if (key) await apply.press(key);
  else await apply.click();
}

export async function expectInline(item, text, semantics = []) {
  const leaf = markdown(item);
  await expect(leaf).toHaveText(text);
  await expect
    .poll(() =>
      leaf.evaluate((node) =>
        [...node.querySelectorAll('*')].map((child) => ({
          tag: child.localName,
          text: child.textContent,
          attributes: [...child.attributes].map((attribute) => attribute.name),
        })),
      ),
    )
    .toEqual(semantics.map(([tag, value]) => ({ tag, text: value, attributes: [] })));
  // No links, focusable controls, media, script or event attributes can survive
  // this inert projection. Expected semantics come from independent fixed cases.
  await expect(leaf.getByRole('link')).toHaveCount(0);
  await expect(
    leaf.locator('a, img, video, audio, iframe, script, button, input, table, pre, [tabindex]'),
  ).toHaveCount(0);
}

const originalText = (file) =>
  execFileSync('git', ['show', original + ':' + file], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

function originalArtwork(name) {
  const source = originalText('src/lib/components/settings/mcp/McpIcon.svelte');
  const inlineTable = source.split('const customIconSvgs:')[1].split('\n  };')[0];
  const inline = [...inlineTable.matchAll(/\s+(\w+):\s*'([^']+)'/g)].find(
    (entry) => entry[1] === name,
  )?.[2];
  if (inline) return { sourceHash: digest(source), body: inline, inline: true };

  // Original Vite aliases, not the misleading package import spelling,
  // determine the renderer. Never import a candidate icon as the oracle.
  const vite = originalText('vite.config.mjs');
  expect(vite.includes('src/lib/icons/phosphor-icons.ts')).toBe(true);
  expect(vite.includes('src/lib/components/shared/icons/fa-proxy.ts')).toBe(true);
  const table = source.split('const faIconMap:')[1].split('\n  };')[0];
  const definition = [...table.matchAll(/\s+(\w+):\s*(fa\w+),/g)].find(
    (entry) => entry[1] === name,
  )?.[2];
  expect(definition).toBeTruthy();
  const mapping = originalText('src/lib/icons/phosphor-icons.ts');
  const definitionName = mapping.match(
    new RegExp('export const ' + definition + " = icon\\('([^']+)'\\)"),
  )?.[1];
  expect(definitionName).toBeTruthy();
  const symbols = mapping.split('const iconComponents:')[1].split('\n};')[0];
  const symbol = [...symbols.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
    (entry) => (entry[1] || entry[2]) === definitionName,
  )?.[3];
  expect(symbol).toBeTruthy();
  const packagePath = 'node_modules/phosphor-svelte/package.json';
  const version = JSON.parse(readFileSync(path.join(repoRoot, packagePath), 'utf8')).version;
  expect(originalText('pnpm-lock.yaml').includes('phosphor-svelte@' + version + ':')).toBe(true);
  const assetPath = 'node_modules/phosphor-svelte/lib/' + symbol + '.svelte';
  const asset = readFileSync(path.join(repoRoot, assetPath), 'utf8');
  const body = asset.split('weight === "regular"}')[1]?.split('{:')[0];
  expect(body).toBeTruthy();
  return {
    sourceHash: digest(source),
    mappingHash: digest(mapping),
    viteHash: digest(vite),
    definition,
    definitionName,
    symbol,
    packagePath,
    version,
    assetPath,
    assetHash: digest(asset),
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + body + '</svg>',
    inline: false,
  };
}

export async function expectArtwork(item, name, info) {
  const expected = originalArtwork(name);
  const svg = icon(item).locator('svg');
  await expect(svg).toHaveCount(1);
  const observed = await svg.evaluate((node, source) => {
    const tree = new DOMParser().parseFromString(source, 'image/svg+xml');
    const shapes = (root) =>
      [...root.querySelectorAll('path, circle, ellipse, line, polyline, polygon, rect')]
        .filter((shape) => !(shape.localName === 'rect' && shape.getAttribute('fill') === 'none'))
        .map((shape) => ({
          tag: shape.localName,
          attributes: Object.fromEntries(
            [...shape.attributes]
              .map((attribute) => [attribute.name, attribute.value])
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        }));
    return {
      actual: shapes(node),
      expected: shapes(tree),
      viewBox: node.getAttribute('viewBox'),
      expectedViewBox: tree.documentElement.getAttribute('viewBox'),
      role: node.getAttribute('role'),
      hidden: node.getAttribute('aria-hidden'),
      label: node.getAttribute('aria-label'),
      parseError: !!tree.querySelector('parsererror'),
    };
  }, expected.body);
  await info.attach('artwork-' + name + '.json', {
    body: JSON.stringify(
      { original, ...expected, observed, aria: await item.frame.ariaSnapshot() },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.role).toBe(expected.inline ? null : 'img');
  expect(observed.hidden).toBe(expected.inline ? null : 'true');
  expect(observed.label).toBeNull();
  await expect(item.leaf.getByRole('img')).toHaveCount(expected.inline ? 1 : 0);
  if (expected.assetPath)
    expect(digest(readFileSync(path.join(repoRoot, expected.assetPath)))).toBe(expected.assetHash);
}

export async function expectInitial(item, initial) {
  await expect(icon(item)).toHaveText(initial);
  await expect(icon(item).locator('svg, img')).toHaveCount(0);
}

export async function iconGeometry(item, size, info, name) {
  const measured = await icon(item).evaluate((root) => {
    const bounds = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const child = root.querySelector('svg, img, span');
    return { root: bounds(root), child: child ? bounds(child) : null };
  });
  await info.attach(name + '-geometry.json', {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  // Size is an explicit component API: preserve requested icon allocation,
  // with artwork/fallback visible within it. No CSS/class oracle.
  expect(measured.root.width).toBe(size);
  expect(measured.root.height).toBe(size);
  if (measured.child) {
    expect(measured.child.width).toBeGreaterThan(0);
    expect(measured.child.height).toBeGreaterThan(0);
    expect(measured.child.left).toBeGreaterThanOrEqual(measured.root.left);
    expect(measured.child.right).toBeLessThanOrEqual(measured.root.right);
    expect(measured.child.top).toBeGreaterThanOrEqual(measured.root.top);
    expect(measured.child.bottom).toBeLessThanOrEqual(measured.root.bottom);
  }
}
