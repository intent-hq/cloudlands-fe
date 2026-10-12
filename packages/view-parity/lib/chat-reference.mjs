import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Original source is the oracle. Caller props and native clipboard do not
// establish daemon integration or source-paired visual acceptance.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourceFiles = [
  'src/lib/components/chat/ChatReferenceBlock.svelte',
  'src/lib/components/chat/ContextChip.svelte',
  'src/lib/components/editor/CodeBlock.svelte',
  'src/lib/utils/code-highlighter.ts',
  'src/lib/actions/observe-overflow.ts',
  'src/lib/icons/phosphor-icons.ts',
  'src/lib/icons/faNote.ts',
  'src/lib/components/shared/icons/FaWrapper.svelte',
  'src/lib/components/ui/CopyButton.svelte',
  'src/shared/types/notes-primitives.ts',
];
// Approved extractions change these bindings without changing the original oracle.
const extractedSources = new Set([
  'src/lib/components/editor/CodeBlock.svelte',
  'src/lib/icons/phosphor-icons.ts',
]);
const ownFiles = [
  'packages/view-parity/lib/chat-reference.mjs',
  'packages/view-parity/tests/chat-reference.core.spec.mjs',
  'packages/view-parity/tests/chat-reference.extended.spec.mjs',
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
  referenceFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_REFERENCE_APPROVED,
        'Coordinator must release the exact committed tests, independent candidate, dependencies and URL',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_REFERENCE_SHA;
      const testSha = process.env.PARITY_CHAT_REFERENCE_TEST_SHA;
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
        await info.attach('chat-reference-freeze.json', {
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
  referenceNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('chat-reference-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  referenceObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          await info.attach('chat-reference-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="chat-reference"] pre')
                .allTextContents(),
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

export { expect, outputJson, captureTranscript as captureReference };

export async function openReference(page) {
  const host = await openExample(page, 'chat-reference', 'chat-reference');
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
  const section = host.getByTestId(`reference-${kind}`);
  return {
    section,
    frame: section.getByTestId(`reference-${kind}-frame`),
    leaf: section.getByTestId(`reference-${kind}-leaf`),
    state: () => outputJson(section.getByTestId(`reference-${kind}-state`)),
  };
}

export const field = (section, name) => section.getByRole('textbox', { name, exact: true });
export const button = (section, name) => section.getByRole('button', { name, exact: true });
export async function choose(section, name, value) {
  await section
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true })
    .click();
}
export async function toggle(section, name, checked) {
  const control = section.getByRole('switch', { name, exact: true });
  if ((await control.isChecked()) !== checked) await control.click();
  await expect(control).toBeChecked({ checked });
}

export async function expectCode(leaf, text) {
  // Each source line is a real block; an empty source line paints one space.
  // Clipboard checks separately require exact raw input, including blank lines.
  await expect
    .poll(() => leaf.locator('code > div').allTextContents())
    .toEqual(text.split('\n').map((line) => line || ' '));
  await expect(leaf.locator('code script, code img, code iframe, code section')).toHaveCount(0);
}

export async function clipboardPermission(context) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(process.env.PARITY_CANDIDATE_URL).origin,
  });
}

export async function nativeCopy(page, leaf, paste, text, key) {
  // Hover exposes the source control; no force click, clipboard seeding or shim.
  await leaf.hover();
  const copy = leaf.getByRole('button', { name: /^(Copy|Copied!)$/ });
  if (key) await copy.press(key);
  else await copy.click();
  await expect(copy).toHaveAccessibleName('Copied!');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await paste.fill('');
  await paste.press('ControlOrMeta+V');
  await expect(paste).toHaveValue(text);
  // Let feedback settle naturally before stable screenshot capture.
  await expect(copy).toHaveAccessibleName('Copy');
}

export async function lineGeometry(leaf, info, name) {
  const geometry = await leaf.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const rows = [...root.querySelectorAll('code > div')].map((node) => ({
      text: node.textContent,
      ...rect(node),
    }));
    const numbers = [...root.querySelectorAll('div')]
      .filter((node) => !node.children.length && /^\d+$/.test(node.textContent))
      .map((node) => ({ text: node.textContent, ...rect(node) }));
    return { rows, numbers, bounds: rect(root) };
  });
  await info.attach(`${name}-lines.json`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  return geometry;
}

export async function expectNumberedRows(leaf, numbers, info, name) {
  const geometry = await lineGeometry(leaf, info, name);
  expect(geometry.numbers.map((row) => Number(row.text))).toEqual(numbers);
  expect(geometry.rows).toHaveLength(numbers.length);
  for (let index = 0; index < numbers.length; index++) {
    const number = geometry.numbers[index];
    const row = geometry.rows[index];
    expect(number.width).toBeGreaterThan(0);
    expect(number.height).toBeGreaterThan(0);
    // A visible line number must identify its actual code row, not overlap a
    // different row or cover the code. No decorative spacing is pinned.
    expect(number.top).toBeLessThan(row.bottom);
    expect(number.bottom).toBeGreaterThan(row.top);
    expect(number.right).toBeLessThanOrEqual(row.left);
    if (index) expect(number.top).toBeGreaterThan(geometry.numbers[index - 1].top);
  }
}

