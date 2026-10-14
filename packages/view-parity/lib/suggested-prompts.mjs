import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Local native callback contracts only: no navigation, source-pixel, full-motion
// or production integration acceptance. The oracle never imports the React port.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const parserPath = 'src/lib/components/chat/suggested-prompt-markdown-links.ts';
const unchangedSources = [
  'src/lib/components/chat/SuggestedPrompts.svelte',
  'src/lib/components/chat/ChiefStarterPrompts.svelte',
  parserPath,
  'src/lib/components/patterns/collection/ListView.svelte',
  'src/lib/components/ui/button/button.svelte',
];
// These neutral extractions and the complete catalog are pinned to the separately
// released candidate. The selected message values still come from original003.
const extractedDependencies = [
  'src/lib/components/chat/operational-disclosure-classes.ts',
  'src/lib/icons/icon-definition.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
];
const generatedDependencies = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const ownFiles = [
  'packages/view-parity/lib/suggested-prompts.mjs',
  'packages/view-parity/tests/suggested-prompts.core.spec.mjs',
  'packages/view-parity/tests/suggested-prompts.extended.spec.mjs',
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
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const committedHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(committed(file, sha))]));

// Strip types from the immutable, dependency-free original Git blob. Never load
// the current shared helper as the oracle, even when its bytes happen to match.
const parserSource = committed(parserPath);
if (digest(parserSource) !== 'e356ddfed2bc43e99041567825c0dfc79f1a802d87f7083cab258afe9fc2a63e')
  throw new Error('The reviewed original prompt parser fingerprint changed');
