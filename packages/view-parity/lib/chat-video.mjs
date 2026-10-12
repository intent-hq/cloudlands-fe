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

// Local decoder and public caller contracts only. Error paths, downloads,
// pending work cleanup, daemon admission and source-paired pixels stay unverified.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const unchangedSources = [
  'src/lib/components/chat/ChatVideoBlock.svelte',
  'src/lib/components/ui/VideoLightbox.svelte',
  'src/lib/components/ui/VideoActionsMenu.svelte',
  'src/lib/components/ui/MediaUnavailable.svelte',
  'src/lib/components/ui/MediaLightbox.svelte',
  'src/lib/components/icons/KebabIcon.svelte',
  'src/lib/utils/media-provenance.ts',
  'src/lib/utils/image-actions.ts',
  'src/lib/i18n/format.ts',
  'src/shared/i18n/formatters.ts',
];
const extractedDependencies = [
  'src/lib/icons/icon-definition.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
  'apps/react/src/features/chat/components/chat-video-block.tsx',
  'apps/react/src/components/ui/video-lightbox.tsx',
  'apps/react/src/components/ui/video-actions-menu.tsx',
  'apps/react/src/components/ui/media-unavailable.tsx',
  'apps/react/src/components/ui/media-lightbox/index.tsx',
  'apps/react/src/catalog/chat-video-examples.tsx',
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
  'packages/view-parity/lib/chat-video.mjs',
  'packages/view-parity/tests/chat-video.core.spec.mjs',
  'packages/view-parity/tests/chat-video.extended.spec.mjs',
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
  .slice(0, 5)
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
  ['faTriangleExclamation', 'faXmark'].map((definition) => {
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

export const test = base.extend({
  videoFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_CHAT_VIDEO_APPROVED, 'Explicit runtime release required').toBe('1');
      const sha = process.env.PARITY_CHAT_VIDEO_SHA;
      const testSha = process.env.PARITY_CHAT_VIDEO_TEST_SHA;
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
        await info.attach('chat-video-freeze.json', {
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
  videoNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use(network);
      } finally {
        await info.attach('chat-video-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  nativeMedia: [
    async ({ page }, use, info) => {
      const events = [];
      await page.exposeBinding('__chatVideoNativeObservation', (_source, event) =>
        events.push(event),
      );
      await page.addInitScript(() => {
        for (const type of ['loadedmetadata', 'loadeddata', 'playing', 'pause', 'ended', 'error']) {
          document.addEventListener(
            type,
            (event) => {
              const node = event.target;
              if (!(node instanceof HTMLVideoElement)) return;
              window.__chatVideoNativeObservation({
                type,
                trusted: event.isTrusted,
                src: node.currentSrc,
                width: node.videoWidth,
                height: node.videoHeight,
                duration: node.duration,
                currentTime: node.currentTime,
                error: node.error?.code ?? null,
              });
            },
            true,
          );
        }
      });
      try {
        await use(events);
      } finally {
        await info.attach('chat-video-native-events.json', {
          body: JSON.stringify(events, null, 2),
          contentType: 'application/json',
        });
        expect(events.filter((event) => event.type === 'error')).toEqual([]);
        expect(events.every((event) => event.trusted)).toBe(true);
      }
    },
    { auto: true },
  ],
  videoObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('chat-video-observations.json', {
            body: JSON.stringify(
              await page.locator('[data-functional-example="chat-video"] output').allTextContents(),
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
    name: 'landscape',
    width: 320,
    height: 180,
    durationSeconds: 2.0,
    videoSha256: '5ccb58a3fa57183541f9f9c7b564585e7074021351b38eb8378ccbb0cf0e3e28',
    bytes: 822,
    formattedBytes: '822B',
    command: [
      '/home/sam/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      '6',
      '-vcodec',
      'mjpeg',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-frames:v',
      '12',
      '-f',
      'webm',
      '.demo-artifacts/chat-video-verifier-preparation/visible-fixtures/attempt-2/fixtures/landscape.webm',
    ],
    jpegSha256: '15712cd793a4179e0dc03588a6190d737e88b7e284655215dfe9695d23d09376',
    base64:
      'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAMGEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEoTbuMU6uEHFO7a1OsggLw7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAn0AAAAAAABZUrmvNrgEAAAAAAABE14EBc8WIPuhN/si+ADOcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QJ7yGq4JWwggFAuoG0moECVbCIVbeBAlW4gQISVMNn/nNzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuMS4xMDBzc9ljwItjxYg+6E3+yL4AM2fIpEWjh0VOQ09ERVJEh5dMYXZjNjEuMy4xMDAgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB9DtnVBP+eBAKOygQAAgIJJg0IAE/ALNgA4JBwYSgAAMGAAAHyp/8tDP//+ABB///vgmWDJSnkxddvpogCjloEApwCGAECSnABQAAADIAAAWjUXrhCjloEBTQCGAECSnABO4AADIAAAWjUXrhCjloEB9ACGAECSnABQAAADIAAAWjUXrhCjloECmwCGAECSnABNQAADIAAAWjUXrhCjloEDQQCGAECSnABQAAADIAAAWjUXrhCjloED6ACGAECSnABO4AADIAAAWjUXrhCjloEEjwCGAECSnABQAAADIAAAWjUXrhCjloEFNQCGAECSnABKIAADIAAAWjUXrhCjloEF3ACGAECSnABQAAADIAAAWjUXrhCjloEGgwCGAMCSnABKIAADIAAAWjUXrhCjloEHKQCGAECSnABQAAADIAAAWjUXrhAcU7trkbuPs4EAt4r3gQHxggGr8IED',
  },
  {
    name: 'replacement',
    width: 480,
    height: 320,
    durationSeconds: 3.0,
    videoSha256: '7ed2cffe39b116f2108dcedeaddc0308e082f184ea35040198977fe8e4bc46ba',
    bytes: 1141,
    formattedBytes: '1.11Ki',
    command: [
      '/home/sam/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      '6',
      '-vcodec',
      'mjpeg',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-frames:v',
      '18',
      '-f',
      'webm',
      '.demo-artifacts/chat-video-verifier-preparation/visible-fixtures/attempt-2/fixtures/replacement.webm',
    ],
    jpegSha256: 'a9ffdbbfc8cdb43ef600226e27d98550764f573aaa1699340e283f34eda6d5c1',
    base64:
      'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAARFEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEpTbuMU6uEHFO7a1OsggQv7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAp3AAAAAAABZUrmvOrgEAAAAAAABF14EBc8WIiQy6ZoCyq2mcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QJ7yGq4JawggHguoIBQJqBAlWwiFW3gQJVuIECElTDZ/5zc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjEuMTAwc3PZY8CLY8WIiQy6ZoCyq2lnyKRFo4dFTkNPREVSRIeXTGF2YzYxLjMuMTAwIGxpYnZweC12cDlnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAzLjAwMDAwMDAwMAAfQ7Z1Qn3ngQCj14EAAICCSYNCAB3wE/YAOCQcGEoQADh9TB7F+gAAAAAAGnyLHhAG///716D///iiOOaOpxDrG7WlVjAAfIseEAb///vXoP//+KI45o6nEoMPsyvv4OsoAKOfgQCnAIYAQJKcAFABAAIAJqwAAAAAAARYPtAAWGBVYKOegQFNAIYAQJKcAE7hAAGAIAAAAAAABFg+0ABYYFVgo56BAfQAhgBAkpwAUAEAAYAgAAAAAAAEWD7QAFhgVWCjnoECmwCGAECSnABNQQABgCAAAAAAAARYPtAAWGBVYKOegQNBAIYAQJKcAFABAAGAIAAAAAAABFg+0ABYYFVgo56BA+gAhgBAkpwATuEAAYAgAAAAAAAEWD7QAFhgVWCjnoEEjwCGAECSnABQAQABgCAAAAAAAARYPtAAWGBVYKOegQU1AIYAQJKcAEohAAGAIAAAAAAABFg+0ABYYFVgo56BBdwAhgBAkpwAUAEAAYAgAAAAAAAEWD7QAFhgVWCjnoEGgwCGAMCSnABKIQABgCAAAAAAAARYPtAAWGBVYKOegQcpAIYAQJKcAFABAAGAIAAAAAAABFg+0ABYYFVgo56BB9AAhgBAkpwATUEAAYAgAAAAAAAEWD7QAFhgVWCjnoEIdwCGAECSnABQAQABgCAAAAAAAARYPtAAWGBVYKOegQkdAIYAQJKcAE7hAAGAIAAAAAAABFg+0ABYYFVgo56BCcQAhgBAkpwAUAEAAYAgAAAAAAAEWD7QAFhgVWCjnoEKawCGAECSnABKIQABgCAAAAAAAARYPtAAWGBVYKOegQsRAIYAQJKcAFABAAGAIAAAAAAABFg+0ABYYFVgHFO7a5G7j7OBALeK94EB8YIBrPCBAw==',
  },
];

export function videoFile(index = 0, name = fixtureRecords[index].name + '.webm') {
  const record = fixtureRecords[index];
  const buffer = Buffer.from(record.base64, 'base64');
  if (digest(buffer) !== record.videoSha256) throw new Error('Video fixture changed');
  return { name, mimeType: 'video/webm', buffer };
}
export const videoContract = (index = 0) => fixtureRecords[index];
export const dataUrl = (file) => `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const field = (host, name) => host.getByLabel(name, { exact: true });
export const output = (host, name) => outputJson(field(host, name));
export const frame = (host) => host.getByTestId('chat-video-frame');
export const preview = (host) => frame(host).locator('[data-chat-video]');
export const video = (host) => preview(host).locator('video');
export const opener = (host, name) =>
  button(preview(host), label('chat_videoBlock_play_ariaLabel', { name }));
export const options = (host) => button(host, label('ui_videoActionsMenu_trigger_ariaLabel'));
export const dialog = (page, name) =>
  page.getByRole('dialog', { name: label('chat_videoBlock_dialog_title', { name }), exact: true });

export async function openVideo(page) {
  const host = await openExample(page, 'chat-video', 'chat-video');
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
export async function pick(page, host, file, poster = false) {
  const pending = page.waitForEvent('filechooser');
  await button(host, poster ? 'Choose local poster' : 'Choose local video').click();
  const chooser = await pending;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(file);
  const key = poster ? 'poster' : 'video';
  await expect
    .poll(async () => (await output(host, 'Chat video file reads'))[key])
    .toEqual({
      reading: false,
      error: '',
      file: {
        name: file.name,
        size: file.buffer.length,
        type: file.mimeType,
        mimeType: file.mimeType,
        base64Length: file.buffer.toString('base64').length,
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
export async function decoded(target, index = 0) {
  const record = videoContract(index);
  await expect
    .poll(() =>
      target.evaluate((node) => ({
        width: node.videoWidth,
        height: node.videoHeight,
        duration: node.duration,
        ready: node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        error: node.error?.code ?? null,
      })),
    )
    .toEqual({
      width: record.width,
      height: record.height,
      duration: record.durationSeconds,
      ready: true,
      error: null,
    });
  // Real decoder readiness does not prove that the frame has a rendered area.
  const samples = [];
  try {
    await expect
      .poll(
        async () => {
          const bounds = await target.evaluate((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          });
          samples.push(bounds);
          return bounds.width > 0 && bounds.height > 0;
        },
        { message: 'Decoded video must have positive rendered dimensions' },
      )
      .toBe(true);
  } finally {
    const info = test.info();
    const prefix = 'chat-video-rendered-frame-';
    const sequence = info.attachments.filter((item) => item.name.startsWith(prefix)).length + 1;
    await info.attach(`${prefix}${sequence}.json`, {
      body: JSON.stringify({ fixtureIndex: index, samples }, null, 2),
      contentType: 'application/json',
    });
  }
}
export async function readyForInitialVideoCapture(target, info) {
  const samples = [];
  let passed = false;
  const observe = async () => {
    const sample = await target.evaluate((node) => {
      const ranges = (value) =>
        Array.from({ length: value.length }, (_, index) => ({
          start: value.start(index),
          end: value.end(index),
        }));
      return {
        observedAt: new Date().toISOString(),
        readyState: node.readyState,
        enoughData: node.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA,
        networkState: node.networkState,
        buffered: ranges(node.buffered),
        paused: node.paused,
        autoplay: node.autoplay,
        currentTime: node.currentTime,
        playedLength: node.played.length,
        played: ranges(node.played),
        error: node.error?.code ?? null,
      };
    });
    samples.push(sample);
    return sample;
  };
  const unplayed = { paused: true, autoplay: false, currentTime: 0, playedLength: 0 };
  try {
    expect(await observe(), 'The initial video must be paused and unplayed').toMatchObject(
      unplayed,
    );
    await expect
      .poll(
        async () => {
          const sample = await observe();
          return { enoughData: sample.enoughData, error: sample.error };
        },
        { timeout: 5_000, message: 'The real video must have enough data before initial capture' },
      )
      .toEqual({ enoughData: true, error: null });
    expect(await observe(), 'Readiness must leave the video paused and unplayed').toMatchObject(
      unplayed,
    );
    passed = true;
  } finally {
    await info.attach('chat-video-initial-readiness.json', {
      body: JSON.stringify({ timeoutMs: 5_000, passed, samples }, null, 2),
      contentType: 'application/json',
    });
  }
}

export async function menuInfo(page, index = 0) {
  const record = videoContract(index);
  const menu = page.getByRole('menu');
  await expect(menu.getByTestId('video-info-dimensions')).toHaveText(
    label('ui_videoActionsMenu_dimensions_label', {
      width: String(record.width),
      height: String(record.height),
    }),
  );
  await expect(menu.getByTestId('video-info-duration')).toHaveText(
    label('ui_videoActionsMenu_duration_label', {
      duration: `${record.durationSeconds}s`,
    }),
  );
  await expect(menu.getByTestId('video-info-size')).toHaveText(record.formattedBytes);
}
export async function sameNode(handle, target) {
  expect(await target.evaluate((node, old) => node === old, handle)).toBe(true);
}
export async function detached(handle) {
  await expect.poll(() => handle.evaluate((node) => node.isConnected)).toBe(false);
}
export function posterFile() {
  const png = new PNG({ width: 12, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 120;
    png.data[i + 1] = 190;
    png.data[i + 2] = 50;
    png.data[i + 3] = 255;
  }
  return { name: 'selected-poster.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
const originalVideoMarkup = [
  ...committed(unchangedSources[0]).matchAll(/<svg\b[\s\S]*?<\/svg>/g),
].map((match) => match[0]);
const originalKebabMarkup = committed('src/lib/components/icons/KebabIcon.svelte').match(
  /<svg\b[\s\S]*?<\/svg>/,
)?.[0];
export async function expectSourceArtwork(svg, key, info) {
  const markup = key === 'kebab' ? originalKebabMarkup : originalVideoMarkup[key];
  expect(markup, 'Immutable source SVG must exist').toBeTruthy();
  const observation = await svg.evaluate((node, source) => {
    const tree = new DOMParser().parseFromString(source, 'text/html');
    const expected = tree.querySelector('svg');
    const shapes = (root) =>
      [...root.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')].map((shape) => ({
        tag: shape.localName,
        attributes: Object.fromEntries(
          [...shape.attributes]
            .filter((entry) => entry.name !== 'class')
            .map((entry) => [entry.name, entry.value])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      }));
    return {
      actual: shapes(node),
      expected: shapes(expected),
      viewBox: node.getAttribute('viewBox'),
      expectedViewBox: expected.getAttribute('viewBox'),
    };
  }, markup);
  await info.attach(`chat-video-source-art-${key}.json`, {
    body: JSON.stringify({ original, markup, observation }, null, 2),
    contentType: 'application/json',
  });
  expect(observation.actual).toEqual(observation.expected);
  expect(observation.viewBox).toBe(observation.expectedViewBox);
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
  await info.attach(`chat-video-art-${definition}.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
}

export async function captureVideo(page, target, name, info) {
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
        nodes: [...root.querySelectorAll('button,video,svg,[role],[data-chat-video]')].map(
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
    expect(hit, 'Narrow video controls must remain reachable').toBe(true);
  }
}
