import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

// Leaf caller-prop contracts only. Reuse the existing strict runtime, provenance,
// raw HMR-frame guard and real-Locator capture without changing their behavior.
const runnerFiles = [
  'packages/view-parity/tests/sidebar-mentions.core.spec.mjs',
  'packages/view-parity/tests/sidebar-mentions.extended.spec.mjs',
  'packages/view-parity/lib/sidebar-mentions.mjs',
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
  sidebarMentionFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_SIDEBAR_MENTIONS_APPROVED,
        'Coordinator must release the frozen tests, immutable candidate and independent endpoint',
      ).toBe('1');
      const sha = process.env.PARITY_SIDEBAR_MENTIONS_SHA;
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
        await info.attach('sidebar-mentions-freeze.json', {
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
  sidebarMentionNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('sidebar-mentions-network.json', {
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

export async function openLeafExample(page, scene, example) {
  const host = await openExample(page, scene, example);
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
  await host.scrollIntoViewIfNeeded();
  return host;
}

export async function captureLeaf(page, target, name, info) {
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
        controls: [
          ...root.querySelectorAll('button, input, [role="option"], [role="listbox"]'),
        ].map((node) => ({
          id: node.id,
          role: node.getAttribute('role'),
          name: node.getAttribute('aria-label'),
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

export async function expectContained(control, container) {
  const bounds = await control.boundingBox();
  const outer = await container.boundingBox();
  expect(bounds).not.toBeNull();
  expect(outer).not.toBeNull();
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.x).toBeGreaterThanOrEqual(outer.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(outer.x + outer.width);
  expect(bounds.y).toBeGreaterThanOrEqual(outer.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(outer.y + outer.height);
}

export async function chooseProp(page, host, label, value) {
  const trigger = host.getByRole('combobox', { name: label, exact: true });
  await trigger.press('Enter');
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(trigger).toHaveText(value);
}

export async function expectActive(host, kind, option) {
  const input = host.getByRole('combobox', {
    name: kind === 'mention' ? 'Filter mentions' : 'Filter skills',
    exact: true,
  });
  await expect(option).toHaveAttribute('aria-selected', 'true');
  const id = await option.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(input).toHaveAttribute('aria-activedescendant', id);
  await expect(host.getByRole('listbox')).toHaveAttribute('aria-activedescendant', id);
  await expect
    .poll(async () => (await outputJson(host.getByTestId(`${kind}-callback-state`))).activeOption)
    .toBe(id);
  return id;
}
