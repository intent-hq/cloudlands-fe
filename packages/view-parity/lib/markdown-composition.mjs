import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { settledCustom, settledMermaid, mermaidGeneration, visibleNodeIds } from './diagrams.mjs';

// Preparation only until the coordinator publishes these three files and releases
// exact candidate/test SHAs, independent root and URL. No source-pair, streaming
// race, full-motion, navigation, service or download acceptance is implied.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const blobHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const unchanged = [
  'src/lib/components/ui/MediaUnavailable.svelte',
  'src/lib/components/markdown/MarkdownDiagram.svelte',
  'src/lib/actions/observe-overflow.ts',
  'src/lib/utils/incrementalDiagramJson.ts',
  'src/lib/utils/notes-primitives-serializer.ts',
  'src/shared/types/notes-primitives.ts',
  'src/shared/constants/intent-links.ts',
  'src/lib/components/diagrams/StreamingDiagramRenderer.svelte',
  'src/lib/components/diagrams/DiagramNodeHTML.svelte',
  'src/lib/components/diagrams/DiagramPresentation.svelte',
  'src/lib/components/markdown/MermaidRenderer.svelte',
];
const profile = [
  'apps/react/src/components/ui/media-unavailable.tsx',
  'apps/react/src/components/markdown/markdown-diagram.tsx',
  'apps/react/src/catalog/markdown-composition-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/components/diagrams/diagram-node-html.tsx',
  'apps/react/src/components/diagrams/streaming-diagram-renderer.tsx',
  'apps/react/src/components/diagrams/diagram-renderer.tsx',
  'apps/react/src/components/diagrams/diagram-presentation.tsx',
  'apps/react/src/components/markdown/mermaid-renderer.tsx',
  'apps/react/src/components/ui/button.tsx',
  'apps/react/src/lib/clipboard.ts',
];
const runnerFiles = [
  'packages/view-parity/lib/markdown-composition.mjs',
  'packages/view-parity/tests/markdown-composition.core.spec.mjs',
  'packages/view-parity/tests/markdown-composition.extended.spec.mjs',
  'packages/view-parity/lib/functional.mjs',
  'packages/view-parity/lib/browser.mjs',
  'packages/view-parity/lib/provenance.mjs',
  'packages/view-parity/lib/manifest.mjs',
  'packages/view-parity/lib/agent-avatar.mjs',
  'packages/view-parity/lib/diagrams.mjs',
  'packages/view-parity/lib/compare.mjs',
  'packages/view-parity/playwright.config.mjs',
  'packages/view-parity/scripts/run.mjs',
  'packages/view-parity/package.json',
  'pnpm-lock.yaml',
];
const generated = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const english = JSON.parse(blob('messages/en.json').toString('utf8'));
export const label = (key, args = {}) => {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original localized message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Missing original localized argument ${name}`);
    return String(args[name]);
  });
};
export const test = base.extend({
  compositionFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_MARKDOWN_COMPOSITION_APPROVED,
        'Exact native release required',
      ).toBe('1');
      const sha = process.env.PARITY_MARKDOWN_COMPOSITION_SHA;
      const testSha = process.env.PARITY_MARKDOWN_COMPOSITION_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retries authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Shared editing checkout cannot be the candidate').not.toBe(
        realpathSync(repoRoot),
      );
      const before = {
        runner: hashes(runnerFiles),
        unchanged: hashes(unchanged, root),
        profile: hashes(profile, root),
        generated: hashes(generated, root),
        candidate: candidateProvenance(root),
      };
      expect(before.runner).toEqual(blobHashes(runnerFiles, testSha));
      expect(before.unchanged).toEqual(blobHashes(unchanged));
      expect(before.profile).toEqual(blobHashes(profile, sha));
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      try {
        await use();
      } finally {
        const after = {
          runner: hashes(runnerFiles),
          unchanged: hashes(unchanged, root),
          profile: hashes(profile, root),
          generated: hashes(generated, root),
          candidate: candidateProvenance(root),
        };
        await info.attach('markdown-composition-freeze.json', {
          body: JSON.stringify({ original, sha, testSha, root, before, after }, null, 2),
          contentType: 'application/json',
        });
        expect(after).toEqual(before);
      }
    },
    { auto: true },
  ],
  compositionNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('markdown-composition-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
        if (!page.isClosed())
          await info.attach('markdown-composition-observations.json', {
            body: JSON.stringify(
              await page
                .locator(
                  '[data-functional-example="media-status"] output, [data-functional-example="markdown-diagram"] output',
                )
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
export { expect, outputJson, settledCustom, settledMermaid, mermaidGeneration, visibleNodeIds };

// Fixed inputs/expected arguments are independent of candidate exports and logs.
// Omitting base fields, grammar, edges and layout exercises the original serializer.
export const minimalCustom = JSON.stringify({
  model: {
    nodes: [
      {
        id: 'file',
        label: 'Read local document',
        binding: { type: 'file', target: 'docs/Release #1.md' },
      },
      { id: 'note', label: 'Read task note', binding: { type: 'note', target: 'review-note' } },
    ],
  },
});
export const changedCustom = JSON.stringify({
  model: {
    nodes: [
      {
        id: 'current',
        label: 'Current content',
        binding: { type: 'file', target: 'docs/current.md' },
      },
    ],
  },
});
export const semanticError = JSON.stringify({
  model: {
    nodes: [{ id: 'present', label: 'Existing node' }],
    edges: [{ id: 'unresolved', from: 'present', to: 'absent' }],
  },
});
export const specialPath = 'docs/Report #1? 100%/日本語.svg';
export const encodedPathUrl =
  'intent://local/file/docs/Report%20%231%3F%20100%25/%E6%97%A5%E6%9C%AC%E8%AA%9E.svg';
export const changedPath = 'assets/new%name #2.png';
export const changedPathUrl = 'intent://local/file/assets/new%25name%20%232.png';

export async function openComposition(page) {
  const host = await openExample(page, 'markdown-composition', 'media-status');
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
  const media = exercise(host, 'media-status');
  const diagram = exercise(page.getByTestId('markdown-diagram-section'), 'markdown-diagram');
  await expect(diagram.section).toBeVisible();
  await settledCustom(diagram.frame);
  return { media, diagram };
}

export async function capture(page, frame, name, info) {
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const probe = () =>
    frame.evaluate((root) => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        frame: box(root),
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        nodes: [...root.querySelectorAll('button,a,span,svg')].map((node) => ({
          tag: node.localName,
          text: node.textContent,
          bounds: box(node),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        })),
      };
    });
  const before = await probe();
  const png = await stableLocatorScreenshot(page, frame, async ({ png, ...attempt }) => {
    if (png)
      await info.attach(`${name}-attempt-${attempt.attempt}.png`, {
        body: png,
        contentType: 'image/png',
      });
    await info.attach(`${name}-attempt-${attempt.attempt}.json`, {
      body: JSON.stringify({ ...attempt, sha256: png ? digest(png) : null }, null, 2),
      contentType: 'application/json',
    });
  });
  const after = await probe();
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  await info.attach(`${name}-geometry-ax.json`, {
    body: JSON.stringify(
      { before, after, aria: await frame.ariaSnapshot(), sha256: digest(png) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(after, 'Screenshot must not change geometry or content').toEqual(before);
}

export async function contained(frame, info) {
  await frame.scrollIntoViewIfNeeded();
  const result = await frame.evaluate((root) => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      frame: box(root),
      width: innerWidth,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      controls: [...root.querySelectorAll('button,a')].map((node) => {
        const bounds = box(node);
        const hit = document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        );
        return { bounds, hittable: hit === node || node.contains(hit) };
      }),
    };
  });
  await info.attach('markdown-composition-containment.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.frame.left).toBeGreaterThanOrEqual(0);
  expect(result.frame.right).toBeLessThanOrEqual(result.width);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  expect(result.controls.length).toBeGreaterThan(0);
  for (const { bounds, hittable } of result.controls) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(result.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(result.frame.right + 1);
    expect(hittable, 'Narrow content must leave each control operable').toBe(true);
  }
}

export async function sameNode(current, previous) {
  expect(await current.evaluate((node, old) => node === old, previous)).toBe(true);
}
export async function detached(previous) {
  await expect.poll(() => previous.evaluate((node) => node.isConnected)).toBe(false);
}

function exercise(section, id) {
  const frame = section.getByTestId(`${id}-frame`);
  return {
    id,
    section,
    frame,
    tile: frame.getByTestId('media-unavailable'),
    presentation: frame.locator('[data-diagram-presentation]'),
    state: () => outputJson(section.getByTestId(`${id}-state`)),
    observations: () => outputJson(section.getByTestId(`${id}-observations`)),
  };
}
export const control = (item, suffix) => item.section.getByTestId(`${item.id}-${suffix}`);
export const copy = (item) =>
  item.tile.getByRole('button', {
    name: label('ui_imageActionsMenu_copyPath_label'),
    exact: true,
  });
export const open = (item) =>
  item.tile.getByRole('button', {
    name: label('chat_changesPanel_openFile_tooltip'),
    exact: true,
  });
export const binding = (item, text, type) =>
  item.frame.getByRole('button', {
    name: label('diagram_node_openBinding_ariaLabel', { label: text, type }),
    exact: true,
  });
export async function switchTo(item, suffix, checked) {
  const target = control(item, suffix);
  if ((await target.getAttribute('aria-checked')) !== String(checked)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(checked));
}
export async function clear(item) {
  await control(item, 'clear').click();
  await expect.poll(item.observations).toEqual({ counts: {}, callbacks: [], native: [] });
}
export async function setCustom(item, source = minimalCustom) {
  // The fixture control changes kind and source atomically. Filling an entire
  // textarea emits one genuine input, without manufacturing transient bad JSON.
  if ((await item.state()).inputs.kind !== 'diagram')
    await control(item, 'fixture-bindings').click();
  await control(item, 'source').fill(source);
  const renderer = await settledCustom(item.frame);
  await expect(item.frame.locator('[data-diagram-streaming]')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  return renderer;
}
export async function activate(
  item,
  target,
  { name, via = 'click', modifiers = [], revision = 0, mountRevision = 0 } = {},
) {
  const before = await item.observations();
  if (via === 'click') await target.click({ modifiers });
  else await target.press(via);
  await expect
    .poll(async () => (await item.observations()).callbacks.length)
    .toBe(before.callbacks.length + 1);
  const after = await item.observations();
  const record = after.callbacks.at(-1);
  expect(record).toMatchObject({ name, callbackRevision: revision, mountRevision });
  for (const candidate of ['onOpenLink', 'onOpenFile'])
    expect(after.counts[candidate] ?? 0).toBe(
      (before.counts[candidate] ?? 0) + Number(candidate === name),
    );
  expect(record.capturedClick).toMatchObject({
    type: 'click',
    isTrusted: true,
    sameAsCapturedClick: true,
    detail: via === 'click' ? 1 : 0,
    button: 0,
    ctrlKey: modifiers.includes('Control'),
    metaKey: modifiers.includes('Meta'),
    shiftKey: modifiers.includes('Shift'),
    altKey: modifiers.includes('Alt'),
  });
  const native = after.native.filter((event) => event.objectId === record.capturedClick.objectId);
  expect(native.map((event) => event.name)).toEqual([
    'native-click-capture',
    'native-click-bubble',
  ]);
  return record;
}
export function fileArgs(record, workspace, target, adjacent, panel) {
  expect(record.argumentCount).toBe(3);
  expect(record.arguments).toEqual([
    workspace,
    target,
    { openInAdjacentPanel: adjacent, sourcePanelId: panel ?? '[undefined]' },
  ]);
}
export function noteArgs(record, url, workspace, adjacent, panel) {
  expect(record.argumentCount).toBe(2);
  const [actualUrl, options] = record.arguments;
  expect(actualUrl).toBe(url);
  expect(options).toEqual({
    workspaceId: workspace,
    openInAdjacentPanel: adjacent,
    sourcePanelId: panel ?? '[undefined]',
    event: record.capturedClick,
  });
  expect(options.event.target.panelId).toBe(panel);
  // React delegates the same native event at its root. Record currentTarget;
  // never manufacture source-button currentTarget equivalence.
  expect(options.event.currentTarget).not.toBeNull();
}
export async function noNavigation(item, target) {
  const before = await item.observations();
  await target.press('Enter');
  await expect
    .poll(async () => (await item.observations()).counts['native-click-capture'] ?? 0)
    .toBe((before.counts['native-click-capture'] ?? 0) + 1);
  const after = await item.observations();
  expect(after.callbacks).toEqual(before.callbacks);
  expect(
    after.native.filter((event) => event.name === 'native-click-capture').at(-1),
  ).toMatchObject({ type: 'click', isTrusted: true, detail: 0 });
}
export async function readableNode(item, target, info) {
  await target.scrollIntoViewIfNeeded();
  const result = await target.evaluate((node) => {
    const box = (value) => {
      const { left, right, top, bottom, width, height } = value.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const bounds = box(node);
    const text = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        const hit = document.elementFromPoint(
          (rect.left + rect.right) / 2,
          (rect.top + rect.bottom) / 2,
        );
        text.push({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          hittable: hit === node || node.contains(hit),
        });
      }
    }
    return { bounds, text, viewport: { width: innerWidth, height: innerHeight } };
  });
  await info.attach('readable-node.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.text.length).toBeGreaterThan(0);
  for (const rect of result.text) {
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.left).toBeGreaterThanOrEqual(Math.max(0, result.bounds.left) - 1);
    expect(rect.right).toBeLessThanOrEqual(
      Math.min(result.viewport.width, result.bounds.right) + 1,
    );
    expect(rect.top).toBeGreaterThanOrEqual(Math.max(0, result.bounds.top) - 1);
    expect(rect.bottom).toBeLessThanOrEqual(
      Math.min(result.viewport.height, result.bounds.bottom) + 1,
    );
    expect(rect.hittable, 'Text must remain visible and reachable at 420').toBe(true);
  }
  await expect(target).toBeEnabled();
}
