import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Local native caller contracts only. No source-paired appearance, full-motion,
// daemon integration, or unobserved pending-promise cancellation is established.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const unchangedSources = [
  'src/lib/components/chat/PinnedUserPrompt.svelte',
  'src/lib/components/chat/AgentPreviewToolLabel.svelte',
  'src/lib/actions/observe-overflow.ts',
  'src/lib/components/chat/user-message-surface.ts',
  'src/lib/components/chat/inline-markdown-snippet.ts',
  'src/lib/utils/markdown-processor.ts',
  'src/lib/utils/markdown-worker.ts',
  'src/lib/utils/html-sanitizer.ts',
  'src/lib/utils/tiptap-task-list-extension.ts',
  'src/lib/utils/tiptap-task-block-extension.ts',
  'src/features/notes/utils/task-block-parser.ts',
  'src/lib/utils/marked-strikethrough.ts',
  'src/lib/utils/marked-math.ts',
  'src/lib/utils/anchor-normalization.ts',
  'src/lib/utils/workspace-file-image.ts',
  'src/lib/services/mentions/format.ts',
  'src/lib/utils/member-mention-token.ts',
  'src/lib/utils/notes-primitives-serializer.ts',
  'src/shared/types/notes-primitives.ts',
  'src/lib/utils/diff-patch-utils.ts',
  'src/shared/utils/link-helpers.ts',
  'src/shared/logger.ts',
  'src/shared/logging-config.ts',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/components/shared/icons/fa-proxy.ts',
  'src/lib/components/shared/icons/FaWrapper.svelte',
  'src/lib/icons/faNote.ts',
  'vite.config.mjs',
];
// Keep the pristine bodies and the released current extraction profile distinct.
// Classifier changes are import seams only; MCP, icon and subscription constants
// have canonical extractions. Message catalogs include other migration work.
const extractedSources = [
  'src/lib/utils/tool-classifier.ts',
  'src/lib/components/settings/mcp/McpIcon.svelte',
  'src/lib/icons/phosphor-icons.ts',
  'src/lib/components/chat/subscription-disclosure.ts',
  'messages/en.json',
];
const currentDependencies = [
  'src/lib/icons/icon-definition.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'src/lib/icons/workspace-status-icons.ts',
  'src/lib/components/settings/mcp/mcp-icon-data.ts',
  'src/lib/components/chat/subscription-disclosure-classes.ts',
];
// The compiled localization bundle is gitignored and absent from Git-tree
// provenance. Record the actual independent runtime copy before and after.
const generatedDependencies = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const sourceFiles = [...unchangedSources, ...extractedSources];
const ownFiles = [
  'packages/view-parity/lib/chat-preview.mjs',
  'packages/view-parity/tests/chat-preview.core.spec.mjs',
  'packages/view-parity/tests/chat-preview.extended.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
  'packages/view-parity/lib/functional.mjs',
  'packages/view-parity/lib/browser.mjs',
  'packages/view-parity/lib/provenance.mjs',
  'packages/view-parity/lib/manifest.mjs',
  'packages/view-parity/lib/agent-avatar.mjs',
  'packages/view-parity/lib/chat-transcript.mjs',
  'packages/view-parity/lib/compare.mjs',
  'packages/view-parity/playwright.config.mjs',
  'packages/view-parity/scripts/run.mjs',
  'packages/view-parity/package.json',
  'pnpm-lock.yaml',
  'node_modules/phosphor-svelte/package.json',
  ...['PushPin', 'FileText', 'Wrench', 'MagnifyingGlass', 'Note'].map(
    (name) => `node_modules/phosphor-svelte/lib/${name}Icon.svelte`,
  ),
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committedHashes = (files, sha) =>
  Object.fromEntries(
    files.map((file) => [
      file,
      digest(execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot })),
    ]),
  );
const originalText = (file) =>
  execFileSync('git', ['show', `${original}:${file}`], { cwd: repoRoot, encoding: 'utf8' });

