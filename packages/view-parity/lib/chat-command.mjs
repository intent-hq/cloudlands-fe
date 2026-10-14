import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Original source is the oracle. Pure caller props and real clipboard input do
// not establish daemon, production transcript or source-paired image acceptance.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourceFiles = [
  'src/lib/components/chat/QueuedMessageActions.svelte',
  'src/lib/components/chat/ChatCliBlock.svelte',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/components/ui/CopyButton.svelte',
];
const ownFiles = [
  'packages/view-parity/lib/chat-command.mjs',
  'packages/view-parity/tests/chat-command.core.spec.mjs',
  'packages/view-parity/tests/chat-command.extended.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
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
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = (files) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(repoRoot, file)))]));
const committedHashes = (files, sha) =>
  Object.fromEntries(
    files.map((file) => [
      file,
      digest(execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot })),
    ]),
  );

export const test = base.extend({
  commandFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_CHAT_COMMAND_APPROVED,
        'Coordinator must release the exact committed tests, independent candidate, dependencies and URL',
      ).toBe('1');
      const sha = process.env.PARITY_CHAT_COMMAND_SHA;
      const testSha = process.env.PARITY_CHAT_COMMAND_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retries are authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root), 'Never execute the shared editing checkout').not.toBe(
        realpathSync(repoRoot),
      );
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = hashes(runnerFiles);
      const sourceBefore = hashes(sourceFiles);
      expect(hashes(ownFiles), 'Tests must match the released committed test freeze').toEqual(
        committedHashes(ownFiles, testSha),
      );
      expect(sourceBefore, 'Original source must remain unchanged').toEqual(
        committedHashes(sourceFiles, original),
      );
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(sourceFiles);
        const candidateAfter = candidateProvenance(root);
        await info.attach('chat-command-freeze.json', {
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
  commandNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('chat-command-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  commandObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          await info.attach('chat-command-observations.json', {
            body: JSON.stringify(
              await page.locator('[data-functional-example="chat-command"] pre').allTextContents(),
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

export { expect, captureTranscript as captureCommand };

export async function openCommand(page) {
  const host = await openExample(page, 'chat-command', 'chat-command');
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

export async function nativePaste(paste, expected) {
  // Actual browser paste; neither the clipboard nor Clipboard methods are seeded.
  await paste.fill('');
  await paste.press('ControlOrMeta+V');
  await expect(paste).toHaveValue(expected);
}

export const toggle = (exercise, name) => exercise.getByRole('switch', { name, exact: true });
export const actionButton = (exercise, name) =>
  exercise.getByTestId('command-queued-parent').getByRole('button', { name, exact: true });
export const actionState = async (exercise) =>
  (await outputJson(exercise.getByTestId('command-queued-actions-state'))).observations;

export function expectedCallback(action, revision = 0, detail = 1) {
  // Original003 calls edit with no argument and passes click to send/remove.
  return {
    action,
    revision,
    argumentCount: action === 'edit' ? 0 : 1,
    event:
      action === 'edit'
        ? null
        : {
            type: 'click',
            detail,
            isTrusted: true,
            currentTargetLabel: action === 'sendNow' ? 'Send immediately' : 'Remove',
          },
  };
}

export async function expectCallbacks(exercise, expected) {
  await expect.poll(async () => (await actionState(exercise)).callbacks).toEqual(expected);
}

export async function clearActions(exercise) {
  await exercise.getByRole('button', { name: 'Clear observations', exact: true }).click();
  await expect
    .poll(() => actionState(exercise))
    .toEqual({
      callbacks: [],
      parentClicks: [],
      parentPointerDowns: [],
    });
}

export async function nativeClickDisabled(page, button) {
  await expect(button).toBeDisabled();
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  // Real pointer input to the disabled control, without bypassing browser state.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function tabThroughActions(page, host, enabledNames, name, info) {
  const exercise = host.getByTestId('command-queued-actions');
  const after = host
    .getByTestId('command-cli')
    .getByRole('radiogroup', { name: 'Command preset', exact: true })
    .getByRole('radio', { name: 'current', exact: true });
  await exercise.getByRole('button', { name: 'Remount Queued actions', exact: true }).click();
  const visited = [];
  let reachedAfter = false;
  try {
    // Three source tooltip wrappers plus three buttons and the next control.
    // This bounds traversal, not elapsed performance; no focus() or DOM writes.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      if (await after.evaluate((node) => node === document.activeElement)) {
        reachedAfter = true;
        break;
      }
      const observation = await exercise.getByTestId('command-queued-parent').evaluate((node) => {
        const active = document.activeElement;
        return {
          inside: node.contains(active),
          tag: active?.tagName,
          label: active?.getAttribute('aria-label'),
          disabled: active instanceof window.HTMLButtonElement && active.disabled,
        };
      });
      visited.push(observation);
      expect(observation.inside, 'Tab escaped before reaching the next real caller control').toBe(
        true,
      );
      expect(observation.disabled, 'A disabled action must not receive keyboard focus').toBe(false);
    }
    expect(reachedAfter, 'Tab must leave the queued actions').toBe(true);
    expect(visited.filter(({ tag }) => tag === 'BUTTON').map(({ label }) => label)).toEqual(
      enabledNames,
    );
  } finally {
    await info.attach(`${name}-tab.json`, {
      body: JSON.stringify({ enabledNames, reachedAfter, visited }, null, 2),
      contentType: 'application/json',
    });
  }
}

export async function expectCommandContained(frame, info, name) {
  await frame.scrollIntoViewIfNeeded();
  const bounds = await frame.evaluate((root) => {
    const copy = root.querySelector('[data-testid="chat-cli-copy"]');
    const code = root.querySelector('code');
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const control = rect(copy);
    const hit = document.elementFromPoint(
      (control.left + control.right) / 2,
      (control.top + control.bottom) / 2,
    );
    return {
      frame: rect(root),
      card: rect(code.parentElement),
      control,
      code: rect(code),
      viewportWidth: window.innerWidth,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      copyHit: hit === copy || copy.contains(hit),
    };
  });
  await info.attach(`${name}-containment.json`, {
    body: JSON.stringify(bounds, null, 2),
    contentType: 'application/json',
  });
  expect(bounds.frame.left).toBeGreaterThanOrEqual(0);
  expect(bounds.frame.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  expect(bounds.copyHit, 'The copy control must remain pointer accessible for long text').toBe(
    true,
  );
  for (const rect of [bounds.card, bounds.control, bounds.code]) {
    expect(rect.left).toBeGreaterThanOrEqual(bounds.frame.left - 1);
    expect(rect.right).toBeLessThanOrEqual(bounds.frame.right + 1);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  }
  expect(bounds.control.top).toBeGreaterThanOrEqual(bounds.card.top - 1);
  expect(bounds.control.bottom).toBeLessThanOrEqual(bounds.card.bottom + 1);
  expect(bounds.code.right).toBeLessThanOrEqual(bounds.control.left + 1);
}
