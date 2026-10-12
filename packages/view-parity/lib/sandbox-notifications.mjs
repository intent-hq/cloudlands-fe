// Preparation only. Publish these two files only after a separate coordinator release.
// Runtime additionally requires the exact product/test/root/URL and single-case GO.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';
import { label } from './message-actions.mjs';
import { nativePaste } from './chat-command.mjs';
import { expectCode } from './chat-reference.mjs';

// Reuse the existing original003 localization oracle and real native-paste helper.
// These bounded regressions do not accept source pixels, image I6, full motion or services.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const originalFiles = [
  'src/routes/sandbox/+layout.svelte',
  'src/lib/components/ui/toast/Toast.svelte',
  'src/lib/components/patterns/notify/notify.ts',
  'src/lib/component-catalog/renderers/ToastCatalogPreview.svelte',
  'src/lib/components/ui/CopyButton.svelte',
  'src/lib/components/editor/CodeBlock.svelte',
  'src/lib/components/chat/ChatCliBlock.svelte',
  'messages/en.json',
];
const ownFiles = [
  'packages/view-parity/lib/sandbox-notifications.mjs',
  'packages/view-parity/tests/sandbox-notifications.core.spec.mjs',
];
const runnerFiles = [
  ...ownFiles,
  ...[
    'functional',
    'manifest',
    'provenance',
    'browser',
    'agent-avatar',
    'compare',
    'chat-transcript',
    'message-actions',
    'chat-command',
    'chat-reference',
  ].map((name) => `packages/view-parity/lib/${name}.mjs`),
  'packages/view-parity/playwright.config.mjs',
  'packages/view-parity/scripts/run.mjs',
  'packages/view-parity/package.json',
  'packages/view-parity/scene-manifest.json',
  'pnpm-lock.yaml',
];
const profile = [
  ...originalFiles,
  'apps/react/src/catalog/catalog-app.tsx',
  'apps/react/src/catalog/catalog-link.tsx',
  'apps/react/src/catalog/catalog-shell.tsx',
  'apps/react/src/catalog/notify-catalog-preview.tsx',
  'apps/react/src/catalog/toast-catalog-preview.tsx',
  'apps/react/src/catalog/chat-image-examples.tsx',
  'apps/react/src/catalog/chat-reference-examples.tsx',
  'apps/react/src/catalog/chat-command-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/components/ui/toast/toast.tsx',
  'apps/react/src/components/ui/toast/toast.css',
  'apps/react/src/components/patterns/notify/notify.tsx',
  'apps/react/src/components/editor/code-block.tsx',
  'apps/react/src/components/ui/copy-button.tsx',
  'apps/react/src/components/ui/copy-feedback.tsx',
  'apps/react/src/features/chat/components/chat-cli-block.tsx',
];
const generated = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (files, sha) =>
  Object.fromEntries(
    files.map((file) => [
      file,
      digest(execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot })),
    ]),
  );

