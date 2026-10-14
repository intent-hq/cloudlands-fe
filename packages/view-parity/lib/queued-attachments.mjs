import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Original source owns the oracle. Callback observations do not establish
// Lightbox, file-service, production queue or source-paired image acceptance.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourceFiles = [
  'src/lib/components/chat/QueuedMessageAttachments.svelte',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/i18n/format.ts',
  'src/lib/i18n/locale.ts',
  'src/shared/i18n/formatters.ts',
];
const ownFiles = [
  'packages/view-parity/lib/queued-attachments.mjs',
  'packages/view-parity/tests/queued-attachments.core.spec.mjs',
  'packages/view-parity/tests/queued-attachments.extended.spec.mjs',
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
const committed = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const committedHashes = (files, sha) =>
  Object.fromEntries(files.map((file) => [file, digest(committed(file, sha))]));

// Read the immutable catalog, never the candidate's rendered observations or
// implementation helper. English is the actual catalog locale in this lane;
// navigator.language alone does not switch the application's locale owner.
const english = JSON.parse(committed('messages/en.json').toString());
const integer = (number) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(number);
const interpolate = (key, values) =>
  english[key].replace(/\{([^}]+)\}/g, (_, key) => String(values[key]));
export const imageName = (index, total) =>
  interpolate('chat_chatMessage_viewAttachedImage_ariaLabel', {
    number: integer(index + 1),
    total: integer(total),
  });
export const imageAlt = (index) =>
  interpolate('chat_chatMessage_attachedImage_alt', { number: integer(index + 1) });
export const fileTitle = (name) => interpolate('chat_chatMessage_openAttachment_title', { name });

