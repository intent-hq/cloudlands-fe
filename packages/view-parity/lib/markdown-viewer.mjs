import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { settledCustom, settledMermaid } from './diagrams.mjs';

// Ignored preparation: publication and each native run require separate coordinator release.
// No parser invocation supplies expected output. Fixed inputs and semantics come from original003.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (files, sha) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const sourceFiles = [
  'src/lib/components/markdown/MarkdownViewer.svelte',
  'src/lib/components/markdown/markdown-diagrams.ts',
  'src/lib/components/markdown/markdown-image-dom.ts',
  'src/lib/utils/markdown-processor.ts',
  'src/lib/utils/markdown-worker.ts',
  'src/lib/utils/markdown-content-complexity.ts',
  'src/lib/utils/html-sanitizer.ts',
  'src/lib/utils/media-provenance.ts',
  'src/lib/utils/workspace-file-image.ts',
  'src/lib/utils/workspace-file-video.ts',
  'src/lib/utils/markdown-image-dimensions.ts',
  'src/lib/utils/image-actions.ts',
  'src/shared/utils/link-helpers.ts',
  'src/lib/components/markdown/MarkdownDiagram.svelte',
  'src/lib/components/chat/ChatVideoBlock.svelte',
  'src/lib/components/ui/ImageActionsMenu.svelte',
  'src/lib/components/ui/ImageLightbox.svelte',
];
// This intentional shared-parser fix is pinned to the approved candidate, not original equality.
const intentionalSourceFixes = ['src/lib/utils/tiptap-task-list-extension.ts'];
const profile = [
  'apps/react/src/components/markdown/markdown-viewer.tsx',
  'apps/react/src/components/markdown/markdown-viewer-dom.tsx',
  'apps/react/src/components/markdown/markdown-viewer-diagrams.tsx',
  'apps/react/src/components/markdown/markdown-viewer.css',
  'apps/react/src/catalog/markdown-viewer-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/components/markdown/markdown-diagram.tsx',
  'apps/react/src/features/chat/components/chat-video-block.tsx',
  'apps/react/src/components/ui/image-actions-menu.tsx',
  'apps/react/src/components/ui/image-lightbox.tsx',
  'apps/react/src/components/ui/media-unavailable.tsx',
  'apps/react/src/components/ui/media-loading-placeholder.tsx',
  'apps/react/src/components/ui/file-input.tsx',
  ...intentionalSourceFixes,
];
const runnerFiles = [
  'packages/view-parity/lib/markdown-viewer.mjs',
  'packages/view-parity/tests/markdown-viewer.core.spec.mjs',
  'packages/view-parity/tests/markdown-viewer.extended.spec.mjs',
  ...['functional', 'manifest', 'provenance', 'browser', 'agent-avatar', 'diagrams', 'compare'].map(
    (name) => `packages/view-parity/lib/${name}.mjs`,
  ),
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
export function label(key, args = {}) {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Original message missing: ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Original message argument missing: ${name}`);
    return String(args[name]);
  });
}
export const test = base.extend({
  viewerFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_MARKDOWN_VIEWER_APPROVED, 'Exact native release required').toBe(
        '1',
      );
      const sha = process.env.PARITY_MARKDOWN_VIEWER_SHA;
      const testSha = process.env.PARITY_MARKDOWN_VIEWER_TEST_SHA;
      const root = process.env.PARITY_CANDIDATE_ROOT;
      const url = process.env.PARITY_CANDIDATE_URL;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
      expect(info.retry).toBe(0);
      expect(realpathSync(root)).not.toBe(realpathSync(repoRoot));
      const snapshot = () => ({
        runner: hashes(runnerFiles),
        source: hashes(sourceFiles, root),
        profile: hashes(profile, root),
        generated: hashes(generated, root),
        candidate: candidateProvenance(root),
      });
      const originalSourceFixHashes = committed(intentionalSourceFixes, original);
      const before = snapshot();
      expect(before.runner).toEqual(committed(runnerFiles, testSha));
      expect(before.source).toEqual(committed(sourceFiles, original));
      expect(before.profile).toEqual(committed(profile, sha));
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      try {
        await use();
      } finally {
        const after = snapshot();
        await info.attach('markdown-viewer-freeze.json', {
          body: JSON.stringify(
            { original, sha, testSha, root, url, originalSourceFixHashes, before, after },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after).toEqual(before);
      }
    },
    { auto: true },
  ],
  viewerNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use(network);
      } finally {
        await info.attach('markdown-viewer-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
        if (!page.isClosed())
          await info.attach('markdown-viewer-outputs.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="markdown-viewer"] output')
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
export { expect, settledCustom, settledMermaid };
export const field = (host, name) => host.getByLabel(name, { exact: true });
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const frame = (host) => host.getByTestId('markdown-viewer-frame');
export const viewer = (host) => frame(host).locator(':scope > div').first();
export const inputs = (host) => outputJson(field(host, 'Markdown caller inputs'));
export async function observations(host) {
  await button(host, 'Refresh observations').click();
  return outputJson(field(host, 'Markdown observations'));
}
export const navigation = (records) =>
  records.callbacks.filter((record) =>
    ['onOpenLink', 'onOpenFile', 'onOpenNote', 'onFileClick', 'onCodeBlockAction'].includes(
      record.name,
    ),
  );
export async function clear(host) {
  await button(host, 'Clear observations').click();
}
export async function choose(host, name, value) {
  const target = host
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  await target.click();
  await expect(target).toHaveAttribute('aria-checked', 'true');
}
export async function toggle(host, name, checked) {
  const target = host.getByRole('switch', { name, exact: true });
  if ((await target.getAttribute('aria-checked')) !== String(checked)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(checked));
}
export async function apply(host, content) {
  await field(host, 'Raw Markdown content').fill(content);
  await button(host, 'Apply Markdown content').click();
}
export async function openViewer(page) {
  const host = await openExample(page, 'markdown-viewer', 'markdown-viewer');
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
export async function detached(handle) {
  await expect.poll(() => handle.evaluate((node) => node.isConnected)).toBe(false);
}
export async function sameNode(target, handle) {
  expect(await target.evaluate((node, old) => node === old, handle)).toBe(true);
}
export async function tabTo(page, host, target) {
  // Start at an actual caller control immediately before the viewer; no DOM focus writes.
  await button(host, 'Replace canOpenFile').click();
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => document.activeElement === node)) return;
  }
  await expect(target, 'Must be reachable by native Tab').toBeFocused();
}
export async function activate(
  host,
  target,
  { name = 'onOpenLink', key, modifiers = [], revision = 0 } = {},
) {
  const before = await observations(host);
  if (key) await target.press(key);
  else await target.click({ modifiers });
  const after = await observations(host);
  expect(after.counts[name] ?? 0).toBe((before.counts[name] ?? 0) + 1);
  const record = navigation(after)
    .filter((entry) => entry.name === name)
    .at(-1);
  expect(record).toMatchObject({ name, callbackRevision: revision });
  return record;
}
export function anchorArgs(
  record,
  {
    url,
    rawHref,
    workspace = 'system-design',
    panel = 'markdown-viewer-panel',
    forceExternal,
    key,
    ctrl = false,
    meta = false,
    admission = false,
  },
) {
  expect(record.argumentCount).toBe(2);
  expect(record.arguments[0]).toBe(url);
  const opts = record.arguments[1];
  expect(Object.keys(opts).sort()).toEqual(
    [
      'workspaceId',
      'canOpenFile',
      'sourcePanelId',
      'event',
      'rawHref',
      ...(forceExternal ? ['forceExternal'] : []),
    ].sort(),
  );
  expect(opts).toMatchObject({
    workspaceId: workspace ?? '[undefined]',
    sourcePanelId: panel ?? '[undefined]',
    rawHref,
  });
  if (forceExternal) expect(opts.forceExternal).toBe(true);
  if (admission) expect(opts.canOpenFile).toMatchObject({ type: 'function' });
  else expect(opts.canOpenFile).toBe('[undefined]');
  expect(opts.event).toMatchObject({
    type: key ? 'keydown' : 'click',
    isTrusted: true,
    defaultPrevented: true,
    sameAsCapturedEvent: true,
    ctrlKey: ctrl,
    metaKey: meta,
    target: { closestPanel: panel, rawHref },
    currentTarget: { role: 'group', closestPanel: panel },
  });
  if (key) expect(opts.event.key).toBe(key);
}
export function mentionEvent(record, { ctrl = false, panel = 'markdown-viewer-panel' } = {}) {
  expect(record.capturedEvent).toMatchObject({
    type: 'click',
    isTrusted: true,
    defaultPrevented: true,
    cancelBubble: true,
    sameAsCapturedEvent: true,
    ctrlKey: ctrl,
    metaKey: false,
    target: { closestPanel: panel },
    currentTarget: { role: 'group', closestPanel: panel },
  });
}
export function assertPastedPng(receipt, file) {
  expect(receipt.event).toMatchObject({
    type: 'paste',
    isTrusted: true,
    target: { tag: 'TEXTAREA', testId: 'markdown-viewer-paste-target' },
    control: { tag: 'TEXTAREA', testId: 'markdown-viewer-paste-target' },
  });
  expect(receipt.files).toHaveLength(1);
  expect(receipt.files[0].type).toBe('image/png');
  expect(receipt.files[0]).not.toHaveProperty('error');
  expect(receipt.files[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  const actual = PNG.sync.read(Buffer.from(receipt.files[0].dataUrl.split(',')[1], 'base64'));
  const expected = PNG.sync.read(file.buffer);
  expect({ width: actual.width, height: actual.height }).toEqual({
    width: file.width,
    height: file.height,
  });
  // Clipboard PNG encoding may change; the decoded pixels of the original local file must survive.
  expect(digest(actual.data)).toBe(digest(expected.data));
  return { width: actual.width, height: actual.height, rgbaSha256: digest(actual.data) };
}
export function pngFile(name = 'viewer-image.png', width = 160, height = 100) {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = (offset / 4) % 256;
    png.data[offset + 1] = 100;
    png.data[offset + 2] = 220;
    png.data[offset + 3] = 255;
  }
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png), width, height };
}
export async function pickImage(page, host, file = pngFile()) {
  const pending = page.waitForEvent('filechooser');
  await button(host, 'Read local image or video').click();
  const chooser = await pending;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  const expectedUrl = `data:image/png;base64,${file.buffer.toString('base64')}`;
  await expect(field(host, 'Media Markdown source URL')).toHaveValue(expectedUrl);
  return expectedUrl;
}
export async function insertImage(page, host, file = pngFile(), linked = false) {
  const src = await pickImage(page, host, file);
  await button(host, linked ? 'Insert linked image Markdown' : 'Insert media Markdown').click();
  await button(host, 'Apply Markdown content').click();
  const image = viewer(host).locator('img').last();
  await expect(image).toHaveAttribute('src', src);
  await expect
    .poll(() =>
      image.evaluate((node) => ({
        complete: node.complete,
        width: node.naturalWidth,
        height: node.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: file.width, height: file.height });
  return { image, src, file };
}
export const imageActions = (host) =>
  viewer(host).getByRole('button', {
    name: label('ui_imageActionsMenu_trigger_ariaLabel'),
    exact: true,
  });
const customDiagram = JSON.stringify({
  model: {
    nodes: [
      {
        id: 'file',
        label: 'Open source document',
        binding: { type: 'file', target: 'docs/original.md' },
      },
    ],
  },
});
export const customFence = `\`\`\`ws-block:diagram\n${customDiagram}\n\`\`\``;
export const mermaidFence = '```mermaid\nflowchart LR\n  Source --> Result\n```';
export const mention = (host, type, id) =>
  viewer(host).locator(`[data-mention][data-type="${type}"][data-id="${id}"]`);
