import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, outputJson } from './functional.mjs';
import { endpoint, repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript, expectReadable } from './chat-transcript.mjs';

// Behavioral oracle: original003's seven metadata leaves and their real helpers.
// Ordinary caller props do not establish stream hydration or domain integration.
const runnerFiles = [
  'packages/view-parity/lib/chat-metadata.mjs',
  'packages/view-parity/tests/chat-metadata.core.spec.mjs',
  'packages/view-parity/tests/chat-metadata.extended.spec.mjs',
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
  metadataFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_METADATA_APPROVED,
        'Coordinator must release the committed tests, immutable candidate, dependencies and URL',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_METADATA_SHA;
      expect(sha, 'Release must name the full immutable candidate commit').toMatch(
        /^[a-f0-9]{40}$/,
      );
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
        await info.attach('chat-metadata-freeze.json', {
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
  metadataNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('chat-metadata-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});

export { expect, outputJson, expectReadable, captureTranscript as captureMetadata };

export async function openMetadata(page, motion = 'reduced') {
  const origin = endpoint(process.env.PARITY_CANDIDATE_URL, 'PARITY_CANDIDATE_URL');
  const url = new URL('/sandbox/chat-metadata', origin);
  url.search = new URLSearchParams({
    example: 'interactive',
    theme: 'light',
    width: '420',
    motion,
  });
  expect((await page.goto(url.href, { waitUntil: 'domcontentloaded' }))?.ok()).toBe(true);
  const host = page.locator('[data-functional-example="chat-metadata"]');
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

// Observe actual input and DOM timestamps without patching any clock, timer,
// component, state, event, or animation. The observation clock is the browser's
// own performance clock; the grace bound comes from the original source contract.
export async function observeNativeLifetime(target, selector) {
  const handle = await target.evaluateHandle((root, match) => {
    const samples = [];
    const inputs = [];
    const identities = new WeakMap();
    const waits = new Map();
    let nextId = 1;
    let last = '';
    const read = () => {
      const nodes = [...root.querySelectorAll(match)].map((node) => {
        if (!identities.has(node)) identities.set(node, nextId++);
        return {
          id: identities.get(node),
          text: node.textContent,
          connected: node.isConnected,
          inert: node.inert,
          height: node.getBoundingClientRect().height,
        };
      });
      const signature = JSON.stringify(nodes);
      if (signature !== last) {
        samples.push({ at: performance.now(), nodes });
        last = signature;
        for (const check of waits.keys()) check();
      }
    };
    const onInput = (event) => {
      if (!root.contains(event.target)) return;
      const node = event.target.closest('button, input, [role="switch"], [role="option"]');
      inputs.push({
        at: performance.now(),
        type: event.type,
        trusted: event.isTrusted,
        role: node?.getAttribute('role') ?? null,
        name: node?.getAttribute('aria-label') || node?.textContent || '',
        value: node?.value ?? null,
        checked: node?.getAttribute('aria-checked') ?? null,
      });
    };
    const observer = new MutationObserver(read);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    root.addEventListener('click', onInput, true);
    root.addEventListener('input', onInput, true);
    read();
    return {
      read() {
        read();
        return { samples, inputs, now: performance.now() };
      },
      waitForShrink() {
        const start = inputs.at(-1)?.at ?? 0;
        const original = samples.find(({ nodes }) => nodes.length)?.nodes[0];
        return new Promise((resolve) => {
          const complete = (value) => {
            clearTimeout(deadline);
            waits.delete(check);
            resolve(value);
          };
          const check = () => {
            if (
              samples.some(
                ({ at, nodes }) =>
                  at > start &&
                  nodes.some(
                    (node) =>
                      node.id === original?.id && node.height > 0 && node.height < original.height,
                  ),
              )
            )
              complete(true);
          };
          const deadline = setTimeout(() => complete(false), 5000);
          waits.set(check, () => complete(false));
          check();
        });
      },
      stop() {
        read();
        observer.disconnect();
        for (const cancel of waits.values()) cancel();
        root.removeEventListener('click', onInput, true);
        root.removeEventListener('input', onInput, true);
        return { samples, inputs, now: performance.now() };
      },
    };
  }, selector);
  return {
    read: () => handle.evaluate((value) => value.read()),
    waitForShrink: () => handle.evaluate((value) => value.waitForShrink()),
    async finish(name, info) {
      let evidence;
      try {
        evidence = await handle.evaluate((value) => value.stop());
      } finally {
        await handle.dispose();
      }
      await info.attach(`${name}-lifetime.json`, {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      return evidence;
    },
  };
}

// A bounded real observation interval, only for absence over the source grace
// window. Never install or advance a virtual clock or suppress app timers.
export async function observeRealTime(page, milliseconds) {
  await page.evaluate(
    (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    milliseconds,
  );
}

export async function nativePaste(paste, expected) {
  await paste.fill('');
  await paste.press('ControlOrMeta+V');
  await expect(paste).toHaveValue(expected);
}

export async function choice(exercise, label, value) {
  await exercise
    .getByRole('radiogroup', { name: label, exact: true })
    .getByRole('radio', { name: value, exact: true })
    .click();
}

export const frame = (exercise, id) => exercise.getByTestId(`${id}-frame`);
export const toggle = (exercise, name) => exercise.getByRole('switch', { name, exact: true });
