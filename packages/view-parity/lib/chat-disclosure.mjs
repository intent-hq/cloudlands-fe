import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, outputJson } from './functional.mjs';
import { endpoint, repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript, chooseProp, expectReadable } from './chat-transcript.mjs';

// Original003 is the behavioral oracle. This fixture does not claim matched
// source images, daemon operations, or production transcript integration.
const runnerFiles = [
  'packages/view-parity/lib/chat-disclosure.mjs',
  'packages/view-parity/tests/chat-disclosure.core.spec.mjs',
  'packages/view-parity/tests/chat-disclosure.extended.spec.mjs',
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
const disclosureNetworks = new WeakMap();

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
  disclosureFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_DISCLOSURE_APPROVED,
        'Coordinator must release the committed tests, immutable candidate, dependencies and URL',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_DISCLOSURE_SHA;
      expect(sha, 'The release must name the full candidate commit').toMatch(/^[a-f0-9]{40}$/);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Never execute against the shared editing checkout').not.toBe(
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
        await info.attach('chat-disclosure-freeze.json', {
          body: JSON.stringify({ sha, root, before, after, candidate, candidateAfter }, null, 2),
          contentType: 'application/json',
        });
        expect(after, 'Verification code changed during the attempt').toEqual(before);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  disclosureNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      disclosureNetworks.set(page, network);
      try {
        await use();
      } finally {
        disclosureNetworks.delete(page);
        await info.attach('chat-disclosure-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});

export { expect, outputJson, chooseProp, expectReadable, captureTranscript as captureDisclosure };

export async function openDisclosure(page, motion = 'reduced') {
  const origin = endpoint(process.env.PARITY_CANDIDATE_URL, 'PARITY_CANDIDATE_URL');
  const url = new URL(`${origin}/sandbox/chat-disclosure`);
  url.search = new URLSearchParams({
    example: 'interactive',
    theme: 'light',
    width: '420',
    motion,
  });
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `Cannot load the actual chat disclosure exercise at ${url}`).toBe(true);
  const host = page.getByTestId('chat-disclosure-examples');
  await expect(host).toBeVisible({ timeout: 15_000 });
  await expect(host.locator('[data-catalog-unimplemented]')).toHaveCount(0);
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
    reduced: motion === 'reduced',
    dark: false,
  });
  await page.evaluate(() => document.fonts.ready);
  return host;
}

export async function prepareFollowedDisclosure(host) {
  const exercise = host.getByTestId('chat-operational');
  await exercise.getByRole('switch', { name: 'Animate row details height', exact: true }).click();
  await exercise
    .getByRole('switch', { name: 'Use disclosure row details motion', exact: true })
    .click();
  const scroll = exercise.getByTestId('chat-disclosure-scroll-host');
  await scroll.scrollIntoViewIfNeeded();
  await exercise.getByRole('button', { name: 'Follow row to bottom', exact: true }).click();
  return {
    exercise,
    scroll,
    trigger: exercise.getByTestId('operational-trigger'),
    details: exercise.locator('[id="caller-row-details"]'),
  };
}

export async function readScrollSnapshot(exercise) {
  // Real native control -> canonical read helpers on the actual scroll owner.
  await exercise.getByRole('button', { name: 'Read row scroll state', exact: true }).press('Enter');
  return (await outputJson(exercise.getByTestId('chat-disclosure-scroll-state'))).snapshot;
}

export async function waitForDisclosedControl(details) {
  // The last real action must be inside the disclosed area, not clipped by an
  // unfinished transition. Compare actual geometry, never prescribed CSS values.
  await expect
    .poll(() =>
      details.evaluate((node) => {
        const button = node.querySelector('button');
        if (!button) return false;
        const outer = node.getBoundingClientRect();
        const control = button.getBoundingClientRect();
        return control.top >= outer.top - 1 && control.bottom <= outer.bottom + 1;
      }),
    )
    .toBe(true);
}