export const test = base.extend({
  previewFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_PREVIEW_APPROVED,
        'Coordinator must release the exact source, catalog, tests, independent root and URL',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_PREVIEW_SHA;
      const testSha = process.env.PARITY_CHAT_PREVIEW_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retry is authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Never run the shared editing checkout').not.toBe(
        realpathSync(repoRoot),
      );
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = hashes(runnerFiles);
      const generatedBefore = hashes(generatedDependencies, root);
      const sourceBefore = hashes([...sourceFiles, ...currentDependencies]);
      const originalHashes = committedHashes(sourceFiles, original);
      expect(hashes(ownFiles), 'Tests must match the released test commit').toEqual(
        committedHashes(ownFiles, testSha),
      );
      expect(
        hashes(unchangedSources),
        'Original unextracted sources must remain unchanged',
      ).toEqual(committedHashes(unchangedSources, original));
      expect(
        sourceBefore,
        'Current dependencies must match the released extraction profile',
      ).toEqual(committedHashes([...sourceFiles, ...currentDependencies], sha));
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes([...sourceFiles, ...currentDependencies]);
        const candidateAfter = candidateProvenance(root);
        const generatedAfter = hashes(generatedDependencies, root);
        await info.attach('chat-preview-freeze.json', {
          body: JSON.stringify(
            {
              original,
              originalHashes,
              unchangedSources,
              extractedSources,
              currentDependencies,
              generatedBefore,
              generatedAfter,
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
        expect(generatedAfter, 'Generated runtime dependencies changed during the attempt').toEqual(
          generatedBefore,
        );
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  previewNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('chat-preview-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  previewObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          await info.attach('chat-preview-observations.json', {
            body: JSON.stringify(
              await page.locator('[data-functional-example="chat-preview"] pre').allTextContents(),
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

export async function openPreview(page) {
  const host = await openExample(page, 'chat-preview', 'chat-preview');
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
  const section = host.getByTestId(`preview-${kind}`);
  return {
    section,
    frame: section.getByTestId(`preview-${kind}-frame`),
    leaf: section.getByTestId(`preview-${kind}-leaf`),
    state: section.getByTestId(`preview-${kind}-state`),
  };
}
export const field = (item, name) => item.section.getByRole('textbox', { name, exact: true });
export const button = (item, name) => item.section.getByRole('button', { name, exact: true });
export const prompt = (item) => item.frame.getByTestId('pinned-user-prompt');
export const promptText = (item) => item.frame.getByTestId('pinned-user-prompt-text');
export const toolText = (item) => item.frame.getByTestId('agent-preview-tool-text');
export const toolIcon = (item) => item.frame.getByTestId('agent-preview-tool-icon');
export const calls = async (item) => (await outputJson(item.state)).observations.calls;
export const promptName = () =>
  JSON.parse(originalText('messages/en.json')).chat_stickyMessageHeader_scrollToPrevious_title;

export async function choice(item, name, value) {
  const option = item.section
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  await option.click();
  await expect(option).toBeChecked();
}

export async function toggle(item, name, checked) {
  const control = item.section.getByRole('switch', { name, exact: true });
  if ((await control.isChecked()) !== checked) await control.press('Space');
  if (checked) await expect(control).toBeChecked();
  else await expect(control).not.toBeChecked();
}

export async function mount(item, name, mounted) {
  await toggle(item, `Mount ${name}`, mounted);
  await expect(item.leaf).toHaveCount(mounted ? 1 : 0);
}

export async function applyTool(item, name, input, key) {
  await field(item, 'Tool name').fill(name);
  await field(item, 'Tool input JSON').fill(JSON.stringify(input));
  const apply = button(item, 'Apply tool input');
  if (key) await apply.press(key);
  else await apply.click();
  await expect
    .poll(async () => (await outputJson(item.state)).inputs.toolUse)
    .toMatchObject({ name, input });
}

export async function expectPrompt(item, text) {
  await expect(prompt(item)).toHaveAccessibleName(promptName());
  await expect(prompt(item)).toHaveAccessibleDescription(text.replace(/\s+/gu, ' ').trim());
  await expect(promptText(item)).toHaveText(text);
  expect(await promptText(item).textContent()).toBe(text);
}

export async function expectTool(item, text) {
  await expect(toolText(item)).toHaveText(text);
  expect(await toolText(item).textContent()).toBe(text);
  await expect(toolText(item).locator('*')).toHaveCount(0);
  await expect(item.frame.locator('a, img, iframe, script, button, input, [tabindex]')).toHaveCount(
    0,
  );
}

export async function expectHidden(item) {
  await expect(item.leaf).toBeAttached();
  await expect(item.leaf.locator('*')).toHaveCount(0);
  await expect(item.leaf).toHaveText('');
  expect((await item.leaf.ariaSnapshot()).trim()).toBe('');
}

export async function expectTitle(label, text, overflow) {
  await expect
    .poll(() =>
      label.evaluate((node) => ({
        visible: node.clientWidth > 0 && node.clientHeight > 0,
        overflow: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      })),
    )
    .toEqual({ visible: true, overflow });
  if (text && overflow) await expect(label).toHaveAttribute('title', text);
  else await expect(label).not.toHaveAttribute('title');
}

export async function capturePreview(page, item, name, info) {
  await item.frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const measure = () =>
    item.frame.evaluate((root) => {
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        root: rect(root),
        content: [...root.querySelectorAll('div, span, button, svg')].map((node) => ({
          tag: node.localName,
          bounds: rect(node),
          title: node.getAttribute('title'),
        })),
      };
    });
  const before = { geometry: await measure(), aria: await item.frame.ariaSnapshot() };
  await captureTranscript(page, item.frame, name, info);
  const after = { geometry: await measure(), aria: await item.frame.ariaSnapshot() };
  await info.attach(`${name}-content.json`, {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Actual geometry and accessibility must stay stable during capture').toEqual(
    before,
  );
}

export async function expectContained(item, info, name, interactive = false) {
  await item.frame.scrollIntoViewIfNeeded();
  const measured = await item.frame.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const control = root.querySelector('button');
    const bounds = control && rect(control);
    const hit =
      bounds &&
      document.elementFromPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
    return {
      root: rect(root),
      viewport: innerWidth,
      overflow: root.scrollWidth > root.clientWidth,
      content: [
        ...root.querySelectorAll(
          '[data-testid="pinned-user-prompt-text"], [data-testid="agent-preview-tool-text"], button, svg',
        ),
      ].map(rect),
      hit: control ? hit === control || control.contains(hit) : null,
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  expect(measured.root.left).toBeGreaterThanOrEqual(0);
  expect(measured.root.right).toBeLessThanOrEqual(measured.viewport);
  expect(measured.overflow).toBe(false);
  if (interactive) expect(measured.hit, 'The prompt must remain pointer accessible').toBe(true);
  for (const bounds of measured.content) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(measured.root.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(measured.root.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(measured.root.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(measured.root.bottom + 1);
  }
}

function originalArtwork(name) {
  if (name === 'context7' || name === 'slack') {
    const source = originalText('src/lib/components/settings/mcp/McpIcon.svelte');
    const table = source.split('const customIconSvgs:')[1].split('\n  };')[0];
    const body = [...table.matchAll(/\s+(\w+):\s*'([^']+)'/g)].find(
      (entry) => entry[1] === name,
    )?.[2];
    expect(body).toBeTruthy();
    return { sourceHash: digest(source), body, inline: true };
  }
  const mapping = originalText('src/lib/icons/phosphor-icons.ts');
  const symbols = mapping.split('const iconComponents:')[1].split('\n};')[0];
  const symbol = [...symbols.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
    (entry) => (entry[1] || entry[2]) === name,
  )?.[3];
  expect(symbol, 'Resolve artwork from original003 aliases, never candidate assets').toBeTruthy();
  const packagePath = 'node_modules/phosphor-svelte/package.json';
  const version = JSON.parse(readFileSync(path.join(repoRoot, packagePath), 'utf8')).version;
  expect(originalText('pnpm-lock.yaml').includes(`phosphor-svelte@${version}:`)).toBe(true);
  const assetPath = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
  const asset = readFileSync(path.join(repoRoot, assetPath), 'utf8');
  const body = asset.split('weight === "regular"}')[1]?.split('{:')[0];
  expect(body).toBeTruthy();
  return {
    mappingHash: digest(mapping),
    symbol,
    packagePath,
    version,
    assetPath,
    assetHash: digest(asset),
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${body}</svg>`,
    inline: false,
  };
}

export async function expectArtwork(container, name, info) {
  const expected = originalArtwork(name);
  const svg = container.locator('svg');
  await expect(svg).toHaveCount(1);
  const observed = await svg.evaluate((node, source) => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
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
      expected: shapes(document),
      viewBox: node.getAttribute('viewBox'),
      expectedViewBox: document.documentElement.getAttribute('viewBox'),
      role: node.getAttribute('role'),
      hidden: node.getAttribute('aria-hidden'),
      label: node.getAttribute('aria-label'),
      parseError: !!document.querySelector('parsererror'),
    };
  }, expected.body);
  await info.attach(`artwork-${name}.json`, {
    body: JSON.stringify({ original, ...expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.role).toBe(expected.inline ? null : 'img');
  expect(observed.hidden).toBe(expected.inline ? null : 'true');
  expect(observed.label).toBeNull();
  await expect(container.getByRole('img')).toHaveCount(0);
}

export async function expectIconSize(item, size, info, name) {
  const measure = () =>
    toolIcon(item).evaluate((node) => {
      const rect = (element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      return { wrapper: rect(node), artwork: rect(node.querySelector('svg')) };
    });
  // Native input completion can precede the next rendered size. Wait on actual
  // production geometry, retaining the requested-size contract and its bound.
  let measured;
  const samples = [];
  try {
    await expect
      .poll(async () => {
        const sample = { startedAt: new Date().toISOString() };
        try {
          measured = await measure();
          sample.geometry = measured;
          return { width: measured.wrapper.width, height: measured.wrapper.height };
        } catch (error) {
          sample.error = String(error);
          throw error;
        } finally {
          sample.finishedAt = new Date().toISOString();
          samples.push(sample);
        }
      })
      .toEqual({ width: size, height: size });
    // Explicit iconSize API, measured on real production artwork in the browser.
    expect(measured.wrapper.width).toBe(size);
    expect(measured.wrapper.height).toBe(size);
    expect(measured.artwork.width).toBeGreaterThan(0);
    expect(measured.artwork.height).toBeGreaterThan(0);
    expect(measured.artwork.left).toBeGreaterThanOrEqual(measured.wrapper.left - 1);
    expect(measured.artwork.right).toBeLessThanOrEqual(measured.wrapper.right + 1);
    expect(measured.artwork.top).toBeGreaterThanOrEqual(measured.wrapper.top - 1);
    expect(measured.artwork.bottom).toBeLessThanOrEqual(measured.wrapper.bottom + 1);
  } finally {
    await info.attach(`${name}-icon-samples.json`, {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    });
    await info.attach(`${name}-icon-geometry.json`, {
      body: JSON.stringify(measured ?? null, null, 2),
      contentType: 'application/json',
    });
  }
}
