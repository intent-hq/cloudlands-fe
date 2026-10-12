import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

// Draft only: publication and each native case require separate coordinator releases.
// No copied step algorithm, formatter, component state, or expected DOM projection.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourcePort = 'bcd6ad0ff40c1787cbb761e692f6ccbbd32c4adc';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committedHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const unchanged = [
  'src/lib/components/chat/ExecutionPlanCard.svelte',
  'src/lib/components/chat/DigestCard.svelte',
  'src/lib/components/shared/icons/FaWrapper.svelte',
  'src/lib/components/shared/icons/fa-proxy.ts',
  'src/lib/components/ui/indicators/IntentMarkLoader.svelte',
  'src/lib/components/ui/indicators/intent-mark-vector.ts',
  'src/lib/components/ui/indicators/intent-mark-motion.ts',
  'src/lib/i18n/format.ts',
  'src/shared/i18n/formatters.ts',
];
const leaves = [
  'apps/react/src/features/chat/components/execution-plan-card.tsx',
  'apps/react/src/features/chat/components/digest-card.tsx',
];
const profile = [
  ...leaves,
  'apps/react/src/catalog/transcript-card-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/components/ui/indicators.tsx',
  'apps/react/src/components/ui/indicators.css',
  'apps/react/src/components/icons/icon-definition.tsx',
  'apps/react/src/styles/app.css',
  'src/lib/components/chat/operational-disclosure-classes.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'src/shared/types/content-block.ts',
  'messages/en.json',
];
const runnerFiles = [
  'packages/view-parity/lib/transcript-cards.mjs',
  'packages/view-parity/tests/transcript-cards.core.spec.mjs',
  'packages/view-parity/tests/transcript-cards.extended.spec.mjs',
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

const english = JSON.parse(blob('messages/en.json').toString('utf8'));
export function label(key, args = {}) {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Missing original message argument ${name}`);
    return String(args[name]);
  });
}
const originalMapping = blob('src/lib/icons/phosphor-icons.ts').toString('utf8');
const originalVite = blob('vite.config.mjs').toString('utf8');
if (
  !originalVite.includes('src/lib/icons/phosphor-icons.ts') ||
  !originalVite.includes('src/lib/components/shared/icons/fa-proxy.ts')
)
  throw new Error('Original icon alias could not be resolved');
const artwork = Object.fromEntries(
  ['faCheck', 'faCircle', 'faListCheck'].map((definition) => {
    const name = originalMapping.match(
      new RegExp('export const ' + definition + " = icon\\('([^']+)'\\)"),
    )?.[1];
    const table = originalMapping.split('const iconComponents:')[1].split('\n};')[0];
    const symbol = [...table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
      (entry) => (entry[1] || entry[2]) === name,
    )?.[3];
    if (!symbol) throw new Error(`Missing original mapping ${definition}`);
    const file = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
    const bytes = readFileSync(path.join(repoRoot, file), 'utf8');
    const body = bytes.split('weight === "regular"}')[1]?.split('{:')[0];
    if (!body) throw new Error(`Missing original regular artwork ${symbol}`);
    return [
      definition,
      {
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
if (!blob('pnpm-lock.yaml').toString('utf8').includes(`phosphor-svelte@${iconVersion}:`))
  throw new Error('Installed source icon package differs from original lock');
const iconFiles = [iconPackage, ...Object.values(artwork).map((item) => item.file)];
const iconHashes = hashes(iconFiles);
const vector = blob('src/lib/components/ui/indicators/intent-mark-vector.ts').toString('utf8');
const vectorViewBox = vector.match(/export const intentMarkViewBox = '([^']+)'/)?.[1];
const vectorPaths = [
  ...vector
    .split('export const intentMarkPaths = [')[1]
    .split('] as const;')[0]
    .matchAll(/'([^']+)'/g),
].map((item) => item[1]);
if (!vectorViewBox || vectorPaths.length !== 5)
  throw new Error('Original mark geometry is missing');

export const test = base.extend({
  transcriptFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_TRANSCRIPT_CARDS_APPROVED, 'Explicit native release required').toBe(
        '1',
      );
      const sha = process.env.PARITY_TRANSCRIPT_CARDS_SHA;
      const testSha = process.env.PARITY_TRANSCRIPT_CARDS_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retry is authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root)).not.toBe(realpathSync(repoRoot));
      const read = () => ({
        runner: hashes(runnerFiles),
        source: hashes(unchanged, root),
        product: hashes(profile, root),
        generated: hashes(generated, root),
        icons: hashes(iconFiles),
        candidate: candidateProvenance(root),
      });
      const before = read();
      expect(before.runner).toEqual(committedHashes(runnerFiles, testSha));
      expect(before.source).toEqual(committedHashes(unchanged));
      expect(before.product).toEqual(committedHashes(profile, sha));
      expect(hashes(leaves, root)).toEqual(committedHashes(leaves, sourcePort));
      expect(before.icons).toEqual(iconHashes);
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      try {
        await use();
      } finally {
        const after = read();
        await info.attach('transcript-cards-freeze.json', {
          body: JSON.stringify(
            { original, sourcePort, sha, testSha, root, before, after },
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
  transcriptNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('transcript-cards-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});
export { expect };

export async function openCards(page) {
  const host = await openExample(page, 'transcript-cards', 'transcript-cards');
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
  const planFrame = host.getByTestId('transcript-plan-frame');
  const digestFrame = host.getByTestId('transcript-digest-frame');
  return {
    host,
    planFrame,
    digestFrame,
    stack: host.getByTestId('transcript-cards-stack'),
    plan: planFrame.getByTestId('execution-plan-card'),
    rows: planFrame.getByTestId('execution-plan-entries').getByRole('listitem'),
    digest: digestFrame.locator(':scope > div'),
  };
}
export async function applyPlan(item, entries) {
  await item.host.getByTestId('transcript-plan-json').fill(JSON.stringify(entries));
  await item.host.getByTestId('transcript-plan-apply').click();
  await expect(item.rows).toHaveCount(entries.length);
  for (const [index, entry] of entries.entries()) {
    await expect(item.rows.nth(index)).toHaveAttribute('data-plan-status', entry.status);
    await expect(item.rows.nth(index)).toContainText(entry.content);
  }
}
export async function applyDigest(item, value) {
  await item.host.getByTestId('transcript-digest-text').fill(value);
  await item.host.getByTestId('transcript-digest-apply').click();
  await expect.poll(() => item.digest.textContent()).toBe(value);
}
export async function mounted(item, kind, checked) {
  const toggle = item.host.getByTestId(`transcript-${kind}-mounted`);
  if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(checked));
}
export async function sameNode(current, previous) {
  expect(await current.evaluate((node, old) => node === old, previous)).toBe(true);
}
export async function detached(previous) {
  await expect.poll(() => previous.evaluate((node) => node.isConnected)).toBe(false);
}

export async function expectArtwork(svg, definition, info) {
  const expected = artwork[definition];
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
  await info.attach(`transcript-artwork-${definition}.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
}

export async function expectLoader(item, info) {
  const loader = item.plan.locator('svg[role="status"]');
  await expect(loader).toHaveCount(1);
  await expect(loader).toHaveAttribute('aria-label', label('ui_spinner_loading_ariaLabel'));
  const observed = await loader.evaluate((node) => ({
    viewBox: node.getAttribute('viewBox'),
    paths: [...node.querySelectorAll('path')].map((p) => p.getAttribute('d')),
    hiddenByAncestor: !!node.parentElement.closest('[aria-hidden="true"]'),
  }));
  await info.attach('transcript-loader-original-artwork.json', {
    body: JSON.stringify({ original, observed, expected: { vectorViewBox, vectorPaths } }, null, 2),
    contentType: 'application/json',
  });
  expect(observed).toEqual({ viewBox: vectorViewBox, paths: vectorPaths, hiddenByAncestor: true });
  await expect(item.plan.getByRole('status')).toHaveCount(0);
  await expect(item.plan.getByRole('img')).toHaveCount(0);
  const ax = await item.plan.ariaSnapshot();
  expect(ax).not.toContain(label('ui_spinner_loading_ariaLabel'));
  await info.attach('transcript-plan-hidden-loader-ax.txt', {
    body: ax,
    contentType: 'text/plain',
  });
}

export async function capture(page, frame, name, info) {
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const probe = async () => ({
    geometry: await frame.evaluate((root) => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        frame: box(root),
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        nodes: [...root.querySelectorAll('section,ol,li,span,h3,svg,div')].map((node) => ({
          tag: node.localName,
          text: node.textContent,
          bounds: box(node),
          current: node.getAttribute('aria-current'),
          hidden: node.getAttribute('aria-hidden'),
          role: node.getAttribute('role'),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        })),
      };
    }),
    aria: await frame.ariaSnapshot(),
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
    body: JSON.stringify({ before, after, sha256: digest(png) }, null, 2),
    contentType: 'application/json',
  });
  expect(
    after,
    'Screenshot capture must not alter actual geometry, text, or accessibility',
  ).toEqual(before);
}

