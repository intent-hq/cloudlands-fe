// Ignored draft: relative imports target later maintained placement.
// Publication, discovery, and each native case require separate coordinator releases.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

export { expect };
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const seamBase = '4840956c28776899b0655a4eead976a3c5dc0d32';
const productCommit = '0afebba98529ca847730de026cc30a1b0831b1d7';
const sourceCommit = '662e2cc514cb9d5fd67ec4f854cd9260e7d6cb00';
const source = 'src/lib/components/chat/DetectedScriptsCard.svelte';
const tokens = 'src/lib/styles/tokens.css';
const staticProof = 'a052fe7542ff499528f6100c83c41f2083e0de64b30577d6ba793b5eea5cef85';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (files, sha) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const unchanged = [
  'src/lib/components/shared/icons/FaWrapper.svelte',
  'src/lib/components/shared/icons/fa-proxy.ts',
  'src/lib/i18n/format.ts',
  'src/shared/i18n/formatters.ts',
];
const profile = [
  source,
  tokens,
  'apps/react/src/features/chat/components/detected-scripts-card.tsx',
  'apps/react/src/catalog/detected-script-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/catalog/catalog-app.tsx',
  'apps/react/src/catalog/catalog-shell.tsx',
  'apps/react/src/catalog/catalog-shell.css',
  'apps/react/src/catalog/catalog-controls.tsx',
  'apps/react/src/catalog/catalog-controls.css',
  'apps/react/src/catalog/catalog-preferences.ts',
  'apps/react/src/catalog/catalog-component-page.css',
  'apps/react/src/components/icons/icon-definition.tsx',
  'apps/react/src/styles/app.css',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'src/lib/icons/workspace-status-icons.ts',
  'src/lib/i18n/locale.ts',
  'src/shared/i18n/locale-matcher.ts',
  'messages/en.json',
];
const runnerFiles = [
  'packages/view-parity/lib/detected-scripts.mjs',
  'packages/view-parity/tests/detected-scripts.core.spec.mjs',
  'packages/view-parity/tests/detected-scripts.extended.spec.mjs',
  'packages/view-parity/lib/functional.mjs',
  'packages/view-parity/lib/chat-transcript.mjs',
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
const fonts = [
  'apps/react/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'apps/react/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
];
const english = JSON.parse(blob('messages/en.json'));
export function label(key, args = {}) {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original English message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in args)) throw new Error(`Missing original message argument ${key}`);
    return String(args[key]);
  });
}
export const service = label('chat_detectedScripts_service_badge');
export const command = label('chat_detectedScripts_command_badge');

// Independent original artwork oracle: original aliases/mapping and its pinned Svelte package.
const mapping = blob('src/lib/icons/phosphor-icons.ts');
const vite = blob('vite.config.mjs');
if (
  !vite.includes('src/lib/icons/phosphor-icons.ts') ||
  !vite.includes('src/lib/components/shared/icons/fa-proxy.ts') ||
  !mapping.includes("export const faWandMagicSparkles = icon('wand-magic-sparkles')") ||
  !mapping.includes("'wand-magic-sparkles': MagicWandIcon")
)
  throw new Error('Cannot resolve original magic wand artwork');
const iconFiles = [
  'node_modules/phosphor-svelte/package.json',
  'node_modules/phosphor-svelte/lib/MagicWandIcon.svelte',
];
const iconVersion = JSON.parse(readFileSync(path.join(repoRoot, iconFiles[0]), 'utf8')).version;
if (!blob('pnpm-lock.yaml').includes(`phosphor-svelte@${iconVersion}:`))
  throw new Error('Source artwork package differs from original lock');