export const test = base.extend({
  notificationFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_SANDBOX_NOTIFICATIONS_APPROVED,
        'Explicit runtime GO required',
      ).toBe('1');
      const sha = process.env.PARITY_SANDBOX_NOTIFICATIONS_SHA;
      const testSha = process.env.PARITY_SANDBOX_NOTIFICATIONS_TEST_SHA;
      const approvedCase = process.env.PARITY_SANDBOX_NOTIFICATIONS_CASE;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(approvedCase).toMatch(/^SN[1-4]$/);
      expect(info.title.startsWith(`sandbox notifications ${approvedCase}:`)).toBe(true);
      expect(info.retry).toBe(0);
      expect(info.project.retries).toBe(0);
      expect(info.config.workers).toBe(1);
      expect(process.env.PARITY_CANDIDATE_URL).toBe(process.env.PARITY_SANDBOX_NOTIFICATIONS_URL);
      expect(new URL(process.env.PARITY_CANDIDATE_URL).protocol).toBe('http:');
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root)).toBe(realpathSync(process.env.PARITY_SANDBOX_NOTIFICATIONS_ROOT));
      expect(realpathSync(root), 'Never run the shared editing checkout').not.toBe(
        realpathSync(repoRoot),
      );
      const before = hashes(runnerFiles);
      expect(before, 'All verification helpers must match the released test commit').toEqual(
        committed(runnerFiles, testSha),
      );
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const profileBefore = hashes(profile, root);
      expect(profileBefore).toEqual(committed(profile, sha));
      const generatedBefore = hashes(generated, root);
      const originalHashes = committed(originalFiles, original);
      const english = JSON.parse(readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
      for (const key of [
        'ui_copyButton_label',
        'ui_linkTooltip_copied_label',
        'chat_cliBlock_copy_tooltip',
        'chat_cliBlock_copied_tooltip',
        'ui_toast_close_ariaLabel',
        'ui_toast_notifications_ariaLabel',
      ])
        expect(english[key], `Original localized contract: ${key}`).toBe(label(key));
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const candidateAfter = candidateProvenance(root);
        const profileAfter = hashes(profile, root);
        const generatedAfter = hashes(generated, root);
        await info.attach('sandbox-notifications-freeze.json', {
          body: JSON.stringify(
            {
              original,
              originalHashes,
              sha,
              testSha,
              approvedCase,
              root,
              before,
              after,
              profileBefore,
              profileAfter,
              generatedBefore,
              generatedAfter,
              candidate,
              candidateAfter,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after).toEqual(before);
        expect(profileAfter).toEqual(profileBefore);
        expect(generatedAfter).toEqual(generatedBefore);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  notificationNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('sandbox-notifications-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});

export { expect, outputJson, label, expectCode, captureTranscript as capture };
export const button = (scope, name) => scope.getByRole('button', { name, exact: true });
export const field = (scope, name) => scope.getByRole('textbox', { name, exact: true });
// Sonner renders no OL while empty and its toaster ID is routing data, not a DOM ID.
// The original public wrapper owns this ID; named preview wrappers have distinct IDs.
export const defaultHost = (page) => page.locator('[id="app-toast-region"]');
export const activeToasts = (scope) =>
  scope.locator('[data-sonner-toast]:not([data-removed="true"])');

export async function oneDefaultHost(page) {
  const host = defaultHost(page);
  await expect(host).toHaveCount(1);
  await expect(
    host.getByRole('region', { name: new RegExp(`^${label('ui_toast_notifications_ariaLabel')}`) }),
  ).toHaveCount(1);
  return host;
}

export async function open(page, slug) {
  const host = await openExample(page, slug, slug);
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemon: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
    })),
  ).toEqual({
    preload: 'undefined',
    daemon: null,
    width: 420,
    height: 900,
    reduced: true,
    dark: false,
  });
  await page.evaluate(() => document.fonts.ready);
  await oneDefaultHost(page);
  return host;
}

export async function oneToast(page, text) {
  const host = await oneDefaultHost(page);
  const toast = activeToasts(host);
  await expect(toast).toHaveCount(1);
  await expect(toast.getByText(text, { exact: true })).toBeVisible();
  // Detect an accidental second rendering outside the default host, including scoped hosts.
  await expect(page.locator('[data-sonner-toast]').getByText(text, { exact: true })).toHaveCount(1);
  return toast;
}

export async function sameHost(page, handle) {
  const host = await oneDefaultHost(page);
  expect(
    await host.evaluate((node, previous) => node === previous && previous.isConnected, handle),
  ).toBe(true);
}

export async function navigateCatalog(page, slug) {
  const nav = page.getByRole('navigation', { name: 'Component catalog', exact: true });
  await nav.getByRole('searchbox', { name: 'Search catalog', exact: true }).fill(slug);
  const link = nav.locator(`a[href="/sandbox/${slug}"]`);
  await expect(link).toHaveCount(1);
  await link.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/sandbox/${slug}`);
}

export async function copyWithFeedback(page, leaf, copy, paste, text, idle, copied) {
  await leaf.hover();
  await expect(copy).toHaveAccessibleName(idle);
  await copy.click();
  await expect(copy).toHaveAccessibleName(copied);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  // A click closes the tooltip. Real pointer leave/re-entry exposes current feedback.
  await leaf.hover({ position: { x: 1, y: 1 } });
  await copy.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText(copied);
  await expect(tooltip).toBeVisible();
  // Feedback is transient: assert it directly, without capture preparation or
  // freezing the source timer. The caller captures settled content and paste.
  await nativePaste(paste, text);
  await expect(copy).toHaveAccessibleName(idle);
  await expect(activeToasts(await oneDefaultHost(page))).toHaveCount(0);
}