export async function expectFollowedAndSettled(exercise) {
  await expect.poll(async () => (await readScrollSnapshot(exercise)).hasActiveMutation).toBe(false);
  const snapshot = await readScrollSnapshot(exercise);
  expect(snapshot.isFollowing).toBe(true);
  // Scroll geometry has integer layout extents but can have fractional offsets.
  // One pixel accounts for native rounding at the actual maximum; no decorative
  // height or spacing is prescribed by this behavioral bottom-pinning check.
  expect(
    Math.abs(snapshot.scrollHeight - snapshot.clientHeight - snapshot.scrollTop),
  ).toBeLessThanOrEqual(1);
  return snapshot;
}

export function expectLeaseLifetime(samples, connected = true) {
  expect(
    samples.some((sample) => sample.connected && sample.isFollowing && sample.hasActiveMutation),
    'The real follower must hold a mutation lease before its release can be verified',
  ).toBe(true);
  expect(
    samples.at(-1),
    'The actual canonical lease must be released after settlement or teardown',
  ).toMatchObject({ connected, isFollowing: connected, hasActiveMutation: false });
}

export async function observeScrollFrames(scroll) {
  // Read-only observation armed before input. Native rAF and layout are neither
  // replaced nor advanced, and no event or application state is synthesized.
  const modulePath = `/@fs${path.join(realpathSync(process.env.PARITY_CANDIDATE_ROOT), 'src/lib/utils/smartScroll.ts')}`;
  // Reuse the exact module URL loaded by the real caller, including its query,
  // from the existing strict network recorder. A guessed URL could create a
  // second empty ownership registry; resource timing's bounded buffer can omit it.
  const origin = new URL(process.env.PARITY_CANDIDATE_URL).origin;
  const moduleUrls = [
    ...new Set(disclosureNetworks.get(scroll.page()).requests.map(({ url }) => url)),
  ].filter((name) => {
    const url = new URL(name);
    return url.origin === origin && decodeURIComponent(url.pathname) === modulePath;
  });
  expect(moduleUrls, 'Expected one loaded canonical smartScroll module').toHaveLength(1);
  const handle = await scroll.evaluateHandle(async (node, moduleUrl) => {
    const { hasActiveFollowBottomMutation, isFollowingBottom } = await import(moduleUrl);
    const samples = [];
    let frame;
    let stopped = false;
    let shrinkResolve;
    let activeResolve;
    const shrinking = new Promise((resolve) => {
      shrinkResolve = resolve;
    });
    const active = new Promise((resolve) => {
      activeResolve = resolve;
    });
    const readSample = () => {
      const details = node.querySelector('[id="caller-row-details"]');
      samples.push({
        connected: node.isConnected,
        isFollowing: isFollowingBottom(node),
        hasActiveMutation: hasActiveFollowBottomMutation(node),
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        detailsPresent: Boolean(details),
        detailsHeight: details?.getBoundingClientRect().height ?? 0,
      });
      const latest = samples.at(-1);
      if (latest.isFollowing && latest.hasActiveMutation) {
        activeResolve(true);
        if (latest.detailsHeight > 0 && latest.detailsHeight < samples[0].detailsHeight)
          shrinkResolve(true);
      }
    };
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      activeResolve(false);
      shrinkResolve(false);
    };
    // A real observation deadline bounds both promises even if rAF is suspended.
    // This does not advance, replace, or influence the application's clock.
    const deadline = setTimeout(stop, 5_000);
    const sample = () => {
      readSample();
      if (!stopped && samples.length < 2048) frame = requestAnimationFrame(sample);
      else stop();
    };
    sample();
    return {
      shrinking,
      active,
      stop() {
        stop();
        readSample();
        return { moduleUrl, samples };
      },
    };
  }, moduleUrls[0]);
  const finish = async (name, info) => {
    let observation;
    try {
      observation = await handle.evaluate((value) => value.stop());
    } finally {
      await handle.dispose();
    }
    await info.attach(`${name}-frames.json`, {
      body: JSON.stringify(observation, null, 2),
      contentType: 'application/json',
    });
    return observation.samples;
  };
  finish.waitForActive = async () => {
    expect(
      await handle.evaluate((observation) => observation.active),
      'The actual canonical follower must acquire a mutation lease during native motion',
    ).toBe(true);
  };
  finish.waitForShrink = async () => {
    expect(
      await handle.evaluate((observation) => observation.shrinking),
      'Native collapse must shrink while the canonical follower holds an active mutation lease',
    ).toBe(true);
  };
  return finish;
}
