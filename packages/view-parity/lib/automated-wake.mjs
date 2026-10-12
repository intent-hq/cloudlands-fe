import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Local native callback contracts only: no navigation, source-pixel, full-motion
// or production integration acceptance. The oracle never imports the React port.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const unchangedSources = [
  'src/lib/components/chat/AutomatedWakeCardHeader.svelte',
  'src/lib/components/chat/automated-wake-presentation.ts',
  'src/lib/utils/pr-monitor-wake-attribution.ts',
  'src/lib/utils/pr-chip-label.ts',
  'src/lib/utils/hook-wake-attribution.ts',
  'src/lib/utils/script-monitor-wake-attribution.ts',
  'src/lib/actions/observe-overflow.ts',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/components/shared/icons/FaWrapper.svelte',
];
// These neutral extractions and the complete catalog are pinned to the separately
// released candidate. The selected message values still come from original003.
const extractedDependencies = [
  'src/lib/components/chat/operational-disclosure-classes.ts',
  'src/lib/components/chat/subscription-disclosure-classes.ts',
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
  'packages/view-parity/lib/automated-wake.mjs',
  'packages/view-parity/tests/automated-wake.core.spec.mjs',
  'packages/view-parity/tests/automated-wake.extended.spec.mjs',
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

// Read expected localized contracts and icon definitions from immutable003,
// never from the candidate component or its presentation projection.
const english = JSON.parse(committed('messages/en.json'));
const headerSource = committed(unchangedSources[0]);
const messageKeys = [
  ...new Set([...headerSource.matchAll(/m\.(\w+)\(/g)].map((x) => x[1])),
  'chat_hookWakeAttribution_fallbackName_label',
];
export const label = (key, args = {}) => {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Missing original message argument ${name}`);
    return String(args[name]);
  });
};
const originalMapping = committed('src/lib/icons/phosphor-icons.ts');
const originalVite = committed('vite.config.mjs');
if (
  !originalVite.includes('src/lib/icons/phosphor-icons.ts') ||
  !originalVite.includes('src/lib/components/shared/icons/fa-proxy.ts')
)
  throw new Error('Original icon aliases changed');
const artwork = Object.fromEntries(
  ['faBolt', 'faTerminal', 'faCodePullRequest', 'faChevronDown'].map((definition) => {
    const name = originalMapping.match(
      new RegExp('export const ' + definition + " = icon\\('([^']+)'\\)"),
    )?.[1];
    const table = originalMapping.split('const iconComponents:')[1].split('\n};')[0];
    const symbol = [...table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
      (entry) => (entry[1] || entry[2]) === name,
    )?.[3];
    if (!symbol) throw new Error(`Missing original icon mapping ${definition}`);
    const file = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
    const bytes = readFileSync(path.join(repoRoot, file), 'utf8');
    const body = bytes.split('weight === "regular"}')[1]?.split('{:')[0];
    if (!body) throw new Error(`Missing original regular icon artwork ${symbol}`);
    return [
      definition,
      {
        definition,
        name,
        symbol,
        file,
        sha256: digest(bytes),
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + body + '</svg>',
      },
    ];
  }),
);
const iconPackage = 'node_modules/phosphor-svelte/package.json';
const iconVersion = JSON.parse(readFileSync(path.join(repoRoot, iconPackage), 'utf8')).version;
if (!committed('pnpm-lock.yaml').includes('phosphor-svelte@' + iconVersion + ':'))
  throw new Error('Local icon version differs from original lock');
const iconFiles = [iconPackage, ...Object.values(artwork).map((item) => item.file)];
const iconHashes = hashes(iconFiles);

export const test = base.extend({
  wakeFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_AUTOMATED_WAKE_APPROVED, 'Explicit runtime release required').toBe(
        '1',
      );
      const sha = process.env.PARITY_AUTOMATED_WAKE_SHA;
      const testSha = process.env.PARITY_AUTOMATED_WAKE_TEST_SHA;
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
      expect(hashes(iconFiles)).toEqual(iconHashes);
      const sourceBefore = hashes(unchangedSources);
      expect(sourceBefore).toEqual(committedHashes(unchangedSources));
      expect(hashes(unchangedSources, root)).toEqual(sourceBefore);
      const extractedBefore = hashes(extractedDependencies, root);
      expect(extractedBefore).toEqual(committedHashes(extractedDependencies, sha));
      const generatedBefore = hashes(generatedDependencies, root);
      const currentEnglish = JSON.parse(readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
      for (const key of messageKeys)
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
        await info.attach('automated-wake-freeze.json', {
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
              messageKeys,
              iconVersion,
              iconHashes,
              artwork,
              originalMappingSha256: digest(originalMapping),
              originalViteSha256: digest(originalVite),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(hashes(iconFiles)).toEqual(iconHashes);
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
  wakeNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('automated-wake-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  wakeObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('automated-wake-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="automated-wake"] pre')
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

export async function openWake(page) {
  const host = await openExample(page, 'automated-wake', 'automated-wake');
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
  const frame = host.getByTestId('automated-wake-frame');
  const header = frame.getByTestId('automated-wake-header');
  return {
    host,
    frame,
    header,
    primary: header.getByTestId('automated-wake-primary-label'),
    script: header.getByTestId('automated-wake-text-lane').locator(':scope > span').first(),
    status: header.getByTestId('wake-status'),
    chevron: header.getByTestId('automated-wake-toggle'),
    chip: header.getByTestId('pr-monitor-wake-chip'),
    state: () => outputJson(host.getByTestId('automated-wake-state')),
  };
}

export const control = (item, name) => item.host.getByRole('button', { name, exact: true });
export const toggle = (item, name) => item.host.getByRole('switch', { name, exact: true });
export const field = (item, name) => item.host.getByRole('textbox', { name, exact: true });
export const choice = (item, name, value) => item.host.getByTestId(`wake-${name}-${value}`);
export async function apply(item) {
  const revision = (await item.state()).inputRevision;
  await control(item, 'Apply wake inputs').click();
  await expect.poll(async () => (await item.state()).inputRevision).toBe(revision + 1);
  await expect(item.host.getByTestId('wake-input-error')).toHaveCount(0);
}
export async function kind(item, value) {
  await choice(item, 'kind', value).click();
  await apply(item);
  await expect(item.header).toHaveAttribute('data-wake-kind', value);
}
export async function expectCounts(item, ontoggle, onPinnedActivate = 0, onOpenLink = 0) {
  await expect
    .poll(async () => (await item.state()).counts)
    .toEqual({ ontoggle, onPinnedActivate, onOpenLink });
}
export async function activate(
  item,
  target,
  { name, via = 'click', args = [], revision = 0, mountRevision = 0, stop = false },
) {
  const before = await item.state();
  const expectedCounts = { ...before.counts, [name]: before.counts[name] + 1 };
  if (via === 'click') await target.click();
  else await target.press(via);
  await expect.poll(async () => (await item.state()).counts).toEqual(expectedCounts);
  const after = await item.state();
  const record = after.callbacks.at(-1);
  expect(record).toMatchObject({ name, callbackRevision: revision, mountRevision });
  expect(record.capturedClick).toMatchObject({
    type: 'click',
    isTrusted: true,
    defaultPrevented: false,
    cancelBubble: stop,
    detail: via === 'click' ? 1 : 0,
    button: 0,
  });
  if (args === 'button-event') {
    expect(record.argumentCount).toBe(1);
    expect(record.arguments).toEqual([
      {
        type: 'react-mouse-event',
        nativeEvent: record.capturedClick,
        sameAsCapturedClick: true,
        currentTargetTestId: 'automated-wake-toggle',
        defaultPrevented: false,
        propagationStopped: false,
      },
    ]);
  } else {
    expect(record.argumentCount).toBe(args.length);
    expect(record.arguments).toEqual(args);
  }
  expect(after.parentCounts).toEqual({
    'click-capture': before.parentCounts['click-capture'] + 1,
    'click-bubble': before.parentCounts['click-bubble'] + (stop ? 0 : 1),
    'pointer-capture': before.parentCounts['pointer-capture'] + (via === 'click' ? 1 : 0),
    'pointer-bubble': before.parentCounts['pointer-bubble'] + (via === 'click' ? 1 : 0),
  });
  const clickEvents = after.parent.filter(
    (event) => event.objectId === record.capturedClick.objectId,
  );
  expect(clickEvents.map((event) => event.phase)).toEqual(
    stop ? ['click-capture'] : ['click-capture', 'click-bubble'],
  );
  for (const event of clickEvents)
    expect(event).toMatchObject({ type: 'click', isTrusted: true, defaultPrevented: false });
  return record;
}
export async function sameNode(current, old) {
  expect(await current.evaluate((node, previous) => node === previous, old)).toBe(true);
}
export async function detached(old) {
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
}

export async function expectArtwork(item, definition, info) {
  const expected = artwork[definition];
  const svg =
    definition === 'faChevronDown'
      ? item.chevron.locator('svg')
      : item.header.locator(':scope > span[aria-hidden="true"] svg');
  await expect(svg).toHaveCount(1);
  const observed = await svg.evaluate((node, source) => {
    const tree = new DOMParser().parseFromString(source, 'image/svg+xml');
    const shapes = (root) =>
      [...root.querySelectorAll('path,circle,ellipse,line,polyline,polygon,rect')]
        .filter((shape) => !(shape.localName === 'rect' && shape.getAttribute('fill') === 'none'))
        .map((shape) => ({
          tag: shape.localName,
          attributes: Object.fromEntries(
            [...shape.attributes]
              .map((a) => [a.name, a.value])
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        }));
    return {
      actual: shapes(node),
      expected: shapes(tree),
      viewBox: node.getAttribute('viewBox'),
      expectedViewBox: tree.documentElement.getAttribute('viewBox'),
      hidden: node.getAttribute('aria-hidden'),
      parseError: !!tree.querySelector('parsererror'),
    };
  }, expected.svg);
  await info.attach(`artwork-${definition}.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
  expect(digest(readFileSync(path.join(repoRoot, expected.file)))).toBe(expected.sha256);
}

export async function captureWake(page, item, name, info) {
  await item.frame.scrollIntoViewIfNeeded();
  const geometry = () =>
    item.frame.evaluate((root) => {
      const bounds = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        frame: bounds(root),
        nodes: [...root.querySelectorAll('button,span,svg')].map((node) => ({
          text: node.textContent,
          title: node.getAttribute('title'),
          bounds: bounds(node),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        })),
      };
    });
  const before = await geometry();
  await captureTranscript(page, item.frame, name, info);
  const after = await geometry();
  await info.attach(`${name}-wake-geometry.json`, {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capture must not change title, text, or geometry').toEqual(before);
}

export async function expectOverflow(node, overflowing, title) {
  await expect
    .poll(() =>
      node.evaluate((element) => ({
        visible: element.clientWidth > 0 && element.clientHeight > 0,
        overflow:
          element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
        title: element.getAttribute('title'),
      })),
    )
    .toEqual({ visible: true, overflow: overflowing, title });
}

export async function expectContained(item, info, name) {
  await item.frame.scrollIntoViewIfNeeded();
  const result = await item.frame.evaluate((root) => {
    const bounds = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      frame: bounds(root),
      viewport: innerWidth,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      controls: [...root.querySelectorAll('button')].map((node) => {
        const box = bounds(node);
        const hit = document.elementFromPoint(
          (box.left + box.right) / 2,
          (box.top + box.bottom) / 2,
        );
        return { bounds: box, hit: node === hit || node.contains(hit) };
      }),
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.frame.left).toBeGreaterThanOrEqual(0);
  expect(result.frame.right).toBeLessThanOrEqual(result.viewport);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  expect(result.controls.length).toBeGreaterThan(0);
  for (const { bounds, hit } of result.controls) {
    expect(bounds.left).toBeGreaterThanOrEqual(result.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(result.frame.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(result.frame.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(result.frame.bottom + 1);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(hit, 'Actual controls must remain unobscured').toBe(true);
  }
}
