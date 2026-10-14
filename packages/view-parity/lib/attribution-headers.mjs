import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

// Ordinary consumer callbacks on a real empty Store only. Canonical navigation
// dispatch, populated subscriptions and paired pixel parity remain unverified.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const blobHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const oraclePaths = [
  'src/lib/utils/agent-message-attribution.ts',
  'src/lib/utils/pr-monitor-wake-attribution.ts',
  'src/lib/utils/pr-chip-label.ts',
  'src/shared/constants/intent-links.ts',
  'src/shared/types/branded-ids.ts',
  'src/features/agent/components/agent-avatar/avatar-design.ts',
  'src/lib/utils/hash.ts',
];
// Transform original immutable modules, rewriting only their import locations.
// No candidate projector, exported catalog result or copied classification oracle.
const oracleUrls = new Map();
function oracleUrl(file) {
  if (oracleUrls.has(file)) return oracleUrls.get(file);
  let js = stripTypeScriptTypes(blob(file), { mode: 'transform' });
  js = js.replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => {
    const resolved = specifier.startsWith('$shared/')
      ? `src/shared/${specifier.slice(8)}.ts`
      : specifier.startsWith('$lib/')
        ? `src/lib/${specifier.slice(5)}.ts`
        : path.posix.join(path.posix.dirname(file), `${specifier}.ts`);
    if (!oraclePaths.includes(resolved)) throw new Error(`Unreviewed oracle import ${resolved}`);
    return `from ${quote}${oracleUrl(resolved)}${quote}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  oracleUrls.set(file, url);
  return url;
}
export const agentOracle = await import(oracleUrl(oraclePaths[0]));
export const prOracle = await import(oracleUrl(oraclePaths[1]));
const avatarOracle = await import(oracleUrl(oraclePaths[5]));
export const linksOracle = await import(oracleUrl(oraclePaths[3]));
const english = JSON.parse(blob('messages/en.json'));
export const label = (key, args = {}) => {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original localized message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Missing original localized argument ${name}`);
    return String(args[name]);
  });
};
const unchanged = [
  ...oraclePaths,
  'src/lib/components/chat/AgentMessageAttributionHeader.svelte',
  'src/lib/components/chat/PrMonitorWakeAttributionHeader.svelte',
  'src/lib/utils/assistant-agent-link.ts',
  'src/features/agent/components/agent-avatar/AgentAvatarArt.svelte',
  'src/features/agent/components/agent-avatar/AgentAvatarWithState.svelte',
  'src/shared/utils/agent-attention.ts',
];
// Neutral extractions change source paths, so record both original and current
// profiles explicitly instead of pretending the entire current source is003.
const originalProfile = [
  'src/features/agent/components/agent-avatar/avatar-state.ts',
  'src/features/agent/components/agent-avatar/AgentAvatar.svelte',
  'src/store/renderer/slices/permission/permission-selectors.ts',
  'src/store/renderer/slices/permission/permission-slice.ts',
  'src/store/renderer/slices/agent-session/agent-session-selectors.ts',
  'src/lib/components/chat/subscription-disclosure.ts',
  'src/lib/components/chat/PinnedTurnPrompt.svelte',
  'src/lib/components/chat/ChatMessage.svelte',
];
const currentProfile = [
  ...originalProfile,
  'src/features/agent/components/agent-avatar/avatar-state-core.ts',
  'src/store/renderer/slices/permission/permission-projections.ts',
  'src/store/renderer/slices/permission/permission-types.ts',
  'src/lib/components/chat/subscription-disclosure-classes.ts',
  'apps/react/src/store/index.ts',
  'apps/react/src/store/permission/permission-selectors.ts',
  'apps/react/src/store/agent-session/agent-session-selectors.ts',
  'apps/react/src/store/workspace/workspace-selectors.ts',
  'apps/react/src/features/chat/components/agent-message-attribution-header.tsx',
  'apps/react/src/features/chat/components/pr-monitor-wake-attribution-header.tsx',
  'apps/react/src/catalog/attribution-header-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/components/ui/button.tsx',
];
const runnerFiles = [
  'packages/view-parity/lib/attribution-headers.mjs',
  'packages/view-parity/tests/attribution-headers.core.spec.mjs',
  'packages/view-parity/tests/attribution-headers.extended.spec.mjs',
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

export const test = base.extend({
  attributionFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_ATTRIBUTION_APPROVED, 'Exact native release required').toBe('1');
      const sha = process.env.PARITY_ATTRIBUTION_SHA;
      const testSha = process.env.PARITY_ATTRIBUTION_TEST_SHA;
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
        profile: hashes(currentProfile, root),
        generated: hashes(generated, root),
        candidate: candidateProvenance(root),
      };
      expect(before.runner).toEqual(blobHashes(runnerFiles, testSha));
      expect(before.unchanged).toEqual(blobHashes(unchanged));
      expect(before.profile).toEqual(blobHashes(currentProfile, sha));
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.sourceDirty).toBe(false);
      try {
        await use();
      } finally {
        const after = {
          runner: hashes(runnerFiles),
          unchanged: hashes(unchanged, root),
          profile: hashes(currentProfile, root),
          generated: hashes(generated, root),
          candidate: candidateProvenance(root),
        };
        await info.attach('attribution-freeze.json', {
          body: JSON.stringify(
            {
              original,
              sha,
              testSha,
              root,
              originalProfile: blobHashes(originalProfile),
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
  attributionNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('attribution-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
        if (!page.isClosed())
          await info.attach('attribution-caller-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="attribution-headers"] output')
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

export async function openHeaders(page) {
  const host = await openExample(page, 'attribution-headers', 'attribution-headers');
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
  const section = (id) => {
    const frame = host.getByTestId(`${id}-frame`);
    const header = frame.getByTestId(
      id === 'agent' ? 'agent-message-disclosure-header' : 'pr-monitor-wake-attribution',
    );
    return {
      id,
      host,
      frame,
      header,
      primary: header.getByTestId(
        id === 'agent' ? 'agent-message-attribution' : 'pr-monitor-wake-chip',
      ),
      toggle: header.getByTestId('agent-message-disclosure-toggle'),
      state: () => outputJson(host.getByTestId(`${id}-state`)),
      counts: () => outputJson(host.getByTestId(`${id}-counts`)),
      callbacks: () => outputJson(host.getByTestId(`${id}-callbacks`)),
      parents: () => outputJson(host.getByTestId(`${id}-parent-events`)),
    };
  };
  return { host, agent: section('agent'), pr: section('pr') };
}
export const control = (item, suffix) => item.host.getByTestId(`${item.id}-${suffix}`);
export async function apply(item, fields = {}) {
  for (const [key, value] of Object.entries(fields)) await control(item, key).fill(value);
  const revision = (await item.state()).inputs.inputRevision;
  await control(item, 'apply').click();
  await expect.poll(async () => (await item.state()).inputs.inputRevision).toBe(revision + 1);
}
export async function switchTo(item, suffix, checked) {
  const target = control(item, suffix);
  if ((await target.getAttribute('aria-checked')) !== String(checked)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(checked));
}
export async function choice(item, suffix, value) {
  await control(item, `${suffix}-${value}`).click();
}
export async function clear(item) {
  await control(item, 'clear').click();
  await expect.poll(item.counts).toEqual({});
}
export async function currentAgent(item) {
  const state = await item.state();
  const expected = agentOracle.getAgentMessageAttribution(state.inputs.metadata);
  expect(state.inputs.attribution).toEqual(expected);
  return expected;
}
export async function currentPr(item) {
  const state = await item.state();
  const expected = prOracle.getPrMonitorWakeAttribution(state.inputs.metadata);
  expect(state.inputs.attribution).toEqual(expected);
  if (expected) await expect(item.primary).toHaveText(prOracle.getPrMonitorWakeChipLabel(expected));
  return expected;
}

export async function activate(
  item,
  target,
  {
    name,
    via = 'click',
    revision = 0,
    mountRevision = 0,
    nativeStop = true,
    cancelled = true,
    modifiers = [],
    position,
  } = {},
) {
  const before = await item.counts();
  if (via === 'click') await target.click({ modifiers, ...(position ? { position } : {}) });
  else await target.press(via);
  const expected = { ...before };
  for (const key of [
    name,
    'native-click-capture',
    ...(!nativeStop ? ['native-click-bubble'] : []),
    ...(!cancelled ? ['react-click-bubble'] : []),
    ...(via === 'click' ? ['native-pointerdown-capture', 'native-pointerdown-bubble'] : []),
  ])
    expected[key] = (expected[key] ?? 0) + 1;
  await expect.poll(item.counts).toEqual(expected);
  const record = (await item.callbacks()).at(-1);
  expect(record).toMatchObject({ name, callbackRevision: revision, mountRevision });
  expect(record.capturedClick).toMatchObject({
    type: 'click',
    isTrusted: true,
    sameAsCapturedClick: true,
    defaultPrevented: cancelled,
    cancelBubble: cancelled,
    detail: via === 'click' ? 1 : 0,
    button: 0,
  });
  const parents = (await item.parents()).filter(
    (event) => event.objectId === record.capturedClick.objectId,
  );
  expect(parents.map((event) => event.name)).toEqual([
    'native-click-capture',
    ...(!nativeStop ? ['native-click-bubble'] : []),
    ...(!cancelled ? ['react-click-bubble'] : []),
  ]);
  for (const event of parents)
    expect(event).toMatchObject({ isTrusted: true, defaultPrevented: false });
  return record;
}
export function zeroArgs(record) {
  expect(record.argumentCount).toBe(0);
  expect(record.arguments).toEqual([]);
}
export function nativeEvent(
  event,
  record,
  testId,
  { via = 'click', modifiers = [], panel = 'attribution-inner-panel', assistant = true } = {},
) {
  expect(event).toEqual(record.capturedClick);
  expect(event).toMatchObject({
    type: 'click',
    isTrusted: true,
    sameAsCapturedClick: true,
    defaultPrevented: true,
    cancelBubble: true,
    eventPhase: event.target.testId === event.currentTarget.testId ? 2 : 3,
    detail: via === 'click' ? 1 : 0,
    button: 0,
    buttons: 0,
    ctrlKey: modifiers.includes('Control'),
    metaKey: modifiers.includes('Meta'),
    shiftKey: modifiers.includes('Shift'),
    altKey: modifiers.includes('Alt'),
    currentTarget: {
      tag:
        testId === 'agent-message-attribution'
          ? record.name === 'onOpenLink'
            ? 'A'
            : 'BUTTON'
          : 'BUTTON',
      testId,
      panelId: panel,
      assistantPanels: assistant,
      assistantLayoutId: assistant ? 'attribution-assistant-layout' : null,
    },
  });
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
      width: window.innerWidth,
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
  await info.attach('attribution-containment.json', {
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

export async function avatarArt(header, agentId, specialist, info) {
  const design = avatarOracle.getAgentAvatarDesign(agentId, specialist);
  const svg = header.locator('svg[data-agent-avatar]');
  await expect(svg).toHaveAttribute('data-avatar-design', design);
  await expect(header.locator('[data-agent-avatar-with-state]')).toHaveAttribute(
    'data-avatar-state',
    'idle',
  );
  await expect(svg).toHaveAttribute('data-avatar-variant', 'standard');
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  // These two ordinary specialist props choose unconditional original art.
  // Fallback selection is checked against original hash/design logic above.
  if (!['implementor', 'verifier'].includes(design)) return;
  const source = blob('src/features/agent/components/agent-avatar/AgentAvatarArt.svelte');
  const art = source.split(`{:else if design === '${design}'}`)[1]?.split('{:else')[0];
  if (!art || /\{/.test(art))
    throw new Error('Original avatar art is not an unconditional SVG fragment');
  const observed = await svg.evaluate((node, markup) => {
    const expected = new window.DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
      'image/svg+xml',
    );
    const shapes = (root) =>
      [...root.querySelectorAll('path,circle,rect,g[transform]')].map((shape) => ({
        tag: shape.localName,
        attributes: Object.fromEntries(
          [...shape.attributes]
            .map((a) => [a.name, a.value])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      }));
    return {
      actual: shapes(node),
      expected: shapes(expected),
      invalid: !!expected.querySelector('parsererror'),
    };
  }, art);
  await info.attach(`attribution-avatar-${design}.json`, {
    body: JSON.stringify({ original, sourceSha256: digest(source), observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.invalid).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
}
