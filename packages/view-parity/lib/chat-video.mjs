import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { PNG } from 'pngjs';

// Local decoder and public caller contracts only. Error paths, downloads,
// pending work cleanup, daemon admission and source-paired pixels stay unverified.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const productFiles = [
  'src/lib/utils/media-provenance.ts',
  'src/lib/utils/image-actions.ts',
  'src/lib/i18n/format.ts',
  'src/shared/i18n/formatters.ts',
  'messages/en.json',
  'apps/react/src/features/chat/components/chat-video-block.tsx',
  'apps/react/src/components/ui/video-lightbox.tsx',
  'apps/react/src/components/ui/video-actions-menu.tsx',
  'apps/react/src/components/ui/media-unavailable.tsx',
  'apps/react/src/components/ui/media-lightbox/index.tsx',
  'apps/react/src/components/ui/button.tsx',
  'apps/react/src/components/ui/file-input.tsx',
  'apps/react/src/catalog/chat-video-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/catalog/catalog-app.tsx',
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
// The historical English catalog locates controls independently of candidate rendering.
// Decorative SVG/source-spelling comparisons are deliberately outside behavioral coverage.
const english = JSON.parse(committed('messages/en.json'));
export const label = (key, args = {}) => {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Missing original message argument ${name}`);
    return String(args[name]);
  });
};
export const test = base.extend({
  videoDependencies: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(info.retry, 'Native media journeys must run without retries').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT || repoRoot;
      const before = {
        runner: hashes(runnerFiles),
        product: hashes(productFiles, root),
        generated: hashes(generatedDependencies, root),
      };
      try {
        await use();
      } finally {
        const after = {
          runner: hashes(runnerFiles),
          product: hashes(productFiles, root),
          generated: hashes(generatedDependencies, root),
        };
        await info.attach('chat-video-dependencies.json', {
          body: JSON.stringify({ original, root, before, after }, null, 2),
          contentType: 'application/json',
        });
        expect(after, 'Video dependencies must remain unchanged during the journey').toEqual(
          before,
        );
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
              if (!(node instanceof window.HTMLVideoElement)) return;
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
      width: window.innerWidth,
      height: window.innerHeight,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
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
        ready: node.readyState >= window.HTMLMediaElement.HAVE_CURRENT_DATA,
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
        enoughData: node.readyState === window.HTMLMediaElement.HAVE_ENOUGH_DATA,
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
  // Realistic intrinsic poster dimensions keep native video controls usable in the fixture.
  const png = new PNG({ width: 320, height: 180 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 120;
    png.data[i + 1] = 190;
    png.data[i + 2] = 50;
    png.data[i + 3] = 255;
  }
  return { name: 'selected-poster.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
// Functional follow-ups observe native state without asserting that browser controls have settled.
// Original paused-image tests continue to enforce the unchanged strict screenshot guard.
export async function observePausedVideo(surface, name, info) {
  const observation = await surface.evaluate((root) => {
    const node = root.querySelector('video');
    const rect = (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const ranges = (value) =>
      Array.from({ length: value.length }, (_, index) => ({
        start: value.start(index),
        end: value.end(index),
      }));
    return {
      geometry: { surface: rect(root), video: rect(node) },
      media: {
        readyState: node.readyState,
        networkState: node.networkState,
        buffered: ranges(node.buffered),
        played: ranges(node.played),
        currentTime: node.currentTime,
        paused: node.paused,
        autoplay: node.autoplay,
        controls: node.controls,
        error: node.error?.code ?? null,
      },
    };
  });
  await info.attach(`${name}-functional-observation.json`, {
    body: JSON.stringify(
      {
        ...observation,
        ax: await surface.ariaSnapshot(),
        pausedImageAcceptance: 'pending; this observation does not establish image stability',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
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
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
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
  let png;
  let after;
  try {
    png = await stableLocatorScreenshot(page, target, async ({ png, ...attempt }) => {
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
  } finally {
    after = { geometry: await geometry(), ax: await target.ariaSnapshot() };
    const groups = {};
    for (const attempt of attempts)
      if (attempt.sha256) (groups[attempt.sha256] ??= []).push(attempt.attempt);
    await info.attach(`${name}-evidence.json`, {
      body: JSON.stringify(
        { before, after, finalSha256: png ? digest(png) : null, identicalAttempts: groups },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
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
      viewport: window.innerWidth,
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