const parser = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(parserSource)).toString('base64')}`
);
export const visibleText = parser.promptVisibleText;
export const linkParts = (raw) =>
  parser.splitPromptMarkdownLinks(raw).filter((part) => part.type === 'link');
export const routingUrl = parser.promptLinkRoutingUrl;
const english = JSON.parse(committed('messages/en.json'));
const chiefSource = committed('src/lib/components/chat/ChiefStarterPrompts.svelte');
const chiefKeys = [...chiefSource.matchAll(/label: m\.(\w+)\(\),\s+prompt: m\.(\w+)\(\)/g)];
if (chiefKeys.length !== 5) throw new Error('Original Chief must define five label/prompt pairs');
export const chiefPairs = chiefKeys.map(([, label, prompt]) => ({
  label: english[label],
  prompt: english[prompt],
}));
export const editName = english.chat_suggestedPrompts_editInInput_ariaLabel;

export const test = base.extend({
  promptFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_SUGGESTED_PROMPTS_APPROVED,
        'Explicit runtime release required',
      ).toBe('1');
      const sha = process.env.PARITY_SUGGESTED_PROMPTS_SHA;
      const testSha = process.env.PARITY_SUGGESTED_PROMPTS_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retry is authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Never execute the shared editing checkout').not.toBe(
        realpathSync(repoRoot),
      );
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = hashes(runnerFiles);
      expect(before, 'The runner must match the reviewed test freeze').toEqual(
        committedHashes(runnerFiles, testSha),
      );
      const sourceBefore = hashes(unchangedSources);
      expect(sourceBefore).toEqual(committedHashes(unchangedSources));
      expect(hashes(unchangedSources, root)).toEqual(sourceBefore);
      const extractedBefore = hashes(extractedDependencies, root);
      expect(extractedBefore).toEqual(committedHashes(extractedDependencies, sha));
      const generatedBefore = hashes(generatedDependencies, root);
      const currentEnglish = JSON.parse(readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
      for (const key of [
        ...chiefKeys.flatMap(([, label, prompt]) => [label, prompt]),
        'chat_suggestedPrompts_editInInput_ariaLabel',
      ])
        expect(currentEnglish[key], `Original localized contract changed: ${key}`).toBe(
          english[key],
        );
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(unchangedSources);
        const candidateSourceAfter = hashes(unchangedSources, root);
        const extractedAfter = hashes(extractedDependencies, root);
        const generatedAfter = hashes(generatedDependencies, root);
        const candidateAfter = candidateProvenance(root);
        await info.attach('suggested-prompts-freeze.json', {
          body: JSON.stringify(
            {
              original,
              sha,
              testSha,
              root,
              before,
              after,
              sourceBefore,
              sourceAfter,
              candidateSourceAfter,
              extractedBefore,
              extractedAfter,
              generatedBefore,
              generatedAfter,
              candidate,
              candidateAfter,
              chiefPairs,
              parserSha256: digest(parserSource),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after).toEqual(before);
        expect(sourceAfter).toEqual(sourceBefore);
        expect(candidateSourceAfter).toEqual(sourceBefore);
        expect(extractedAfter).toEqual(extractedBefore);
        expect(generatedAfter).toEqual(generatedBefore);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  promptNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('suggested-prompts-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  promptObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('suggested-prompts-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="suggested-prompts"] pre')
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
export { expect };

export async function openPrompts(page) {
  const host = await openExample(page, 'suggested-prompts', 'suggested-prompts');
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemonUrl: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: window.innerWidth,
      height: window.innerHeight,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
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
  const frame = host.getByTestId('suggested-prompts-frame');
  return {
    host,
    frame,
    leaf: frame.getByTestId('suggested-prompts-leaf'),
    rows: frame.locator('[data-suggested-prompt-row]'),
    inputs: () => outputJson(host.getByTestId('suggested-prompts-inputs')),
    observations: () => outputJson(host.getByTestId('suggested-prompts-observations')),
  };
}
export const control = (item, name) => item.host.getByRole('button', { name, exact: true });
export const toggle = (item, name) => item.host.getByRole('switch', { name, exact: true });
export const sendControl = (item, index) =>
  item.rows.nth(index).locator('[data-suggested-prompt-text]');
export const editControl = (item, index) =>
  item.rows.nth(index).getByRole('button', { name: editName, exact: true });
export async function applyPrompts(item, prompts) {
  await item.host
    .getByRole('textbox', { name: 'Raw prompts JSON', exact: true })
    .fill(JSON.stringify(prompts));
  await control(item, 'Apply prompts').click();
  await expect.poll(async () => (await item.inputs()).sourceInputs.prompts).toEqual(prompts);
  await expect(item.rows).toHaveCount(prompts.length);
}
export async function chooseChief(item, chief = true) {
  await item.host
    .getByRole('radiogroup', { name: 'Prompt composition', exact: true })
    .getByRole('radio', { name: chief ? 'Chief starters' : 'Suggested prompts', exact: true })
    .click();
  await expect.poll(async () => (await item.inputs()).composition).toBe(chief ? 'chief' : 'source');
}
export async function expectCounts(item, select, edit = 0, link = 0) {
  await expect
    .poll(async () => {
      const { total, counts } = await item.observations();
      return { total, counts };
    })
    .toEqual({ total: select + edit + link, counts: { select, edit, link } });
}
async function lastRecord(item, expected) {
  const history = (await item.observations()).history;
  const record = history.at(-1);
  expect(record).toMatchObject(expected);
  return record;
}
export async function expectRaw(item, kind, rawPrompt, indices, extra = {}) {
  return lastRecord(item, { kind, rawPrompt, matchingRawIndices: indices, ...extra });
}
export async function sameNode(current, old) {
  expect(await current.evaluate((node, previous) => node === previous, old)).toBe(true);
}
export async function detached(old) {
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
}

export async function capturePrompts(page, item, name, info) {
  // Keep the shared stable capture implementation unchanged, and retain extra
  // link/text geometry since the shared transcript probe measures role nodes.
  const geometry = () =>
    item.frame.evaluate((root) => {
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        frame: rect(root),
        nodes: [
          ...root.querySelectorAll(
            'a, [data-suggested-prompt-label], [data-suggested-prompt-hint]',
          ),
        ].map((node) => ({
          tag: node.tagName,
          text: node.textContent,
          href: node.getAttribute('href'),
          bounds: rect(node),
        })),
      };
    });
  await item.frame.scrollIntoViewIfNeeded();
  const before = await geometry();
  await captureTranscript(page, item.frame, name, info);
  const after = await geometry();
  await info.attach(`${name}-prompt-geometry.json`, {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capture must preserve actual link and prompt geometry').toEqual(before);
}

export async function expectLink(
  item,
  {
    count,
    url,
    label,
    workspaceId = 'prompt-workspace-a',
    key = null,
    altKey = false,
    ctrlKey = false,
    metaKey = false,
    shiftKey = false,
    ...context
  },
) {
  await expectCounts(item, 0, 0, count);
  const record = await lastRecord(item, { kind: 'link', url, workspaceId, ...context });
  expect(record.event).toMatchObject({
    type: key === null ? 'click' : 'keydown',
    isMouseEvent: key === null,
    isKeyboardEvent: key !== null,
    isTrusted: true,
    defaultPrevented: true,
    cancelBubble: true,
    bubbles: true,
    cancelable: true,
    altKey,
    ctrlKey,
    metaKey,
    shiftKey,
    key,
    currentTarget: {
      tagName: 'A',
      text: label,
      href: url,
      connected: true,
      inFrame: true,
      isAnchor: true,
    },
    target: {
      tagName: 'A',
      text: label,
      href: url,
      connected: true,
      inFrame: true,
      isAnchor: true,
    },
  });
  expect(record.event.target.objectId).toBe(record.event.currentTarget.objectId);
  if (key === null) {
    // Modern Chromium click is a PointerEvent, which is a real MouseEvent subclass.
    expect(record.event.constructorName).toMatch(/^(Pointer|Mouse)Event$/);
    expect(record.event.button).toBe(0);
  } else {
    expect(record.event.constructorName).toBe('KeyboardEvent');
    expect(record.event.code).toBe(key === ' ' ? 'Space' : 'Enter');
    expect(record.event.repeat).toBe(false);
  }
  return record;
}

export async function expectContained(item, info, name) {
  await item.frame.scrollIntoViewIfNeeded();
  const result = await item.frame.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    const text = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"], svg'))
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      text.push(
        ...[...range.getClientRects()]
          .filter((r) => r.width && r.height)
          .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
      );
    }
    const controls = [...root.querySelectorAll('a,button,[data-suggested-prompt-text]')].map(
      (node) => {
        const bounds = rect(node);
        // An inline control may wrap into several line boxes. Probe an actual
        // nonempty box, not the empty center of its union bounding rectangle.
        const box = [...node.getClientRects()].find((r) => r.width && r.height);
        const hit = box
          ? document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
          : null;
        return { bounds, hit: node === hit || node.contains(hit) };
      },
    );
    return {
      frame: rect(root),
      viewport: window.innerWidth,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      text,
      controls,
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.frame.left).toBeGreaterThanOrEqual(0);
  expect(result.frame.right).toBeLessThanOrEqual(result.viewport);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  expect(result.text.length).toBeGreaterThan(0);
  for (const bounds of [...result.text, ...result.controls.map((c) => c.bounds)]) {
    expect(bounds.left).toBeGreaterThanOrEqual(result.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(result.frame.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(result.frame.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(result.frame.bottom + 1);
  }
  for (const { bounds, hit } of result.controls) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(hit, 'Visible controls must remain unobscured and pointer accessible').toBe(true);
  }
}
