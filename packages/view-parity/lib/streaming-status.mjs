import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';
import { nativePaste, observeRealTime } from './chat-metadata.mjs';

// Original source, including its outer visibility gate, is the oracle.
// These cases establish local caller behavior only. Settings is a host callback;
// service recovery, source-paired images and full-motion behavior need separate release.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const helperPath = 'src/lib/components/chat/streaming-status-utils.ts';
const sourceFiles = [
  'src/lib/components/chat/StreamingStatus.svelte',
  helperPath,
  'src/lib/components/chat/StreamingTypingIndicator.svelte',
  'src/lib/components/chat/FailureDetails.svelte',
  'src/lib/components/ui/RelativeTime.svelte',
  'src/lib/components/ui/CopyButton.svelte',
  'src/lib/utils/reactive-time.svelte.ts',
  'src/lib/utils/shared-time-manager.svelte.ts',
  'src/shared/i18n/formatters.ts',
];
const ownFiles = [
  'packages/view-parity/lib/streaming-status.mjs',
  'packages/view-parity/tests/streaming-status.core.spec.mjs',
  'packages/view-parity/tests/streaming-status.extended.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
  'packages/view-parity/lib/chat-transcript.mjs',
  'packages/view-parity/lib/chat-metadata.mjs',
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
const hashes = (files) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(repoRoot, file)))]));
const committed = (file, sha) => execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const committedHashes = (files, sha) =>
  Object.fromEntries(files.map((file) => [file, digest(committed(file, sha))]));

export const test = base.extend({
  streamingFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_STREAMING_STATUS_APPROVED,
        'Coordinator must release exact tests, source, dependencies and independent URL',
      ).toBe('1');
      const sha = process.env.PARITY_STREAMING_STATUS_SHA;
      const testSha = process.env.PARITY_STREAMING_STATUS_TEST_SHA;
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
      expect(hashes(ownFiles), 'Tests must match their committed release').toEqual(
        committedHashes(ownFiles, testSha),
      );
      const before = hashes(runnerFiles);
      const sourceBefore = hashes(sourceFiles);
      const originalHashes = committedHashes(sourceFiles, original);
      const unchanged = sourceFiles.filter((file) => file !== helperPath);
      expect(hashes(unchanged), 'Original Svelte source must remain intact').toEqual(
        committedHashes(unchanged, original),
      );
      const originalHelper = committed(helperPath, original).toString('utf8');
      expect(
        readFileSync(path.join(repoRoot, helperPath), 'utf8'),
        'Only the released type-only helper import seam is permitted',
      ).toBe(
        originalHelper.replace(
          "from '$lib/components/ui/indicators'",
          "from '../ui/indicators/intent-mark-vector'",
        ),
      );
      expect(sourceBefore, 'Source profile must match the released product').toEqual(
        committedHashes(sourceFiles, sha),
      );
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(sourceFiles);
        const candidateAfter = candidateProvenance(root);
        await info.attach('streaming-status-freeze.json', {
          body: JSON.stringify(
            {
              original,
              originalHashes,
              sha,
              testSha,
              root,
              before,
              after,
              sourceBefore,
              sourceAfter,
              candidate,
              candidateAfter,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after, 'Verification code changed during the attempt').toEqual(before);
        expect(sourceAfter).toEqual(sourceBefore);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  streamingNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('streaming-status-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  streamingObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          await info.attach('streaming-status-observations.json', {
            body: JSON.stringify(
              await page.getByTestId('streaming-status-state').allTextContents(),
              null,
              2,
            ),
            contentType: 'application/json',
          });
        }
      }
    },
    { auto: true },
  ],
});

export { expect, nativePaste, observeRealTime, captureTranscript as captureStreaming };

export async function openStreaming(page) {
  const host = await openExample(page, 'streaming-status', 'streaming-status');
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
  return host;
}

export const frame = (host) => host.getByTestId('streaming-status-frame');
export const caller = (host) => outputJson(host.getByTestId('streaming-status-state'));
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const field = (host, name) => host.getByLabel(name, { exact: true });
export async function toggle(host, name, value) {
  const control = host.getByRole('switch', { name, exact: true });
  if (((await control.getAttribute('aria-checked')) === 'true') !== value) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(value));
}
export async function choice(host, name, value) {
  await host
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true })
    .click();
}

export async function emit(host, phase, message) {
  await choice(host, 'Status event phase', phase);
  await field(host, 'Status event message').fill(message);
  await button(host, 'Emit status event').click();
}

export async function applyEvents(host, events) {
  await field(host, 'Status events JSON').fill(JSON.stringify(events));
  await button(host, 'Apply status events').click();
}

export async function applyChunk(host, timestamp) {
  await field(host, 'Last chunk timestamp').fill(timestamp === null ? '' : String(timestamp));
  await button(host, 'Apply last chunk timestamp').click();
}

export async function errorState(host) {
  await toggle(host, 'Processing active', false);
  await toggle(host, 'Streaming active', false);
  await toggle(host, 'Include error', true);
  await choice(host, 'Recovery state', 'action-needed');
  await expect(frame(host).getByRole('alert')).toBeVisible();
}
