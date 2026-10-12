import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

// Only native caller-prop observations: no source-paired visual, service, catalog
// hydration, or full-motion acceptance. Keep the established guards unchanged.
const runnerFiles = [
  'packages/view-parity/tests/chat-transcript.core.spec.mjs',
  'packages/view-parity/tests/chat-transcript.extended.spec.mjs',
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

function runnerHashes() {
  return Object.fromEntries(
    runnerFiles.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(path.join(repoRoot, file)))
        .digest('hex'),
    ]),
  );
}

export const test = base.extend({
  transcriptFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_TRANSCRIPT_APPROVED,
        'Coordinator must release the frozen tests, immutable candidate and independent endpoint',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_TRANSCRIPT_SHA;
      expect(sha, 'Release must name the full immutable candidate commit').toMatch(
        /^[a-f0-9]{40}$/,
      );
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Never test the shared editing checkout').not.toBe(
        realpathSync(repoRoot),
      );
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = runnerHashes();
      try {
        await use();
      } finally {
        const after = runnerHashes();
        const candidateAfter = candidateProvenance(root);
        await info.attach('chat-transcript-freeze.json', {
          body: JSON.stringify({ sha, root, before, after, candidate, candidateAfter }, null, 2),
          contentType: 'application/json',
        });
        expect(after, 'Verification code changed during execution').toEqual(before);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
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
        await info.attach('chat-transcript-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});
export { expect, outputJson };

export async function openTranscript(page) {
  const host = await openExample(page, 'chat-transcript', 'chat-transcript');
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

export async function captureTranscript(page, target, name, info) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const bounds = () =>
    target.evaluate((root) => {
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        root: rect(root),
        descendants: [
          ...root.querySelectorAll('button, [role], [data-testid="conversation-turn-gap"]'),
        ].map((node) => ({
          role: node.getAttribute('role'),
          name: node.getAttribute('aria-label'),
          hidden: node.getAttribute('aria-hidden'),
          bounds: rect(node),
        })),
      };
    });
  const before = await bounds();
  const png = await stableLocatorScreenshot(page, target, async ({ png, ...attempt }) => {
    if (png)
      await info.attach(`${name}-attempt-${attempt.attempt}.png`, {
        body: png,
        contentType: 'image/png',
      });
    await info.attach(`${name}-attempt-${attempt.attempt}.json`, {
      body: JSON.stringify(attempt, null, 2),
      contentType: 'application/json',
    });
  });
  const after = await bounds();
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  await info.attach(`${name}-bounds.json`, {
    body: JSON.stringify({ before, after, aria: await target.ariaSnapshot() }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capture must preserve the observed layout').toEqual(before);
  return after;
}

export async function chooseProp(page, host, label, value) {
  const trigger = host.getByRole('combobox', { name: label, exact: true });
  await trigger.press('Enter');
  await page.getByRole('option', { name: value, exact: true }).click();
}

export async function expectReadable(target) {
  // The independent contract is readable, contained text at the assigned narrow
  // viewport, not font/spacing/color values or classes copied from implementation.
  await target.scrollIntoViewIfNeeded();
  const measurement = await target.evaluate((root) => {
    const outer = root.getBoundingClientRect();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textBounds = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects())
        if (rect.width && rect.height)
          textBounds.push({
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          });
    }
    return {
      left: outer.left,
      right: outer.right,
      top: outer.top,
      bottom: outer.bottom,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      viewport: innerWidth,
      textBounds,
    };
  });
  expect(measurement.left).toBeGreaterThanOrEqual(0);
  expect(measurement.right).toBeLessThanOrEqual(measurement.viewport);
  expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.clientWidth + 1);
  expect(measurement.textBounds.length).toBeGreaterThan(0);
  for (const bounds of measurement.textBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(measurement.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(measurement.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(measurement.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(measurement.bottom + 1);
  }
}