export const test = base.extend({
  attachmentsFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_QUEUED_ATTACHMENTS_APPROVED,
        'Coordinator must release the exact tests, independent candidate, dependencies and URL',
      ).toBe('1');
      const sha = process.env.PARITY_QUEUED_ATTACHMENTS_SHA;
      const testSha = process.env.PARITY_QUEUED_ATTACHMENTS_TEST_SHA;
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
      expect(sourceBefore, 'Original sources must remain unchanged').toEqual(
        committedHashes(sourceFiles, original),
      );
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(sourceFiles);
        const candidateAfter = candidateProvenance(root);
        await info.attach('queued-attachments-freeze.json', {
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
  attachmentsNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('queued-attachments-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  attachmentsObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          await info.attach('queued-attachments-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="queued-attachments"] pre')
                .allTextContents(),
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

export { expect, captureTranscript as captureAttachments };

export async function openAttachments(page) {
  const host = await openExample(page, 'queued-attachments', 'queued-attachments');
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

export async function expectDecoded(image) {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => ({
        complete: node.complete,
        width: node.naturalWidth > 0,
        height: node.naturalHeight > 0,
      })),
    )
    .toEqual({ complete: true, width: true, height: true });
}

export async function expectSameNode(handle, current) {
  expect(
    await current.evaluate((node, old) => node === old, handle),
    'An index-keyed attachment slot must retain its actual button',
  ).toBe(true);
}

export async function expectAttachmentsContained(frame, info, name) {
  await frame.scrollIntoViewIfNeeded();
  const measured = await frame.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      frame: rect(root),
      viewportWidth: window.innerWidth,
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
  expect(measured.frame.right).toBeLessThanOrEqual(measured.viewportWidth);
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1);
  expect(measured.buttons.length).toBeGreaterThan(0);
  for (const { bounds, hit } of measured.buttons) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(measured.frame.left - 1);
    expect(bounds.right).toBeLessThanOrEqual(measured.frame.right + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(measured.frame.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(measured.frame.bottom + 1);
    expect(hit, 'Every attachment must remain pointer accessible at the narrow viewport').toBe(
      true,
    );
  }
  // Do not require the entire rendered filename to fit. Source deliberately
  // truncates that text; its full accessible name and title are checked apart.
}

export function attachmentExercise(host) {
  const section = host;
  const frame = section.getByTestId('queued-attachments-frame');
  return {
    section,
    frame,
    leaf: frame.getByTestId('queued-attachments-leaf'),
    images: frame.getByTestId('queued-image-thumbnail'),
    files: frame.getByTestId('queued-file-chip'),
    state: () => outputJson(section.getByTestId('queued-attachments-state')),
  };
}

export const control = (item, name) => item.section.getByRole('button', { name, exact: true });
export const toggle = (item, name) => item.section.getByRole('switch', { name, exact: true });
export async function content(item, name) {
  await item.section
    .getByRole('radiogroup', { name: 'Attachment content', exact: true })
    .getByRole('radio', { name, exact: true })
    .click();
}
export async function count(item, name, value) {
  await item.section.getByRole('spinbutton', { name, exact: true }).fill(String(value));
}
export async function clearObservations(item) {
  await control(item, 'Clear attachment observations').click();
  await expect
    .poll(async () => (await item.state()).observations)
    .toEqual({
      parentCount: 0,
      callbackCount: 0,
      parent: [],
      callbacks: [],
    });
}

// Independently specified ordinary caller input, sent through the actual leaf.
// The observation's sameBlock flag checks object identity before serialization.
const pngData = [
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNQmLDgPzJmIF0AANL4JPHDGowUAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNYEDDhPzJmIF0AAEOHJ/H2CiJQAAAAAElFTkSuQmCC',
];
export const imageSource = (ordinal, resolverRevision = 0) =>
  `data:image/png;base64,${pngData[resolverRevision % 2 ? 1 : (ordinal - 1) % 2]}`;
export const defaultPrefix = 'queued-attachment-with-a-long-name';
export function expectedCallback(
  kind,
  index,
  {
    ordinal = index + 1,
    blockRevision = 0,
    callbackRevision = 0,
    resolverRevision = 0,
    mountRevision = 0,
    prefix = defaultPrefix,
  } = {},
) {
  const block =
    kind === 'image'
      ? {
          type: 'image',
          attachmentId: `queued-image-${blockRevision}-${ordinal}`,
          mimeType: 'image/png',
          data: pngData[(ordinal - 1) % 2],
        }
      : {
          type: 'file',
          attachmentId: `queued-file-${blockRevision}-${ordinal}`,
          fileName: `${prefix}-${ordinal}.txt`,
          mimeType: 'text/plain',
          size: 1023 + ordinal,
        };
  return {
    kind,
    callbackRevision,
    resolverRevision,
    mountRevision,
    block,
    sameBlock: true,
    index,
    ...(kind === 'image'
      ? {
          opener: {
            isButton: true,
            sameAsIndexedButton: true,
            sameAsCapturedButton: true,
            contained: true,
            connected: true,
            tagName: 'BUTTON',
            testId: 'queued-image-thumbnail',
            slot: 'button',
            capturedClickTrusted: true,
          },
        }
      : {}),
  };
}
export async function expectCallbacks(item, expected) {
  await expect
    .poll(async () => {
      const { callbackCount, callbacks } = (await item.state()).observations;
      return { callbackCount, callbacks };
    })
    .toEqual({ callbackCount: expected.length, callbacks: expected });
}
export async function expectParent(item, activations) {
  const expected = activations.flatMap(({ kind, pointer }) =>
    (pointer ? ['pointer-capture', 'pointer-bubble', 'click-capture'] : ['click-capture']).map(
      (phase) => ({
        phase,
        buttonTestId: kind === 'image' ? 'queued-image-thumbnail' : 'queued-file-chip',
        trusted: true,
      }),
    ),
  );
  await expect
    .poll(async () => {
      const { parentCount, parent } = (await item.state()).observations;
      return {
        parentCount,
        parent: parent.map(({ phase, buttonTestId, trusted }) => ({
          phase,
          buttonTestId,
          trusted,
        })),
      };
    })
    .toEqual({ parentCount: expected.length, parent: expected });
}
