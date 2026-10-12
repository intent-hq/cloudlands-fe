import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { PNG } from 'pngjs';

// Local native file and caller contracts only. Runtime URL revocation, daemon
// uploads, native failure paths and source-paired pixels are not established.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const unchangedSources = [
  'src/lib/components/chat/AttachmentPreview.svelte',
  'src/lib/components/ui/ImageLightbox.svelte',
  'src/lib/components/ui/MediaLightbox.svelte',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/components/shared/icons/FaWrapper.svelte',
  'src/lib/i18n/format.ts',
  'src/lib/i18n/locale.ts',
  'src/shared/i18n/formatters.ts',
];
const extractedDependencies = [
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
  'packages/view-parity/lib/attachment-preview.mjs',
  'packages/view-parity/tests/attachment-preview.core.spec.mjs',
  'packages/view-parity/tests/attachment-preview.extended.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
  'packages/view-parity/lib/functional.mjs',
  'packages/view-parity/lib/browser.mjs',
  'packages/view-parity/lib/provenance.mjs',
  'packages/view-parity/lib/manifest.mjs',
  'packages/view-parity/lib/agent-avatar.mjs',
  'packages/view-parity/lib/compare.mjs',
  'packages/view-parity/playwright.config.mjs',
  'packages/view-parity/scripts/run.mjs',
  'packages/view-parity/package.json',
  'packages/view-parity/scene-manifest.json',
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
  'ui_imageLightbox_preview_ariaLabel',
  'ui_imageLightbox_close_ariaLabel',
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
  [
    'faFile',
    'faFolder',
    'faImage',
    'faFileCode',
    'faFileAlt',
    'faCircleExclamation',
    'faRotateRight',
    'faXmark',
  ].map((definition) => {
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
  previewFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_ATTACHMENT_PREVIEW_APPROVED,
        'Explicit runtime release required',
      ).toBe('1');
      const sha = process.env.PARITY_ATTACHMENT_PREVIEW_SHA;
      const testSha = process.env.PARITY_ATTACHMENT_PREVIEW_TEST_SHA;
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
        await info.attach('attachment-preview-freeze.json', {
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
  previewNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('attachment-preview-network.json', {
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
        if (!page.isClosed())
          await info.attach('attachment-preview-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="native-attachments"] output')
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
export { expect, outputJson };

export async function openAttachments(page) {
  const host = await openExample(page, 'attachment-preview', 'native-attachments');
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

// Node encodes actual PNG files; the untouched browser File and image decoders
// consume them through the real public FileInput picker.
export function pngFile(name = 'preview.png', width = 16, height = 10) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i / 4) % 256;
    png.data[i + 1] = 140;
    png.data[i + 2] = 220;
    png.data[i + 3] = 255;
  }
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
export const textFile = (name = 'notes.txt') => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('Actual local text attachment\n'),
});
export const metadata = (id, file) => ({
  id,
  name: file.name,
  type: file.mimeType,
  size: file.buffer.length,
});
export const output = (host, name) => outputJson(host.getByLabel(name, { exact: true }));
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const field = (host, name) => host.getByLabel(name, { exact: true });
export const frame = (host) => host.getByLabel('Attachment preview area', { exact: true });
export const slot = (host, id = 'local-1') => frame(host).locator(`[data-attachment-slot="${id}"]`);
export const leaf = (host, id) => slot(host, id).locator(':scope > div').first();
export const viewName = (name) => label('chat_attachmentPreview_viewFullSize_ariaLabel', { name });
export const thumbnailRemoveName = (name) =>
  label('chat_attachmentPreview_remove_ariaLabel', { name });
export const retryName = (name) =>
  label('chat_attachmentPreview_retryPlacement_ariaLabel', { name });
export const chipRemoveName = () => label('chat_attachmentPreview_removeAttachment_ariaLabel');
export const failedTitle = (name, detail = '') =>
  label('chat_attachmentPreview_placementFailed_tooltip', { name }) +
  (detail ? ` — ${detail}` : '');
export const percent = (fraction) =>
  new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 }).format(
    Math.max(0, Math.min(1, fraction)),
  );

export async function pick(page, host, files, replacement = false) {
  const pending = page.waitForEvent('filechooser');
  await button(host, replacement ? 'Replace selected file' : 'Choose local attachments').click();
  const chooser = await pending;
  expect(chooser.isMultiple()).toBe(!replacement);
  await chooser.setFiles(files);
}
export async function switchTo(host, name, checked) {
  const control = host.getByRole('switch', { name, exact: true });
  if ((await control.getAttribute('aria-checked')) !== String(checked)) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(checked));
}
export async function choose(host, group, value) {
  await host
    .getByRole('radiogroup', { name: group, exact: true })
    .getByRole('radio', { name: value, exact: true })
    .click();
}
export async function selectSlot(host, ordinal) {
  await field(host, 'Selected attachment slot').fill(String(ordinal));
}
export async function clearLogs(host) {
  await button(host, 'Clear observations').click();
  for (const name of [
    'Attachment callback log',
    'Attachment native capture log',
    'Attachment native bubble log',
    'Attachment React bubble log',
  ]) {
    await expect.poll(() => output(host, name)).toEqual([]);
  }
}
export async function expectDecoded(image, width = 16, height = 10) {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => ({
        complete: node.complete,
        width: node.naturalWidth,
        height: node.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width, height });
}
export async function sameNode(handle, current) {
  expect(await current.evaluate((node, old) => node === old, handle)).toBe(true);
}
export async function detached(handle) {
  await expect.poll(() => handle.evaluate((node) => node.isConnected)).toBe(false);
}
export async function expectCallbacks(host, expected) {
  await expect
    .poll(async () =>
      (await output(host, 'Attachment callback log')).map(
        ({ slot, currentId, revision, kind, args }) => ({ slot, currentId, revision, kind, args }),
      ),
    )
    .toEqual(expected);
}
export const callback = (kind, currentId, slotId = 'local-1', revision = 0) => ({
  slot: slotId,
  currentId,
  revision,
  kind,
  args: [currentId],
});
export async function expectPropagation(
  host,
  { currentId, slotId = 'local-1', revision = 0, bubbles },
) {
  // Native listeners run below React's delegate. Source stopPropagation is
  // observable at the ordinary React parent, not these earlier native bubbles.
  for (const [name, kind, phase] of [
    ['Attachment native capture log', 'native-capture', 1],
    ['Attachment native bubble log', 'native-bubble', 3],
  ]) {
    await expect
      .poll(async () =>
        (await output(host, name)).map(({ slot, currentId, revision, kind, eventPhase }) => ({
          slot,
          currentId,
          revision,
          kind,
          eventPhase,
        })),
      )
      .toEqual([{ slot: slotId, currentId, revision, kind, eventPhase: phase }]);
  }
  await expect
    .poll(async () =>
      (await output(host, 'Attachment React bubble log')).map(({ slot, currentId, revision }) => ({
        slot,
        currentId,
        revision,
      })),
    )
    .toEqual(bubbles ? [{ slot: slotId, currentId, revision }] : []);
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
      hidden: node.getAttribute('aria-hidden'),
      expectedViewBox: tree.documentElement.getAttribute('viewBox'),
      parseError: !!tree.querySelector('parsererror'),
    };
  }, expected.svg);
  await info.attach(`attachment-art-${definition}.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
}

export async function captureAttachments(page, target, name, info) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = () =>
    target.evaluate((root) => {
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        root: rect(root),
        nodes: [...root.querySelectorAll('button,img,svg,[role],[data-attachment-slot]')].map(
          (node) => ({
            tag: node.localName,
            role: node.getAttribute('role'),
            name: node.getAttribute('aria-label') || node.getAttribute('alt'),
            bounds: rect(node),
          }),
        ),
      };
    });
  const before = { geometry: await geometry(), ax: await target.ariaSnapshot() };
  const attempts = [];
  const png = await stableLocatorScreenshot(page, target, async ({ png, ...attempt }) => {
    const sha256 = png ? digest(png) : null;
    attempts.push({ ...attempt, sha256 });
    if (png)
      await info.attach(`${name}-attempt-${attempt.attempt}.png`, {
        body: png,
        contentType: 'image/png',
      });
    await info.attach(`${name}-attempt-${attempt.attempt}.json`, {
      body: JSON.stringify({ ...attempt, sha256 }, null, 2),
      contentType: 'application/json',
    });
  });
  const after = { geometry: await geometry(), ax: await target.ariaSnapshot() };
  const groups = {};
  for (const attempt of attempts)
    if (attempt.sha256) (groups[attempt.sha256] ??= []).push(attempt.attempt);
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  await info.attach(`${name}-evidence.json`, {
    body: JSON.stringify(
      { before, after, finalSha256: digest(png), identicalAttempts: groups },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(after, 'Capture must preserve geometry and accessibility').toEqual(before);
}

export async function contained(target, info, name) {
  await target.scrollIntoViewIfNeeded();
  const measured = await target.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      frame: rect(root),
      viewport: innerWidth,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      buttons: [...root.querySelectorAll('button')].map((button) => {
        const bounds = rect(button);
        const hit = document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        );
        return { bounds, hit: hit === button || button.contains(hit) };
      }),
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  expect(measured.frame.left).toBeGreaterThanOrEqual(0);
  expect(measured.frame.right).toBeLessThanOrEqual(measured.viewport);
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1);
  expect(measured.buttons.length).toBeGreaterThan(0);
  for (const { bounds, hit } of measured.buttons) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(measured.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(measured.frame.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(measured.frame.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(measured.frame.bottom + 1);
    expect(hit, 'Narrow attachment controls must remain reachable').toBe(true);
  }
}