export async function contained(item, info, name) {
  const observation = await item.stack.evaluate((root) => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const targets = [
      ...root.querySelectorAll(
        '[data-testid="execution-plan-card"],li,h3,[data-testid="transcript-digest-frame"] > div',
      ),
    ];
    const prose = [
      ...root.querySelectorAll(
        'li > span:last-child,[data-testid="transcript-digest-frame"] > div',
      ),
    ];
    return {
      viewport: innerWidth,
      frame: box(root),
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      targets: targets.map((node) => ({ tag: node.localName, bounds: box(node) })),
      prose: prose.map((node) => ({
        text: node.textContent,
        bounds: box(node),
        ranges: [...node.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())
          .flatMap((child) => {
            const range = document.createRange();
            range.selectNodeContents(child);
            return [...range.getClientRects()].map(
              ({ left, right, top, bottom, width, height }) => ({
                left,
                right,
                top,
                bottom,
                width,
                height,
              }),
            );
          }),
      })),
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(observation, null, 2),
    contentType: 'application/json',
  });
  expect(observation.viewport).toBe(420);
  expect(observation.frame.width).toBeGreaterThan(0);
  expect(observation.frame.left).toBeGreaterThanOrEqual(-1);
  expect(observation.frame.right).toBeLessThanOrEqual(observation.viewport + 1);
  expect(observation.scrollWidth).toBeLessThanOrEqual(observation.clientWidth + 1);
  for (const { bounds } of observation.targets) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(observation.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(observation.frame.right + 1);
  }
  expect(observation.prose.length).toBeGreaterThan(1);
  for (const { bounds, ranges } of observation.prose) {
    expect(ranges.length, 'Real prose must produce visible browser text ranges').toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.left).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(range.right).toBeLessThanOrEqual(bounds.right + 1);
      expect(range.top).toBeGreaterThanOrEqual(bounds.top - 1);
      expect(range.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
    }
  }
  return observation;
}