export async function chipObservations(item) {
  return (await item.state()).observations;
}

export function chipCallback(action, label, revision = 0) {
  return { action, revision, label, argumentCount: action === 'remove' ? 0 : 1 };
}

export function nativeEvent(
  type,
  label,
  { detail = type === 'click' ? 1 : 0, ctrlKey = false, metaKey = false, panelId = null } = {},
) {
  return { type, isTrusted: true, detail, ctrlKey, metaKey, buttonLabel: label, panelId };
}

export async function clearChip(item) {
  await button(item.section, 'Clear chip observations').click();
  await expect
    .poll(() => chipObservations(item))
    .toEqual({
      callbacks: [],
      parentClicks: [],
      parentPointerDowns: [],
    });
}

export async function expectChipCallbacks(item, callbacks) {
  await expect.poll(async () => (await chipObservations(item)).callbacks).toEqual(callbacks);
}

export async function expectOpen(item, callbacks) {
  await expect.poll(async () => (await item.state()).observations.callbacks).toEqual(callbacks);
}

export function openCallback(
  path,
  line,
  { panelId = 'reference-outer-panel', adjacent = false, revision = 0 } = {},
) {
  // JSON observations omit undefined fields just as the real callback snapshot does.
  return {
    revision,
    args: [
      {
        path,
        ...(line === undefined ? {} : { line }),
        openInAdjacentPanel: adjacent,
        ...(panelId === undefined ? {} : { sourcePanelId: panelId }),
      },
    ],
  };
}

export async function overflowLabel(item, label, overflow) {
  const span = item.leaf.getByText(label, { exact: true });
  await expect
    .poll(() =>
      span.evaluate((node) => ({
        measured: node.clientWidth > 0 && node.clientHeight > 0,
        overflow: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      })),
    )
    .toEqual({ measured: true, overflow });
  return span;
}

export async function expectHit(page, target, frame, info, name) {
  await target.scrollIntoViewIfNeeded();
  const geometry = await target.evaluate((node) => {
    const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return {
      left,
      right,
      top,
      bottom,
      width,
      height,
      hit: hit === node || node.contains(hit),
      viewport: innerWidth,
    };
  });
  const bounds = await frame.boundingBox();
  await info.attach(`${name}-hit.json`, {
    body: JSON.stringify({ geometry, bounds, aria: await frame.ariaSnapshot() }, null, 2),
    contentType: 'application/json',
  });
  expect(geometry.hit, 'The real control must remain pointer accessible').toBe(true);
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.left).toBeGreaterThanOrEqual(bounds.x - 1);
  expect(geometry.right).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
}

export async function expectSourceIcon(item, iconName, info) {
  // Read the immutable original semantic mapping and the installed SOURCE
  // renderer's icon artwork, never the candidate mapping or React icon assets.
  const mapping = execFileSync('git', ['show', `${original}:src/lib/icons/phosphor-icons.ts`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const table = mapping.split('const iconComponents:')[1].split('\n};')[0];
  const entries = [...table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)];
  const symbol =
    entries.find((match) => (match[1] || match[2]) === iconName)?.[3] || 'QuestionIcon';
  const weight = ['apple', 'github', 'gitlab'].includes(iconName) ? 'bold' : 'regular';
  const packagePath = 'node_modules/phosphor-svelte/package.json';
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, packagePath), 'utf8'));
  const originalLock = execFileSync('git', ['show', `${original}:pnpm-lock.yaml`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  expect(
    originalLock.includes(`phosphor-svelte@${pkg.version}:`),
    'Source icon package must be the original locked version',
  ).toBe(true);
  const assetPath = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
  const asset = readFileSync(path.join(repoRoot, assetPath), 'utf8');
  const body = asset.split(`weight === "${weight}"}`)[1]?.split('{:')[0];
  expect(body, 'The independent source icon must have the requested artwork').toBeTruthy();
  const svg = item.leaf.locator('svg').first();
  const observed = await svg.evaluate((node, source) => {
    const tree = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`,
      'image/svg+xml',
    );
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
      role: node.getAttribute('role'),
      hidden: node.getAttribute('aria-hidden'),
      name: node.getAttribute('aria-label'),
      parseError: !!tree.querySelector('parsererror'),
    };
  }, body);
  await info.attach(`icon-${iconName}.json`, {
    body: JSON.stringify(
      {
        original,
        mappingHash: digest(mapping),
        symbol,
        weight,
        packagePath,
        version: pkg.version,
        assetPath,
        assetHash: digest(asset),
        observed,
        aria: await item.leaf.ariaSnapshot(),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe('0 0 256 256');
  expect(observed.role).toBe('img');
  expect(observed.hidden).toBe('true');
  expect(observed.name).toBeNull();
  await expect(item.leaf.getByRole('img')).toHaveCount(0);
  expect(digest(readFileSync(path.join(repoRoot, assetPath)))).toBe(digest(asset));
}
