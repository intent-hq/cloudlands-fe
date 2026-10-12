// Ignored executable draft; imports target future packages/view-parity placement.
// Publication, discovery and each native launch require separate coordinator releases.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

export { expect, outputJson };
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourcePort = 'ba312a2df08bfc289f90934119d1b9676632b2be';
const sourceCorrection = 'e46a388f145af8692411824e5afe7736f432e1ed';
const callerPort = 'ad42cda8b50b263d04255006f07894e39c74f176';
const integration = '1cea8e2be06cbdeeec657d13fb81d81700c07f80';
const releasedCandidate = {
  relativeRoot: '.demo-artifacts/view-parity/candidate-response-reaction-e46a388f1',
  url: 'http://127.0.0.1:5372',
  sourceTreeSha256: 'b9de2b32f5fffca326e0ebc6f912930a7e6328610ccd97532819f37c35a504cd',
  sourceFileCount: 7831,
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (files, sha) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const sourceFiles = [
  'apps/react/src/features/chat/components/response-group.tsx',
  'apps/react/src/features/chat/components/response-group.css',
  'apps/react/src/features/chat/components/cylinder-scroller.tsx',
  'apps/react/src/features/chat/components/cylinder-scroller.css',
  'src/lib/components/chat/ResponseGroup.svelte',
  'src/lib/components/chat/CylinderScroller.svelte',
  'src/lib/components/chat/response-group-timing.ts',
  'src/lib/components/chat/operational-cluster-projections.ts',
  'src/lib/components/chat/operational-disclosure-row.ts',
];
const correctedSourceFiles = ['apps/react/src/features/chat/components/response-group.tsx'];
const callerFiles = ['apps/react/src/catalog/response-group-examples.tsx'];
const unchanged = [
  'src/lib/components/chat/response-group-blocks.ts',
  'src/lib/components/chat/chat-search-disclosure.ts',
  'src/shared/utils/content-block-helpers.ts',
  'src/lib/components/chat/InlineMarkdownSnippet.svelte',
  'src/lib/components/chat/MessageContent.svelte',
  'src/lib/components/chat/StreamingMessageContent.svelte',
];
const profile = [
  ...sourceFiles,
  ...callerFiles,
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/styles/app.css',
  'apps/react/src/features/chat/components/chat-operational-row.tsx',
  'apps/react/src/features/chat/components/chat-motion.ts',
  'apps/react/src/features/chat/components/inline-markdown-snippet.tsx',
  'apps/react/src/components/icons/icon-definition.tsx',
  'apps/react/src/lib/motion/presence.ts',
  'src/lib/components/chat/disclosure-motion-core.ts',
  'src/lib/utils/smartScroll.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
];
const runnerFiles = [
  'packages/view-parity/lib/response-group.mjs',
  'packages/view-parity/tests/response-group.core.spec.mjs',
  'packages/view-parity/tests/response-group.extended.spec.mjs',
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
const english = JSON.parse(blob('messages/en.json'));
export const labels = {
  thinking: english.chat_thinkingBlock_thinking_label,
  reasoning: english.chat_thinkingBlock_reasoning_label,
};
const mapping = blob('src/lib/icons/phosphor-icons.ts').toString();
const originalVite = blob('vite.config.mjs').toString();
if (
  !originalVite.includes('src/lib/icons/phosphor-icons.ts') ||
  !originalVite.includes('src/lib/components/shared/icons/fa-proxy.ts')
)
  throw new Error('Original icon alias is unavailable');
const artwork = Object.fromEntries(
  ['faArrowsInLineVertical', 'faArrowsOutLineVertical'].map((definition) => {
    const name = mapping.match(
      new RegExp('export const ' + definition + " = icon\\('([^']+)'\\)"),
    )?.[1];
    const table = mapping.split('const iconComponents:')[1].split('\n};')[0];
    const symbol = [...table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
      (entry) => (entry[1] || entry[2]) === name,
    )?.[3];
    if (!symbol) throw new Error(`Original icon mapping missing: ${definition}`);
    const file = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
    const bytes = readFileSync(path.join(repoRoot, file), 'utf8');
    const body = bytes.split('weight === "regular"}')[1]?.split('{:')[0];
    if (!body) throw new Error(`Original regular artwork missing: ${symbol}`);
    return [
      definition,
      {
        name,
        symbol,
        file,
        sha256: digest(bytes),
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${body}</svg>`,
      },
    ];
  }),
);
const iconPackage = 'node_modules/phosphor-svelte/package.json';
const iconVersion = JSON.parse(readFileSync(path.join(repoRoot, iconPackage), 'utf8')).version;
if (!blob('pnpm-lock.yaml').toString().includes(`phosphor-svelte@${iconVersion}:`))
  throw new Error('Source artwork package differs from immutable lock');
const iconFiles = [iconPackage, ...Object.values(artwork).map((item) => item.file)];
const iconHashes = hashes(iconFiles);

export const test = base.extend({
  responseFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_RESPONSE_GROUP_APPROVED, 'Separate exact native GO required').toBe(
        '1',
      );
      const sha = process.env.PARITY_RESPONSE_GROUP_SHA;
      const testSha = process.env.PARITY_RESPONSE_GROUP_TEST_SHA;
      const caseId = process.env.PARITY_RESPONSE_GROUP_CASE;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(sha).toBe(sourceCorrection);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(caseId).toMatch(/^RG(?:[1-9]|1[0-3])$/);
      expect(info.title.startsWith(`response-group ${caseId} `)).toBe(true);
      expect(process.env.PARITY_GREP).toBe(`response-group ${caseId} `);
      expect(info.config.grep.source).toBe(`response-group ${caseId} `);
      expect(info.retry).toBe(0);
      expect(info.project.retries).toBe(0);
      expect(info.config.workers).toBe(1);
      const root = realpathSync(process.env.PARITY_CANDIDATE_ROOT);
      expect(root).not.toBe(realpathSync(repoRoot));
      expect(root).toBe(realpathSync(path.join(repoRoot, releasedCandidate.relativeRoot)));
      expect(process.env.PARITY_CANDIDATE_URL).toBe(releasedCandidate.url);
      execFileSync('git', ['merge-base', '--is-ancestor', integration, sha], { cwd: root });
      const read = () => ({
        runner: hashes(runnerFiles),
        source: hashes(sourceFiles, root),
        caller: hashes(callerFiles, root),
        unchanged: hashes(unchanged, root),
        profile: hashes(profile, root),
        generated: hashes(generated, root),
        icons: hashes(iconFiles),
        candidate: candidateProvenance(root),
      });
      const before = read();
      expect(before.runner).toEqual(committed(runnerFiles, testSha));
      expect(before.source).toEqual({
        ...committed(sourceFiles, sourcePort),
        ...committed(correctedSourceFiles, sourceCorrection),
      });
      expect(before.caller).toEqual(committed(callerFiles, callerPort));
      expect(before.unchanged).toEqual(committed(unchanged, original));
      expect(before.profile).toEqual(committed(profile, sha));
      expect(before.icons).toEqual(iconHashes);
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      expect(before.candidate.sourceTreeSha256).toBe(releasedCandidate.sourceTreeSha256);
      expect(Object.keys(before.candidate.sourceSha256)).toHaveLength(
        releasedCandidate.sourceFileCount,
      );
      try {
        await use();
      } finally {
        const after = read();
        await info.attach('response-group-freeze.json', {
          body: JSON.stringify(
            {
              original,
              sourcePort,
              sourceCorrection,
              callerPort,
              integration,
              releasedCandidate,
              sha,
              testSha,
              caseId,
              root,
              before,
              after,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after, 'Source, runner, generated inputs and candidate must remain frozen').toEqual(
          before,
        );
      }
    },
    { auto: true },
  ],
  responseNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('response-group-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});
// This runner's browser is independent of user/other-agent windows. End every
// one-case launch with all of its contexts closed, including an assertion failure.
test.afterEach(async ({ browser }) => {
  const closed = await Promise.allSettled(browser.contexts().map((context) => context.close()));
  expect(closed.filter((result) => result.status === 'rejected')).toEqual([]);
});

export const button = (host, name) => host.getByRole('button', { name, exact: true });
export async function choice(host, name, value) {
  const item = host
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  if ((await item.getAttribute('aria-checked')) !== 'true') await item.click();
  await expect(item).toHaveAttribute('aria-checked', 'true');
}
export async function toggle(host, name, checked) {
  const item = host.getByRole('switch', { name, exact: true });
  if ((await item.getAttribute('aria-checked')) !== String(checked)) await item.click();
  await expect(item).toHaveAttribute('aria-checked', String(checked));
}
export function group(host, name) {
  const frame = host.getByTestId(`response-${name.toLowerCase()}-frame`);
  return {
    name,
    frame,
    root: frame.getByTestId('response-group'),
    trigger: frame.getByTestId('response-group-disclosure'),
    child: frame.getByTestId(`${name.toLowerCase()}-children`),
    details: frame.locator('[data-operational-expanded-content]'),
    preview: frame.locator('[data-operational-preview-content]'),
    input: frame.getByRole('textbox', { name: `${name} child edit`, exact: true }),
  };
}
export async function openGroups(page) {
  const host = await openExample(page, 'response-group', 'response-group');
  await expect(host).toHaveAttribute('data-example-ready', 'true');
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      preload: typeof window.electronAPI,
      daemon: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
    })),
  ).toEqual({
    width: 420,
    height: 900,
    reduced: true,
    dark: false,
    preload: 'undefined',
    daemon: null,
  });
  await page.evaluate(() => document.fonts.ready);
  // RG14's follower/motion lease is explicitly outside this reduced-motion scope.
  await toggle(host, 'Attach canonical group follower', false);
  return {
    host,
    primary: group(host, 'Primary'),
    neighbor: group(host, 'Neighbor'),
    frame: host.getByTestId('response-groups-scroll'),
    cylinderFrame: host.getByTestId('response-cylinder-frame'),
    cylinder: host.getByTestId('response-cylinder-frame').getByRole('group'),
  };
}
export async function expanded(item, value) {
  await expect(item.trigger).toHaveAttribute('aria-expanded', String(value));
  await expect(item.details).toHaveCount(value ? 1 : 0);
  if (value) {
    const id = await item.trigger.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    await expect(item.details).toHaveAttribute('id', id);
    expect(
      await item.details.evaluate(
        (node) => node.inert || node.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(false);
  }
}
export async function sameNode(locator, old) {
  expect(await locator.evaluate((node, before) => node === before, old)).toBe(true);
}
export async function detached(old) {
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
}
export async function owners(item, groupName = 'Primary') {
  await button(item.host, `Read ${groupName} observations`).click();
  return outputJson(item.host.getByLabel(`${groupName} saved snapshots`, { exact: true }));
}
export async function receipts(item, info, name) {
  await button(item.host, 'Read response event receipts').click();
  const value = await outputJson(item.host.getByLabel('Response event receipts', { exact: true }));
  await info.attach(`${name}-receipts.json`, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
  return value;
}
export async function seed(
  item,
  { name = 'Primary', expanded: initial = 'omit', search = 'omit', override = 'omit' } = {},
) {
  await toggle(item.host, `Mount ${name}`, false);
  await choice(item.host, `${name} initial saved expanded`, initial);
  await choice(item.host, `${name} initial saved searchOwnsExpansion`, search);
  await choice(item.host, `${name} initial saved override`, override);
  await button(item.host, `Replace ${name} saved owner`).click();
  await toggle(item.host, `Mount ${name}`, true);
}
export async function childAction(item, label, info, revision) {
  const before = await receipts(item, info, `${label}-${revision}-before`);
  await button(
    item.host.getByTestId(`${label.toLowerCase()}-children`),
    `${label} child action`,
  ).click();
  const after = await receipts(item, info, `${label}-${revision}-after`);
  const matching = (value) =>
    value.callbacks.filter((r) => r.kind === 'child-button' && r.label === label);
  expect(matching(after).length).toBe(matching(before).length + 1);
  const receipt = matching(after).at(-1);
  expect(receipt).toMatchObject({
    callbackRevision: revision,
    event: { isTrusted: true, type: 'click' },
  });
  expect(
    after.native.some(
      (r) =>
        r.objectId === receipt.event.objectId &&
        r.type === 'click' &&
        r.isTrusted &&
        r.currentTarget?.testId ===
          (label === 'Cylinder'
            ? 'response-cylinder-frame'
            : `response-${label.toLowerCase()}-frame`),
    ),
  ).toBe(true);
}
export const scrollState = (scroll) =>
  scroll.evaluate((node) => ({
    top: node.scrollTop,
    total: node.scrollHeight,
    height: node.clientHeight,
  }));
export async function bottom(scroll) {
  await expect
    .poll(async () => {
      const s = await scrollState(scroll);
      return s.total - s.height - s.top;
    })
    .toBeLessThanOrEqual(5);
}
export async function wheel(page, scroll, delta) {
  await scroll.hover({ position: { x: 2, y: 2 } });
  const box = await scroll.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}
export async function focusCylinder(item) {
  await item.cylinder.click({ position: { x: 1, y: 1 } });
  await expect(item.cylinder).toBeFocused();
}
export async function grow(item) {
  const before = await scrollState(item.cylinder);
  await button(item.host, 'Grow Cylinder content').click();
  await expect
    .poll(async () => (await scrollState(item.cylinder)).total)
    .toBeGreaterThan(before.total);
  return before;
}
export async function expectArtwork(item, definition, info) {
  const expected = artwork[definition];
  const svg = item.trigger.locator('[data-response-group-disclosure-icon] svg');
  await expect(svg).toHaveCount(1);
  const observed = await svg.evaluate((node, source) => {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    const shapes = (root) =>
      [...root.querySelectorAll('path,circle,ellipse,line,polyline,polygon,rect')]
        .filter((n) => !(n.localName === 'rect' && n.getAttribute('fill') === 'none'))
        .map((n) => ({
          tag: n.localName,
          attributes: Object.fromEntries(
            [...n.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }));
    return {
      actual: shapes(node),
      expected: shapes(parsed),
      viewBox: node.getAttribute('viewBox'),
      expectedViewBox: parsed.documentElement.getAttribute('viewBox'),
      hidden: node.getAttribute('aria-hidden'),
      parserError: Boolean(parsed.querySelector('parsererror')),
    };
  }, expected.svg);
  await info.attach(`${definition}-artwork.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parserError).toBe(false);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.actual.length).toBeGreaterThan(0);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
}
async function probe(frame) {
  return {
    geometry: await frame.evaluate((root) => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY },
        frame: box(root),
        active: {
          id: document.activeElement?.id,
          testId: document.activeElement?.getAttribute('data-testid'),
          text: document.activeElement?.textContent,
        },
        nodes: [
          root,
          ...root.querySelectorAll(
            '[data-operational-row-container],[data-operational-expanded-content],[data-operational-preview-content],[data-response-group-child],[role="group"],button,input',
          ),
        ].map((node) => ({
          tag: node.localName,
          id: node.id,
          testId: node.getAttribute('data-testid'),
          bounds: box(node),
          top: node.scrollTop,
          total: node.scrollHeight,
          height: node.clientHeight,
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
          inert: node.inert,
          hidden: node.getAttribute('aria-hidden'),
          expanded: node.getAttribute('aria-expanded'),
          value: node instanceof HTMLInputElement ? node.value : null,
        })),
      };
    }),
    ax: await frame.ariaSnapshot(),
  };
}
export async function capture(page, item, name, info, frame = item.frame) {
  // A native pointer action may reveal this scrollport before the evidence probe.
  // No scroll offset, CSS, clock, event, observer or component state is injected.
  await frame.hover({ position: { x: 2, y: 2 } });
  const visibleBox = await frame.boundingBox();
  expect(visibleBox).not.toBeNull();
  await frame.hover({ position: { x: 2, y: Math.max(1, visibleBox.height - 2) } });
  await page.evaluate(() => document.fonts.ready);
  let before;
  await expect
    .poll(async () => {
      const first = await probe(frame);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      before = await probe(frame);
      return JSON.stringify(first) === JSON.stringify(before);
    })
    .toBe(true);
  expect(before.geometry.frame.x).toBeGreaterThanOrEqual(0);
  expect(before.geometry.frame.x + before.geometry.frame.width).toBeLessThanOrEqual(420);
  expect(before.geometry.frame.y).toBeGreaterThanOrEqual(0);
  expect(before.geometry.frame.y + before.geometry.frame.height).toBeLessThanOrEqual(900);
  await info.attach(`${name}-before.json`, {
    body: JSON.stringify(before, null, 2),
    contentType: 'application/json',
  });
  const png = await stableLocatorScreenshot(page, frame, async ({ png: raw, ...attempt }) => {
    if (raw)
      await info.attach(`${name}-attempt-${attempt.attempt}.png`, {
        body: raw,
        contentType: 'image/png',
      });
    await info.attach(`${name}-attempt-${attempt.attempt}.json`, {
      body: JSON.stringify({ ...attempt, sha256: raw ? digest(raw) : null }, null, 2),
      contentType: 'application/json',
    });
  });
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  const viewport = await page.screenshot({
    animations: 'allow',
    caret: 'hide',
    scale: 'css',
    fullPage: false,
  });
  await info.attach(`${name}-viewport.png`, { body: viewport, contentType: 'image/png' });
  const after = await probe(frame);
  await info.attach(`${name}-geometry-ax.json`, {
    body: JSON.stringify({ before, after, sha256: digest(png) }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capture must not change geometry, scroll, focus or accessibility').toEqual(before);
}
export async function hittable(locator, info, name) {
  await locator.hover();
  const geometry = await locator.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      viewport: { width: innerWidth, height: innerHeight },
      receivesPointer: hit !== null && node.contains(hit),
    };
  });
  await info.attach(`${name}-hit-geometry.json`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(420);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(900);
  expect(geometry.receivesPointer).toBe(true);
}