const iconSource = readFileSync(path.join(repoRoot, iconFiles[1]), 'utf8');
const regular = iconSource.split('weight === "regular"}')[1]?.split('{:')[0];
if (!regular?.includes('<path')) throw new Error('Original regular wand artwork is absent');
const artwork = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${regular}</svg>`;
const iconHashes = hashes(iconFiles);

export const test = base.extend({
  detectedFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_DETECTED_SCRIPTS_APPROVED,
        'Separate exact native GO required',
      ).toBe('1');
      const sha = process.env.PARITY_DETECTED_SCRIPTS_SHA;
      const testSha = process.env.PARITY_DETECTED_SCRIPTS_TEST_SHA;
      const caseId = process.env.PARITY_DETECTED_SCRIPTS_CASE;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(sha, 'Only the reviewed combined source/caller revision is in scope').toBe(
        productCommit,
      );
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(caseId).toMatch(/^DS[1-6]$/);
      const prefix = `detected scripts ${caseId}:`;
      expect(info.title.startsWith(prefix)).toBe(true);
      expect(process.env.PARITY_GREP, 'Exactly one case per invocation').toBe(prefix);
      const session = JSON.parse(
        readFileSync(path.join(process.env.PARITY_RUN_DIR, 'session.json'), 'utf8'),
      );
      expect(session.grep).toBe(prefix);
      expect(info.retry).toBe(0);
      expect(info.project.retries).toBe(0);
      expect(info.config.workers).toBe(1);
      const root = realpathSync(process.env.PARITY_CANDIDATE_ROOT);
      expect(root).not.toBe(realpathSync(repoRoot));
      expect(root).toBe(
        realpathSync(
          path.join(repoRoot, '.demo-artifacts/view-parity/candidate-detected-scripts-0afebba98'),
        ),
      );
      expect(new URL(process.env.PARITY_CANDIDATE_URL).href).toBe('http://127.0.0.1:5373/');
      const read = () => ({
        runner: hashes(runnerFiles),
        originalSupport: hashes(unchanged, root),
        product: hashes(profile, root),
        generated: hashes(generated, root),
        fonts: hashes(fonts, root),
        icons: hashes(iconFiles),
        candidate: candidateProvenance(root),
      });
      const before = read();
      await info.attach('detected-scripts-freeze-before.json', {
        body: JSON.stringify(
          {
            original,
            seamBase,
            staticProof,
            sha,
            testSha,
            caseId,
            root,
            url: process.env.PARITY_CANDIDATE_URL,
            before,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      expect(before.runner).toEqual(committed(runnerFiles, testSha));
      expect(before.originalSupport).toEqual(committed(unchanged, original));
      expect(before.product).toEqual(committed(profile, sha));
      expect(
        before.product['apps/react/src/features/chat/components/detected-scripts-card.tsx'],
      ).toBe(
        digest(
          blob('apps/react/src/features/chat/components/detected-scripts-card.tsx', sourceCommit),
        ),
      );
      expect(before.icons).toEqual(iconHashes);
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.sourceDirty).toBe(false);
      const adapted = readFileSync(path.join(root, source), 'utf8');
      const restored = adapted.replace(
        'bg-script-service/15 text-script-service-foreground',
        'bg-blue-500/15 text-blue-600 dark:text-blue-400',
      );
      expect(restored, 'Only the reviewed source semantic alias substitution is allowed').toBe(
        blob(source),
      );
      const tokenSource = readFileSync(path.join(root, tokens), 'utf8');
      const tokenInverse = tokenSource
        .replace(
          '  /* Detected script service badges retain their source colors across renderers. */\n  --color-script-service: var(--color-blue-500);\n  --color-script-service-foreground: var(--color-blue-600);\n',
          '',
        )
        .replace('  --color-script-service-foreground: var(--color-blue-400);\n', '');
      expect(tokenInverse, 'Retain the exact separately reviewed semantic token seam').toBe(
        blob(tokens, seamBase),
      );
      const currentEnglish = JSON.parse(readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
      for (const key of Object.keys(english).filter((key) =>
        key.startsWith('chat_detectedScripts_'),
      ))
        expect(currentEnglish[key]).toBe(english[key]);
      try {
        await use();
      } finally {
        const after = read();
        await info.attach('detected-scripts-freeze.json', {
          body: JSON.stringify(
            {
              original,
              seamBase,
              staticProof,
              sha,
              testSha,
              caseId,
              root,
              url: process.env.PARITY_CANDIDATE_URL,
              before,
              after,
              originalHash: digest(blob(source)),
              inverseHash: digest(restored),
              iconVersion,
              originalIconMappingHash: digest(mapping),
              originalViteHash: digest(vite),
              scope:
                'Static semantic seam accepted separately; native result is not source-paired visual parity.',
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after.runner).toEqual(before.runner);
        expect(after.originalSupport).toEqual(before.originalSupport);
        expect(after.product).toEqual(before.product);
        expect(after.generated).toEqual(before.generated);
        expect(after.fonts).toEqual(before.fonts);
        expect(after.icons).toEqual(before.icons);
        expect(after.candidate.commit).toBe(sha);
        expect(after.candidate.sourceDirty).toBe(false);
        expect(after.candidate.sourceTreeSha256).toBe(before.candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  detectedNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('detected-scripts-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  detectedCallerObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('detected-scripts-caller.json', {
            body: JSON.stringify(
              await page.getByTestId('detected-scripts-state').allTextContents(),
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

export async function openDetected(page) {
  const host = await openExample(page, 'detected-scripts', 'detected-scripts');
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemon: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    })),
  ).toEqual({ preload: 'undefined', daemon: null, width: 420, height: 900, reduced: true });
  await page.evaluate(() => document.fonts.ready);
  const frame = host.getByTestId('detected-scripts-frame');
  const card = frame.locator(':scope > div');
  await expect(card).toBeVisible();
  const rows = card.locator(':scope > div').nth(1).locator(':scope > div');
  return {
    page,
    host,
    frame,
    card,
    rows,
    state: () => outputJson(host.getByTestId('detected-scripts-state')),
  };
}
export const control = (item, name) => item.host.getByRole('button', { name, exact: true });
export const draft = (item) =>
  item.host.getByRole('textbox', { name: 'Scripts JSON draft', exact: true });
export async function apply(item, scripts) {
  await draft(item).fill(JSON.stringify(scripts, null, 2));
  await control(item, 'Apply scripts').click();
  expect((await item.state()).scripts).toEqual(scripts);
}
export function parts(row) {
  const heading = row.locator(':scope > div > div').nth(0);
  return {
    name: heading.locator(':scope > span').nth(0),
    heading,
    command: row.locator(':scope > div > div').nth(1),
  };
}
export async function expectRow(row, expected) {
  const fields = parts(row);
  await expect(fields.name).toBeVisible();
  await expect(fields.command).toBeVisible();
  expect(await fields.name.textContent()).toBe(expected.name);
  expect(await fields.command.textContent()).toBe(expected.command);
  expect((await fields.heading.locator(':scope > span').allTextContents()).slice(1)).toEqual(
    expected.badges,
  );
  return fields;
}
export async function footer(item, key, count) {
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(count);
  await expect(item.card.getByText(label(key, { count: value }), { exact: true })).toBeVisible();
  await expect(
    item.card.getByText(label('chat_detectedScripts_title'), { exact: true }),
  ).toBeVisible();
}
export async function sameNode(locator, handle) {
  expect(await locator.evaluate((node, old) => node === old, handle)).toBe(true);
}
export async function detached(handle) {
  expect(await handle.evaluate((node) => node.isConnected)).toBe(false);
}
export async function setMounted(item, checked) {
  const toggle = item.host.getByRole('switch', { name: 'Scripts card mounted', exact: true });
  if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(checked));
}
export async function expectOriginalIcon(item, info) {
  const svg = item.card.locator('svg');
  await expect(svg).toHaveCount(1);
  const observed = await svg.evaluate((node, sourceSvg) => {
    const document = new DOMParser().parseFromString(sourceSvg, 'image/svg+xml');
    const shapes = (root) =>
      [...root.querySelectorAll('path, circle, ellipse, line, polyline, polygon, rect')]
        .filter((shape) => !(shape.localName === 'rect' && shape.getAttribute('fill') === 'none'))
        .map((shape) => ({
          tag: shape.localName,
          attributes: Object.fromEntries(
            [...shape.attributes]
              .map(({ name, value }) => [name, value])
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        }));
    return {
      actual: shapes(node),
      expected: shapes(document),
      parseError: !!document.querySelector('parsererror'),
      viewBox: node.getAttribute('viewBox'),
      hidden: node.getAttribute('aria-hidden'),
    };
  }, artwork);
  await info.attach('detected-scripts-original-artwork.json', {
    body: JSON.stringify({ original, iconVersion, iconHashes, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe('0 0 256 256');
  expect(observed.hidden).toBe('true');
}
export async function geometry(item, name, info, { commandOverflow = false } = {}) {
  await item.card.scrollIntoViewIfNeeded();
  await item.page.evaluate(() => document.fonts.ready);
  const probe = await item.card.evaluate((card) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const textRects = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()]
        .filter((r) => r.width && r.height)
        .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
    };
    const rows = [...card.children[1].children].map((row) => {
      const [heading, command] = row.firstElementChild.children;
      return {
        bounds: rect(row),
        heading: [...heading.children].map((node) => ({
          text: node.textContent,
          bounds: textRects(node),
        })),
        command: {
          bounds: rect(command),
          text: command.textContent,
          clientWidth: command.clientWidth,
          scrollWidth: command.scrollWidth,
        },
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      card: rect(card),
      frame: rect(card.parentElement),
      clientWidth: card.clientWidth,
      scrollWidth: card.scrollWidth,
      rows,
      header: textRects(card.firstElementChild.lastElementChild),
      footer: textRects(card.lastElementChild.firstElementChild),
    };
  });
  await info.attach(`${name}-geometry-ax.json`, {
    body: JSON.stringify({ ...probe, ax: await item.card.ariaSnapshot() }, null, 2),
    contentType: 'application/json',
  });
  expect(probe.card.width).toBeGreaterThan(0);
  expect(probe.card.height).toBeGreaterThan(0);
  expect(probe.card.left).toBeGreaterThanOrEqual(0);
  expect(probe.card.right).toBeLessThanOrEqual(probe.viewport.width);
  expect(probe.scrollWidth).toBeLessThanOrEqual(probe.clientWidth + 1);
  const visibleText = [
    ...probe.header,
    ...probe.footer,
    ...probe.rows.flatMap((row) => row.heading.flatMap((field) => field.bounds)),
  ];
  expect(visibleText.length).toBeGreaterThan(0);
  for (const bounds of visibleText) {
    expect(bounds.left).toBeGreaterThanOrEqual(probe.card.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(probe.card.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(probe.card.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(probe.card.bottom + 1);
  }
  for (const row of probe.rows) {
    expect(row.command.bounds.width).toBeGreaterThan(0);
    expect(row.command.bounds.left).toBeGreaterThanOrEqual(probe.card.left);
    expect(row.command.bounds.right).toBeLessThanOrEqual(probe.card.right);
    if (commandOverflow) expect(row.command.scrollWidth).toBeGreaterThan(row.command.clientWidth);
  }
  return probe;
}
export async function capture(item, name, info) {
  await expect(item.card).toBeVisible();
  await expect(
    item.card.getByText(label('chat_detectedScripts_title'), { exact: true }),
  ).toBeVisible();
  await geometry(item, `${name}-capture`, info);
  return captureTranscript(item.page, item.frame, name, info);
}
