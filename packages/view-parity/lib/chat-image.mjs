import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { PNG } from 'pngjs';

// Local image and caller contracts only. Error paths, pending runtime cleanup,
// real hydration, full motion and source-paired pixels remain unverified.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const unchangedSources = [
  'src/lib/components/chat/ChatImageBlock.svelte',
  'src/lib/components/ui/ImageLightbox.svelte',
  'src/lib/components/ui/ImageActionsMenu.svelte',
  'src/lib/components/ui/MediaUnavailable.svelte',
  'src/lib/components/ui/MediaLightbox.svelte',
  'src/lib/components/icons/KebabIcon.svelte',
  'src/lib/components/ui/MediaLoadingPlaceholder.svelte',
  'src/lib/components/ui/ZoomPanViewport.svelte',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/actions/observe-overflow.ts',
  'src/lib/utils/image-actions.ts',
  'src/lib/i18n/format.ts',
  'src/shared/i18n/formatters.ts',
];
const extractedDependencies = [
  'src/lib/icons/icon-definition.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
  'apps/react/src/features/chat/components/chat-image-block.tsx',
  'apps/react/src/components/ui/image-lightbox.tsx',
  'apps/react/src/components/ui/image-actions-menu.tsx',
  'apps/react/src/components/ui/media-unavailable.tsx',
  'apps/react/src/components/ui/media-lightbox/index.tsx',
  'apps/react/src/components/ui/zoom-pan-viewport/index.tsx',
  'apps/react/src/components/ui/media-loading-placeholder.tsx',
  'apps/react/src/components/ui/button.tsx',
  'apps/react/src/components/ui/button-variants.ts',
  'apps/react/src/components/ui/file-input.tsx',
  'apps/react/src/catalog/chat-image-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/styles/app.css',
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
  'packages/view-parity/lib/chat-image.mjs',
  'packages/view-parity/tests/chat-image.core.spec.mjs',
  'packages/view-parity/tests/chat-image.extended.spec.mjs',
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
const headerSource = unchangedSources
  .filter((file) => file.endsWith('.svelte'))
  .map((file) => committed(file))
  .join('\n');
const messageKeys = [...new Set([...headerSource.matchAll(/m\.(\w+)\(/g)].map((x) => x[1]))];
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
  ['faImage', 'faXmark'].map((definition) => {
    let sourceDefinition = definition;
    const aliases = [];
    let name;
    while (!name) {
      if (aliases.includes(sourceDefinition))
        throw new Error(`Original icon alias cycle: ${definition}`);
      aliases.push(sourceDefinition);
      name = originalMapping.match(
        new RegExp('export const ' + sourceDefinition + " = icon\\('([^']+)'\\)"),
      )?.[1];
      if (name) break;
      const alias = originalMapping.match(
        new RegExp('export const ' + sourceDefinition + ' = (fa\\w+);'),
      )?.[1];
      if (!alias) throw new Error(`Missing original icon declaration ${sourceDefinition}`);
      sourceDefinition = alias;
    }
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
        aliases,
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

const require = createRequire(path.join(repoRoot, 'package.json'));
function originalModule(file) {
  let js = stripTypeScriptTypes(committed(file), { mode: 'transform' });
  // Resolve only actual date-fns imports. The immutable helper body is unchanged.
  js = js.replace(
    /(['"])(date-fns(?:\/locale)?)\1/g,
    (_match, quote, specifier) => quote + pathToFileURL(require.resolve(specifier)).href + quote,
  );
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
export const imageOracle = await originalModule('src/lib/utils/image-actions.ts');
export const formats = (await originalModule('src/shared/i18n/formatters.ts')).createFormatters(
  () => 'en',
);

export const test = base.extend({
  imageFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_CHAT_IMAGE_APPROVED, 'Explicit runtime release required').toBe('1');
      const sha = process.env.PARITY_CHAT_IMAGE_SHA;
      const testSha = process.env.PARITY_CHAT_IMAGE_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retry is authorized').toBe(0);
      expect(info.project.retries).toBe(0);
      expect(process.env.PARITY_CANDIDATE_URL).toBe(process.env.PARITY_CHAT_IMAGE_URL);
      expect(new URL(process.env.PARITY_CHAT_IMAGE_URL).protocol).toBe('http:');
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
        await info.attach('chat-image-freeze.json', {
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
  imageNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use(network);
      } finally {
        await info.attach('chat-image-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  nativeImages: [
    async ({ page }, use, info) => {
      const events = [];
      await page.exposeBinding('__chatImageNativeObservation', (_source, event) =>
        events.push(event),
      );
      await page.addInitScript(() => {
        for (const type of ['load', 'error']) {
          document.addEventListener(
            type,
            (event) => {
              const node = event.target;
              if (!(node instanceof HTMLImageElement)) return;
              if (!node.closest('[data-chat-image], [data-media-lightbox-root]')) return;
              window.__chatImageNativeObservation({
                type,
                trusted: event.isTrusted,
                src: node.currentSrc,
                width: node.naturalWidth,
                height: node.naturalHeight,
              });
            },
            true,
          );
        }
      });
      try {
        await use(events);
      } finally {
        await info.attach('chat-image-native-events.json', {
          body: JSON.stringify(events, null, 2),
          contentType: 'application/json',
        });
        expect(events.filter((event) => event.type === 'error')).toEqual([]);
        expect(events.every((event) => event.trusted)).toBe(true);
      }
    },
    { auto: true },
  ],
  loadingStates: [
    async ({ page }, use, info) => {
      const states = [];
      await page.exposeBinding('__chatImageLoadingObservation', (_source, event) =>
        states.push(event),
      );
      await page.addInitScript(() => {
        const observer = new MutationObserver((entries) => {
          for (const entry of entries) {
            const node = entry.target;
            if (!(node instanceof Element) || !node.closest('[data-chat-image]')) continue;
            window.__chatImageLoadingObservation({
              oldValue: entry.oldValue,
              value: node.getAttribute('data-loaded'),
              source: node.querySelector('img')?.currentSrc,
            });
          }
        });
        observer.observe(document, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-loaded'],
          attributeOldValue: true,
        });
      });
      try {
        await use(states);
      } finally {
        await info.attach('chat-image-loading-states.json', {
          body: JSON.stringify(states, null, 2),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
  imageObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('chat-image-observations.json', {
            body: JSON.stringify(
              await page.locator('[data-functional-example="chat-image"] output').allTextContents(),
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

const fixtureRecords = [
  {
    name: 'landscape.png',
    width: 120,
    height: 72,
    mimeType: 'image/png',
    bytes: 253,
    sha256: '867fc7d36250ff623a48f71bd4d245583378a8aef59cf83022daa790da45d62e',
    decoded: {
      width: 120,
      height: 72,
      channels: 4,
      rgbaSha256: 'e7259565f05f21abd3284b06a471ae6aa48660d3407a47101dcfb18988efe9cb',
    },
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAHgAAABICAYAAAA9HjF/AAAAxElEQVR4Ae3BMY1CAQAFwWWDFHIFFQIIFQpRgpiTgA/w8f7OnD7X25cDub8uHIlkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmTa+fn35kj+eXAkkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaZJpkmmSaT/ltAXt9MbUqAAAAABJRU5ErkJggg==',
  },
  {
    name: 'portrait.jpg',
    width: 80,
    height: 120,
    mimeType: 'image/jpeg',
    bytes: 662,
    sha256: '2a85fd7b6f42d1d30c427be898f6b940224311ecf633c83d47c9c0bb1f1d925e',
    decoded: {
      width: 80,
      height: 120,
      channels: 4,
      rgbaSha256: 'df4b15ee0b7ae5264027efe1c144206e4bb0a63e3fecab863b3e6ee5218325a7',
    },
    base64:
      '/9j/2wBDAAEBAQEBAQEBAQEBAQECAgMCAgICAgQDAwIDBQQFBQUEBAQFBgcGBQUHBgQEBgkGBwgICAgIBQYJCgkICgcICAj/2wBDAQEBAQICAgQCAgQIBQQFCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAj/wAARCAB4AFADAREAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAoJBf/EABwQAQAABwEAAAAAAAAAAAAAAAAWGGVno6Xi4//EABkBAQEBAQEBAAAAAAAAAAAAAAAJCggHC//EABwRAQACAgMBAAAAAAAAAAAAAAAZZqTkGGWj4//aAAwDAQACEQMRAD8A6Di9nPAAAAZHtpCmAAAADXBi3TPAAAAZHtpCmAAAADXBi3TPAAAAZHtpCmAAAADXBi3TPAAAAZHtpCmAAAADXBi3TPAAAAZHtpCmAAAADXBi3TPAAAAZHtpCmAAAADXBi3TPAAAAZHtpCmAAAAClSTC5On93zv8AnD1fv8XRkNtjw9okwuTp/c5w9X7/ABIbbHh7RJhcnT+5zh6v3+JDbY8PaJMLk6f3OcPV+/xIbbHh7RJhcnT+5zh6v3+JDbY8PaTxwZUsPTUpMJXcvVVog6tGFtkGVLD0TCV3L1SDq0YW2QZUsPRMJXcvVIOrRhbZBlSw9Ewldy9Ug6tGFtkGVLD0TCV3L1SDq0YW2sAYc3qgAAACTdeBaAAAABWQg+i+AAAAk3XgWgAAAAVkIPovgAAAJN14FoAAAAFZCD6L4AAACTdeBaAAAABWQg+i+AAAAk3XgWgAAAAVkIPovgAAAJN14FoAAAAFZCD6L4AAACTdeBaAAAAB/9k=',
  },
  {
    name: 'replacement.png',
    width: 96,
    height: 64,
    mimeType: 'image/png',
    bytes: 231,
    sha256: '5a8daf936709c9903e79f5277df39fe1bd4b6edd75017b3f9f0dfb0dbc80ad97',
    decoded: {
      width: 96,
      height: 64,
      channels: 4,
      rgbaSha256: '6073c827b46c4632571b92c5b5aefabbea2b5dc0901781f1a607abb6f4e90e2f',
    },
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAArklEQVR4Ae3BMY1CAQAFwWVDgYyTRIEsSuSggJrqVOAAZLz8ZGdOf8/blwO7PO4cmWRKMiWZkkxJpiRTkinJlGRKMiWZkkxJpiRTkinJlGRKMiWZkkxJpiRTkinJlGRKMiWZkkxJpiRTkqnzmxdH9vm/cmSSKcmUZEoyJZmSTEmmJFOSKcmUZEoyJZmSTEmmJFOSKcmUZEoyJZmSTEmmJFOSKcmUZEoyJZmSTEmmftosB5FZNGq/AAAAAElFTkSuQmCC',
  },
];

export const fileRecord = (index = 0) => fixtureRecords[index];
export function imageFile(index = 0, name = fileRecord(index).name) {
  const record = fileRecord(index);
  const buffer = Buffer.from(record.base64, 'base64');
  if (digest(buffer) !== record.sha256) throw new Error('Image fixture bytes changed');
  return { name, mimeType: record.mimeType, buffer };
}
export const dataUrl = (file) => `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const field = (host, name) => host.getByLabel(name, { exact: true });
export const output = (host, name) => outputJson(field(host, name));
export const frame = (host) => host.getByTestId('chat-image-frame');
export const preview = (host) => frame(host).locator('[data-chat-image]');
export const imageNode = (host) => preview(host).locator('img');
export const opener = (host, alt, hydrate = false) =>
  button(
    preview(host),
    label(
      hydrate
        ? 'chat_imageBlock_loadFullImage_ariaLabel'
        : 'chat_imageBlock_viewFullSize_ariaLabel',
      { alt },
    ),
  );
export const options = (host) => button(host, label('ui_imageActionsMenu_trigger_ariaLabel'));
export const dialog = (page) =>
  page.getByRole('dialog', {
    name: label('ui_imageLightbox_preview_ariaLabel'),
    exact: true,
  });
export const caption = (host) => preview(host).getByTestId('image-file-metadata');
export const placeholder = (host) => preview(host).getByTestId('chat-image-placeholder');

export async function openImage(page) {
  const host = await openExample(page, 'chat-image', 'chat-image');
  await expect(frame(host)).toHaveCount(1);
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemonUrl: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    })),
  ).toEqual({ preload: 'undefined', daemonUrl: null, width: 420, height: 900, reduced: true });
  await page.evaluate(() => document.fonts.ready);
  return host;
}
export async function pick(page, host, file, source = 'data') {
  const pending = page.waitForEvent('filechooser');
  await button(host, source === 'src' ? 'Choose source image' : 'Choose full image').click();
  const chooser = await pending;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(file);
  await expect
    .poll(
      async () =>
        (await output(host, 'Chat image file reads'))[source === 'src' ? 'source' : 'full'],
    )
    .toMatchObject({
      reading: false,
      error: '',
      file: {
        name: file.name,
        size: file.buffer.length,
        type: file.mimeType,
        mimeType: file.mimeType,
        base64Length: file.buffer.toString('base64').length,
        sameAsSelectedFile: true,
      },
    });
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
export async function sameNode(handle, target) {
  expect(await target.evaluate((node, old) => node === old, handle)).toBe(true);
}
export async function detached(handle) {
  await expect.poll(() => handle.evaluate((node) => node.isConnected)).toBe(false);
}
export async function decoded(target, index = 0) {
  const record = fileRecord(index);
  await target.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      target.evaluate((node) => ({
        complete: node.complete,
        width: node.naturalWidth,
        height: node.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: record.width, height: record.height });
  await target.evaluate((node) => node.decode());
  await expect(target).toBeVisible();
  const bounds = await target.boundingBox();
  expect(bounds.width, 'Decoded image needs a usable painted width').toBeGreaterThanOrEqual(32);
  expect(bounds.height, 'Decoded image needs a usable painted height').toBeGreaterThanOrEqual(32);
}
export async function menuInfo(page, index = 0) {
  const record = fileRecord(index);
  const menu = page.getByRole('menu');
  await expect(menu.getByTestId('image-info-dimensions')).toHaveText(
    label('ui_imageActionsMenu_dimensions_label', {
      width: formats.formatInteger(record.width),
      height: formats.formatInteger(record.height),
    }),
  );
  await expect(menu.getByTestId('image-info-size')).toHaveText(
    formats.formatBytesBinary(imageOracle.base64ByteSize(record.base64)),
  );
}
export async function captionInfo(host, index = 0) {
  const record = fileRecord(index);
  await expect(caption(host)).toContainText(
    label('ui_imageActionsMenu_dimensions_label', {
      width: formats.formatInteger(record.width),
      height: formats.formatInteger(record.height),
    }),
  );
}

// Raw images, geometry and AX are evidence; no injected CSS, fake events or clocks.
export async function captureImage(page, target, name, info) {
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
        nodes: [...root.querySelectorAll('button,img,svg,[role],[data-chat-image]')].map(
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
  try {
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
    await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
    return png;
  } finally {
    const after = { geometry: await geometry(), ax: await target.ariaSnapshot() };
    const groups = {};
    for (const attempt of attempts)
      if (attempt.sha256) (groups[attempt.sha256] ??= []).push(attempt.attempt);
    await info.attach(`${name}-evidence.json`, {
      body: JSON.stringify({ before, after, identicalAttempts: groups }, null, 2),
      contentType: 'application/json',
    });
    expect(after, 'Capture must preserve geometry and accessibility').toEqual(before);
  }
}
export async function visibleImage(page, target, index, name, info) {
  await decoded(target, index);
  const raw = await captureImage(page, target, name, info);
  const png = PNG.sync.read(raw);
  const colors = { red: 0, green: 0, blue: 0 };
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = png.data.subarray(i, i + 4);
    if (a < 200) continue;
    if (r > 100 && r - g > 60 && r - b > 60) colors.red++;
    if (g > 100 && g - r > 60 && g - b > 60) colors.green++;
    if (b > 100 && b - r > 60 && b - g > 60) colors.blue++;
  }
  await info.attach(`${name}-visible-content.json`, {
    body: JSON.stringify(
      { fixture: fileRecord(index), png: { width: png.width, height: png.height }, colors },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  for (const [color, count] of Object.entries(colors))
    expect(
      count,
      `The saved crop must visibly contain the fixture's ${color} artwork`,
    ).toBeGreaterThan(Math.max(8, png.width * png.height * 0.02));
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
    expect(hit, 'Narrow image controls must remain reachable').toBe(true);
  }
}
export async function waitClipboardImage(page, index) {
  // Read the real system clipboard to await the asynchronous write. Native paste below
  // is still required; this neither supplies nor overwrites clipboard contents.
  await expect
    .poll(async () => {
      const encoded = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find((entry) => entry.types.includes('image/png'));
        if (!item) return null;
        const blob = await item.getType('image/png');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
      });
      return encoded ? digest(PNG.sync.read(Buffer.from(encoded, 'base64')).data) : null;
    })
    .toBe(fileRecord(index).decoded.rgbaSha256);
}
export async function pasteImage(host, index, count, info) {
  await field(host, 'Paste copied image').press('ControlOrMeta+V');
  await expect
    .poll(async () => (await output(host, 'Chat image paste observations')).length)
    .toBe(count);
  await expect
    .poll(async () => (await output(host, 'Chat image paste observations')).at(-1)?.reading)
    .toBe(false);
  const pasted = (await output(host, 'Chat image paste observations')).at(-1);
  expect(pasted.isTrusted).toBe(true);
  expect(pasted.mimeType).toBe('image/png');
  expect(pasted.fileCount).toBe(1);
  expect(pasted.readError).toBeNull();
  const parsed = imageOracle.parseBase64DataUrl(pasted.dataUrl);
  expect(parsed?.mimeType).toBe('image/png');
  const bytes = Buffer.from(parsed.base64, 'base64');
  const decoded = PNG.sync.read(bytes);
  const record = fileRecord(index);
  expect(decoded.width).toBe(record.width);
  expect(decoded.height).toBe(record.height);
  expect(digest(decoded.data), 'Native clipboard paste must contain the current image pixels').toBe(
    record.decoded.rgbaSha256,
  );
  await info.attach(`chat-image-paste-${count}.json`, {
    body: JSON.stringify(
      { pasted, bytesSha256: digest(bytes), rgbaSha256: digest(decoded.data) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}
export async function expectArtwork(svg, definition, info) {
  const expected = artwork[definition];
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
  await info.attach(`chat-image-art-${definition}.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
}

export async function apply(host, source = 'data') {
  await button(
    host,
    source === 'src'
      ? 'Apply selected src'
      : source === 'full'
        ? 'Apply selected full image'
        : 'Apply selected data',
  ).click();
}
export async function refresh(host) {
  await button(host, 'Refresh observations').click();
  return output(host, 'Chat image observations');
}
export async function hydrationReceipt(host, count, revision, inputs, eventType = 'click') {
  const observations = await refresh(host);
  expect(observations.callbacks).toHaveLength(count);
  expect(observations.callbacks.at(-1)).toMatchObject({
    name: 'onHydrate',
    argumentCount: 0,
    args: [],
    callbackRevision: revision,
    currentInputs: inputs,
    capturedEvent: { type: eventType, isTrusted: true },
  });
  expect(observations.callbacks.filter((call) => call.name === 'onOpenLink')).toEqual([]);
}
