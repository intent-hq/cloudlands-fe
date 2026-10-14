import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

// Ignored preparation until an explicit publication and native release. The ten
// native cases establish only their bounded contracts, never pixel/product parity.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourcePort = 'bc87f6de4ddbc41eae2eb5006a7f07174efbdb02';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const blobHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const unchanged = [
  'src/lib/components/chat/ReasoningHistoryBlock.svelte',
  'src/lib/components/chat/ChatOperationalRow.svelte',
  'src/lib/components/chat/reasoning-heading.ts',
  'src/lib/components/chat/chat-search-disclosure.ts',
  'src/lib/utils/markdown-processor.ts',
  'src/lib/utils/marked-strikethrough.ts',
  'src/lib/utils/marked-math.ts',
];
const extracted = [
  'src/lib/components/chat/ThinkingBlock.svelte',
  'src/lib/motion/shimmer-timing.ts',
];
const profile = [
  ...extracted,
  'apps/react/src/features/chat/components/thinking-block.tsx',
  'apps/react/src/features/chat/components/thinking-block.css',
  'apps/react/src/features/chat/components/reasoning-history-block.tsx',
  'apps/react/src/features/chat/components/reasoning-history-block.css',
  'apps/react/src/features/chat/components/chat-operational-row.tsx',
  'apps/react/src/components/markdown/markdown-viewer.tsx',
  'apps/react/src/components/markdown/markdown-viewer-dom.tsx',
  'apps/react/src/components/markdown/markdown-viewer-diagrams.tsx',
  'apps/react/src/components/markdown/markdown-viewer.css',
  'apps/react/src/catalog/reasoning-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
];
const runnerFiles = [
  'packages/view-parity/lib/reasoning.mjs',
  'packages/view-parity/tests/reasoning.core.spec.mjs',
  'packages/view-parity/tests/reasoning.extended.spec.mjs',
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
const generated = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const require = createRequire(path.join(repoRoot, 'package.json'));
const markedRoot = path.dirname(require.resolve('marked/package.json'));
const oracleDependencies = [
  path.relative(repoRoot, path.join(markedRoot, 'package.json')),
  path.relative(repoRoot, path.join(markedRoot, 'lib/marked.umd.js')),
  path.relative(repoRoot, require.resolve('typescript')),
];
const english = JSON.parse(blob('messages/en.json').toString('utf8'));
export const label = (key) => {
  if (typeof english[key] !== 'string') throw new Error(`Missing original message ${key}`);
  return english[key];
};

// Extract original declarations, not a reimplementation of its parsing algorithm.
// The original helper's inert template runs in the real Chromium document. Marked
// is local dependency code with local CommonJS exports, without globals/network.
function originalDeclarations(file, names) {
  const text = blob(file).toString('utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = new Set();
  const statements = ast.statements.filter((statement) => {
    if (ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement)) return false;
    if (ts.isTypeAliasDeclaration(statement)) return false;
    const own = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map((entry) => entry.name.getText(ast))
      : [statement.name?.getText(ast)];
    if (!names || own.some((name) => names.includes(name))) {
      own.forEach((name) => found.add(name));
      return true;
    }
    return false;
  });
  for (const name of names ?? [])
    if (!found.has(name)) throw new Error(`Missing original declaration ${file}#${name}`);
  return stripTypeScriptTypes(
    statements.map((statement) => statement.getText(ast).replace(/^export\s+/, '')).join('\n'),
  );
}
const oracleProgram = [
  'const exports = {}; const module = {exports};',
  readFileSync(path.join(markedRoot, 'lib/marked.umd.js'), 'utf8'),
  'const {Marked, Tokenizer} = module.exports;',
  originalDeclarations('src/lib/utils/marked-math.ts', [
    'ANCHOR_COMMENT_PATTERN',
    'stripAnchors',
    'inlineDollarToken',
    'misplacedDisplayToken',
    'inlineParenthesisToken',
    'displayToken',
    'inlineToken',
    'protectMathSource',
  ]),
  originalDeclarations('src/lib/utils/markdown-processor.ts', ['escapeHtmlTags']),
  originalDeclarations('src/lib/utils/marked-strikethrough.ts'),
  originalDeclarations('src/lib/components/chat/reasoning-heading.ts'),
  'return {heading: extractReasoningHeading(input, {preserveInlineText: true}), standalone: extractStandaloneReasoningTitles(input), history: extractReasoningHistory(input)};',
].join('\n');

export async function originalProjection(page, content, info) {
  const result = await page.evaluate(({ source, input }) => new Function('input', source)(input), {
    source: oracleProgram,
    input: content,
  });
  await info.attach(`original-reasoning-${digest(content).slice(0, 12)}.json`, {
    body: JSON.stringify(
      { original, input: content, result, oracleSha256: digest(oracleProgram) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  return result;
}

export const test = base.extend({
  reasoningFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_REASONING_APPROVED, 'Exact native release required').toBe('1');
      const sha = process.env.PARITY_REASONING_SHA;
      const testSha = process.env.PARITY_REASONING_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retries authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Editing checkout cannot be the candidate').not.toBe(
        realpathSync(repoRoot),
      );
      const read = () => ({
        runner: hashes(runnerFiles),
        unchanged: hashes(unchanged, root),
        profile: hashes(profile, root),
        generated: hashes(generated, root),
        oracleDependencies: hashes(oracleDependencies),
        candidate: candidateProvenance(root),
      });
      const before = read();
      expect(before.runner).toEqual(blobHashes(runnerFiles, testSha));
      expect(before.unchanged).toEqual(blobHashes(unchanged));
      expect(hashes(extracted, root)).toEqual(blobHashes(extracted, sourcePort));
      expect(before.profile).toEqual(blobHashes(profile, sha));
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      const candidateMarked = path.join(root, 'node_modules/marked/lib/marked.umd.js');
      expect(digest(readFileSync(candidateMarked))).toBe(
        digest(readFileSync(path.join(markedRoot, 'lib/marked.umd.js'))),
      );
      const originalVersion = blob('pnpm-lock.yaml')
        .toString('utf8')
        .match(/^      marked:\n        specifier: [^\n]+\n        version: ([^\n]+)/m)?.[1];
      expect(originalVersion, 'Original root Marked lock must exist').toBeTruthy();
      expect(JSON.parse(readFileSync(path.join(markedRoot, 'package.json'))).version).toBe(
        originalVersion,
      );
      try {
        await use();
      } finally {
        const after = read();
        await info.attach('reasoning-freeze.json', {
          body: JSON.stringify(
            {
              original,
              sourcePort,
              sha,
              testSha,
              root,
              oracleSha256: digest(oracleProgram),
              before,
              after,
            },
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
  reasoningNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('reasoning-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
        if (!page.isClosed())
          await info.attach('reasoning-final-observations.json', {
            body: JSON.stringify(
              await page.locator('[data-functional-example="reasoning"] output').allTextContents(),
            ),
            contentType: 'application/json',
          });
      }
    },
    { auto: true },
  ],
});
export { expect };

export async function openReasoning(page) {
  const host = await openExample(page, 'reasoning', 'reasoning');
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
  return { host, thinking: exercise(host, 'thinking'), history: exercise(host, 'history') };
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
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        nodes: [
          ...root.querySelectorAll(
            'button,a,section,[data-operational-summary],[data-reasoning-expanded-body],[data-reasoning-history-body],p,h1,h2,h3,strong',
          ),
        ].map((node) => ({
          tag: node.localName,
          text: node.textContent,
          bounds: box(node),
          id: node.id,
          expanded: node.getAttribute('aria-expanded'),
          labelledby: node.getAttribute('aria-labelledby'),
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
  expect(after, 'Capture cannot alter geometry/content').toEqual(before);
}

export async function sameNode(current, previous) {
  expect(await current.evaluate((node, old) => node === old, previous)).toBe(true);
}
export async function detached(previous) {
  await expect.poll(() => previous.evaluate((node) => node.isConnected)).toBe(false);
}

function exercise(host, kind) {
  const name = kind === 'thinking' ? 'Thinking' : 'History';
  const section = host.getByRole('region', { name: `${name} exercise`, exact: true });
  const frame = section.getByTestId(`reasoning-${kind}-frame`);
  return {
    kind,
    name,
    section,
    frame,
    trigger: frame.getByTestId('reasoning-disclosure'),
    rows: frame.getByTestId(kind === 'thinking' ? 'reasoning-tool-call' : 'reasoning-history-row'),
    summaries: frame.getByTestId(
      kind === 'thinking' ? 'reasoning-summary' : 'reasoning-history-title',
    ),
    body: frame.locator(
      kind === 'thinking' ? '[data-reasoning-expanded-body]' : '[data-reasoning-history-body]',
    ),
    inputs: () => outputJson(section.getByLabel(`${name} current inputs`, { exact: true })),
    observations: () => outputJson(section.getByLabel(`${name} observations`, { exact: true })),
  };
}
export const button = (item, name) => item.section.getByRole('button', { name, exact: true });
export const field = (item, name) => item.section.getByRole('textbox', { name, exact: true });
export async function choice(item, name, value) {
  const radio = item.section
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}
export async function switchTo(item, name, checked) {
  const target = item.section.getByRole('switch', { name, exact: true });
  if ((await target.getAttribute('aria-checked')) !== String(checked)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(checked));
}
export async function raw(item, content) {
  await field(item, `${item.name} raw content`).fill(content);
  await expect.poll(async () => (await item.inputs()).props.content).toBe(content);
}
export async function refresh(item) {
  await button(item, `Refresh ${item.name} observations`).click();
  return item.observations();
}
export async function clear(item) {
  await button(item, `Clear ${item.name} observations`).click();
  const result = await item.observations();
  expect(result.callbacks).toEqual([]);
  expect(result.native).toEqual([]);
}
export async function saved(item) {
  await button(item, 'Refresh saved snapshots').click();
  return outputJson(item.section.getByLabel('Thinking saved snapshots', { exact: true }));
}
export async function replaceSaved(item, flags = {}) {
  for (const key of ['expanded', 'userToggled', 'searchOwnsExpansion'])
    await choice(item, `Initial saved ${key}`, key in flags ? String(flags[key]) : 'omit');
  await button(item, 'Replace saved object').click();
  return saved(item);
}
export async function remount(item) {
  await button(item, `Remount ${item.name}`).click();
}
export async function expanded(item, value, { emptyBody = false } = {}) {
  await expect(item.trigger).toHaveAttribute('aria-expanded', String(value));
  const detailsId = await item.trigger.getAttribute('aria-controls');
  expect(detailsId).toBeTruthy();
  const wrapper = item.frame.locator('[data-response-group-motion="animated-height"]');
  await expect(wrapper).toHaveAttribute('aria-hidden', String(!value));
  expect(await wrapper.evaluate((node) => node.inert)).toBe(!value);
  if (value) {
    await expect(wrapper).toHaveAttribute('id', detailsId);
    if (emptyBody) {
      await expect(item.body).toHaveCount(1);
      await expect(item.body).toHaveText('');
    } else {
      await expect(item.body).toBeVisible();
    }
  } else {
    await expect(wrapper).not.toHaveAttribute('id');
    await expect(item.body).toHaveCount(0);
  }
}
export async function manual(item, via, expected) {
  await clear(item);
  if (via === 'click') await item.trigger.click();
  else await item.trigger.press(via);
  await expanded(item, expected);
  await expect(item.trigger).toBeFocused();
  const record = await refresh(item);
  const clicks = record.native.filter(
    (event) => event.type === 'click' && event.phase === 'capture',
  );
  expect(clicks).toHaveLength(via === 'click' ? 1 : 0);
  if (via === 'click') expect(clicks[0]).toMatchObject({ isTrusted: true, detail: 1, button: 0 });
  else {
    const key = via === 'Space' ? ' ' : via;
    const keydown = record.native.filter((event) => event.type === 'keydown' && event.key === key);
    const captureEvent = keydown.find((event) => event.phase === 'capture');
    const bubbleEvent = keydown.find((event) => event.phase === 'bubble');
    expect(captureEvent).toMatchObject({ isTrusted: true, defaultPrevented: false });
    expect(bubbleEvent).toMatchObject({
      isTrusted: true,
      defaultPrevented: true,
      objectId: captureEvent.objectId,
    });
    expect(bubbleEvent.target.testId).toBe('reasoning-disclosure');
  }
  expect(record.callbacks.filter((entry) => entry.name !== 'canOpenFile')).toEqual([]);
  return record;
}
export async function search(item, action) {
  const name = action === 'both' ? 'Search expand and restore' : `Search ${action}`;
  await button(item, name).click();
  return outputJson(item.section.getByLabel('Thinking search requests', { exact: true }));
}

// Native DOM geometry describes reachability/overlap, never decorative CSS values.
export async function contained(item, info, name, requireControls = true) {
  await item.frame.scrollIntoViewIfNeeded();
  const result = await item.frame.evaluate((root) => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      frame: box(root),
      viewportWidth: window.innerWidth,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      controls: [...root.querySelectorAll('button,a')].map((node) => {
        const bounds = box(node);
        const hit = document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        );
        return { bounds, hittable: hit === node || node.contains(hit) };
      }),
      sections: [
        ...root.querySelectorAll('[data-reasoning-section],[data-operational-row-container]'),
      ].map(box),
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.frame.left).toBeGreaterThanOrEqual(0);
  expect(result.frame.right).toBeLessThanOrEqual(result.viewportWidth);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  if (requireControls) expect(result.controls.length).toBeGreaterThan(0);
  for (const { bounds, hittable } of result.controls) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(result.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(result.frame.right + 1);
    expect(hittable, 'Narrow content must leave controls operable').toBe(true);
  }
  return result;
}

export async function historyProjection(item, content, info) {
  const oracle = await originalProjection(item.frame.page(), content, info);
  await raw(item, content);
  const sections = item.frame.locator('[data-reasoning-section]');
  await expect(sections).toHaveCount(oracle.history.length);
  await expect
    .poll(() => item.frame.locator('[data-reasoning-section-title]').allTextContents())
    .toEqual(oracle.history.filter((entry) => entry.title).map((entry) => entry.title));
  await expect(item.body).toHaveCount(oracle.history.filter((entry) => entry.body).length);
  await expect(item.frame.getByRole('button')).toHaveCount(0);
  for (const [index, entry] of oracle.history.entries()) {
    const section = sections.nth(index);
    if (entry.title) {
      const title = section.locator('[data-reasoning-section-title]');
      const id = await title.getAttribute('id');
      expect(id).toBeTruthy();
      await expect(section).toHaveAttribute('aria-labelledby', id);
    } else await expect(section).not.toHaveAttribute('aria-labelledby');
    // Original parser puts a body only on the last item: no fabricated seam branch.
    await expect(section).not.toHaveAttribute('data-reasoning-section-boundary');
  }
  return oracle.history;
}

export const linkContent =
  '# Host routes\n\n[Web request](https://example.com/reasoning)\n\nFile mention: @src/a.ts:10\n\nNote mention: @note/spec';
export const updatedLinkContent =
  '# Current routes\n\n[Current request](https://example.com/current-reasoning)\n\nFile mention: @docs/current.ts:23\n\nNote mention: @note/current-note';
export const fileMention = (item) => item.frame.locator('[data-mention][data-type="file"]');
export const noteMention = (item) => item.frame.locator('[data-mention][data-type="note"]');
export async function activate(
  item,
  target,
  name,
  { via = 'click', modifiers = [], revision = 0 } = {},
) {
  await clear(item);
  if (via === 'click') await target.click({ modifiers });
  else await target.press(via);
  const records = await refresh(item);
  const navigations = records.callbacks.filter((entry) => entry.name !== 'canOpenFile');
  expect(navigations).toHaveLength(1);
  const record = navigations[0];
  expect(record).toMatchObject({ name, callbackRevision: revision });
  expect(record.capturedEvent).toMatchObject({
    isTrusted: true,
    type: via.includes('Enter') && via !== 'Enter' ? 'keydown' : 'click',
  });
  expect(
    records.native.some(
      (entry) => entry.objectId === record.capturedEvent.objectId && entry.phase === 'capture',
    ),
  ).toBe(true);
  return record;
}
export function linkArguments(
  record,
  url,
  workspace,
  panel,
  { canOpen = false, keyboard = false } = {},
) {
  expect(record.argumentCount).toBe(2);
  expect(record.arguments[0]).toBe(url);
  const options = record.arguments[1];
  expect(Object.keys(options).sort()).toEqual(
    ['canOpenFile', 'event', 'rawHref', 'sourcePanelId', 'workspaceId'].sort(),
  );
  expect(options).toMatchObject({ workspaceId: workspace, sourcePanelId: panel, rawHref: url });
  expect(options.event).toEqual(record.capturedEvent);
  expect(options.event).toMatchObject({
    type: keyboard ? 'keydown' : 'click',
    isTrusted: true,
    defaultPrevented: true,
    cancelBubble: true,
    sameAsCapturedEvent: true,
    target: { tag: 'A', panelId: panel },
    currentTarget: { tag: 'DIV', panelId: panel },
  });
  if (canOpen)
    expect(options.canOpenFile).toMatchObject({ type: 'function', objectId: expect.any(Number) });
  else expect(options.canOpenFile).toBe('[undefined]');
  return options.canOpenFile;
}
export function mentionArguments(
  record,
  workspace,
  id,
  panel,
  { file = false, adjacent = false, line } = {},
) {
  expect(record.argumentCount).toBe(3);
  expect(record.arguments).toEqual([
    workspace,
    id,
    { ...(file ? { line } : {}), openInAdjacentPanel: adjacent, sourcePanelId: panel },
  ]);
  expect(record.capturedEvent).toMatchObject({
    isTrusted: true,
    defaultPrevented: true,
    target: { tag: 'SPAN', panelId: panel },
  });
}
