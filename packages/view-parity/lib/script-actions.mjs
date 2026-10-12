// DRAFT ONLY: publication and native execution require separate coordinator releases.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const extracted = 'src/lib/components/chat/SetupScriptCard.svelte';
const timing = 'src/lib/motion/copy-feedback-timing.ts';
const unchanged = [
  'src/lib/components/chat/EditRegenerateConfirmDialog.svelte',
  'src/lib/components/modals/BulkActionConfirmDialog.svelte',
  'src/lib/components/patterns/confirm/DestructiveConfirm.svelte',
  'src/lib/components/patterns/confirm/FormDialog.svelte',
  'src/lib/components/ui/dialog/index.ts',
  'src/lib/components/ui/dialog/dialog-content.svelte',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/components/shared/icons/FaWrapper.svelte',
  'src/lib/components/shared/icons/fa-proxy.ts',
];
const profile = [
  extracted,
  timing,
  'apps/react/src/features/chat/components/setup-script-card.tsx',
  'apps/react/src/features/chat/components/edit-regenerate-confirm-dialog.tsx',
  'apps/react/src/catalog/script-action-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/components/modals/bulk-action-confirm-dialog.tsx',
  'apps/react/src/components/patterns/confirm/destructive-confirm.tsx',
  'apps/react/src/components/patterns/confirm/form-dialog.tsx',
  'apps/react/src/components/patterns/confirm/use-dialog-lifecycle.ts',
  'apps/react/src/components/ui/dialog.tsx',
  'apps/react/src/components/ui/dialog.css',
  'apps/react/src/components/ui/button.tsx',
  'apps/react/src/components/icons/icon-definition.tsx',
  'apps/react/src/styles/app.css',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
];
const runnerFiles = [
  'packages/view-parity/lib/script-actions.mjs',
  'packages/view-parity/tests/script-actions.core.spec.mjs',
  'packages/view-parity/tests/script-actions.extended.spec.mjs',
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
const generated = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const english = JSON.parse(blob('messages/en.json'));
export function label(key) {
  const value = english[key];
  if (typeof value !== 'string' || /\{\w+\}/.test(value))
    throw new Error(`Missing original unparameterized message ${key}`);
  return value;
}

// Source Vite resolves FontAwesome spelling through FaWrapper and Phosphor.
// Read immutable mappings and the original pinned Svelte artwork, never React icons.
const originalMapping = blob('src/lib/icons/phosphor-icons.ts');
const originalVite = blob('vite.config.mjs');
if (
  !originalVite.includes('src/lib/icons/phosphor-icons.ts') ||
  !originalVite.includes('src/lib/components/shared/icons/fa-proxy.ts')
)
  throw new Error('Original icon aliases could not be resolved');
const artwork = Object.fromEntries(
  ['faTerminal', 'faCopy', 'faCheck'].map((definition) => {
    const name = originalMapping.match(
      new RegExp('export const ' + definition + " = icon\\('([^']+)'\\)"),
    )?.[1];
    const table = originalMapping.split('const iconComponents:')[1].split('\n};')[0];
    const symbol = [...table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
      (entry) => (entry[1] || entry[2]) === name,
    )?.[3];
    if (!symbol) throw new Error(`Missing original mapping ${definition}`);
    const file = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    const body = source.split('weight === "regular"}')[1]?.split('{:')[0];
    if (!body) throw new Error(`Missing original regular artwork ${symbol}`);
    return [
      definition,
      {
        name,
        symbol,
        file,
        sha256: digest(source),
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + body + '</svg>',
      },
    ];
  }),
);
const iconPackage = 'node_modules/phosphor-svelte/package.json';
const iconVersion = JSON.parse(readFileSync(path.join(repoRoot, iconPackage), 'utf8')).version;
if (!blob('pnpm-lock.yaml').includes(`phosphor-svelte@${iconVersion}:`))
  throw new Error('Source icon dependency does not match original lock');
const iconFiles = [iconPackage, ...Object.values(artwork).map((entry) => entry.file)];
const iconHashes = hashes(iconFiles);

export const test = base.extend({
  scriptActionsFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_SCRIPT_ACTIONS_APPROVED, 'Separate native release required').toBe(
        '1',
      );
      const sha = process.env.PARITY_SCRIPT_ACTIONS_SHA;
      const testSha = process.env.PARITY_SCRIPT_ACTIONS_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retries authorized').toBe(0);
      expect(info.project.retries).toBe(0);
      expect(
        process.env.PARITY_SCRIPT_ACTIONS_CASE,
        'Release exactly one case per invocation',
      ).toBe(info.title.match(/^script actions ([SD][123]):/)?.[1]);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root)).not.toBe(realpathSync(repoRoot));
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = hashes(runnerFiles);
      expect(before).toEqual(committed(runnerFiles, testSha));
      const sourceBefore = hashes(unchanged);
      expect(sourceBefore).toEqual(committed(unchanged));
      expect(hashes(unchanged, root)).toEqual(sourceBefore);
      const profileBefore = hashes(profile, root);
      expect(profileBefore).toEqual(committed(profile, sha));
      const generatedBefore = hashes(generated, root);
      const currentSource = readFileSync(path.join(root, extracted), 'utf8');
      const reversed = currentSource
        .replace(
          "  import { COPY_FEEDBACK_RESET_MS } from '$lib/motion/copy-feedback-timing';\n",
          '',
        )
        .replace('}, COPY_FEEDBACK_RESET_MS);', '}, 2000);');
      expect(reversed, 'Only the authorized timing extraction may differ from original003').toBe(
        blob(extracted),
      );
      const timingSource = readFileSync(path.join(root, timing), 'utf8');
      expect(timingSource.match(/export const COPY_FEEDBACK_RESET_MS = (\d+);/)?.[1]).toBe('2000');
      const currentEnglish = JSON.parse(readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
      const keys = [
        'chat_shared_copy_label',
        'chat_shared_copied_label',
        'chat_setupScriptCard_useScript_label',
        'chat_editRegenerate_confirm_title',
        'chat_editRegenerate_confirm_description',
        'chat_editRegenerate_confirm_button',
        'modals_bulkActionConfirm_cancel_label',
        'ui_dialog_close_ariaLabel',
      ];
      for (const key of keys) expect(currentEnglish[key]).toBe(label(key));
      expect(hashes(iconFiles)).toEqual(iconHashes);
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(unchanged);
        const candidateSourceAfter = hashes(unchanged, root);
        const profileAfter = hashes(profile, root);
        const generatedAfter = hashes(generated, root);
        const candidateAfter = candidateProvenance(root);
        const iconsAfter = hashes(iconFiles);
        await info.attach('script-actions-freeze.json', {
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
              profileBefore,
              profileAfter,
              generatedBefore,
              generatedAfter,
              candidate,
              candidateAfter,
              originalSetupHash: digest(blob(extracted)),
              inverseExtractionHash: digest(reversed),
              iconVersion,
              iconHashes,
              iconsAfter,
              originalMappingHash: digest(originalMapping),
              originalViteHash: digest(originalVite),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(after).toEqual(before);
        expect(sourceAfter).toEqual(sourceBefore);
        expect(candidateSourceAfter).toEqual(sourceBefore);
        expect(profileAfter).toEqual(profileBefore);
        expect(generatedAfter).toEqual(generatedBefore);
        expect(iconsAfter).toEqual(iconHashes);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  scriptActionsNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('script-actions-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  scriptActionsObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('script-actions-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="script-actions"] output')
                .allTextContents(),
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
export { expect };

export async function openActions(page) {
  const host = await openExample(page, 'script-actions', 'script-actions');
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
  const script = host.getByRole('region', { name: 'Setup script exercise', exact: true });
  const edit = host.getByRole('region', { name: 'Edit confirmation exercise', exact: true });
  const frame = script.getByTestId('script-card-frame');
  return {
    page,
    host,
    script,
    edit,
    frame,
    card: frame.locator(':scope > div'),
    scriptState: () =>
      outputJson(script.getByRole('status', { name: 'Script inputs', exact: true })),
    uses: () =>
      outputJson(script.getByRole('status', { name: 'Script callback observations', exact: true })),
    pastes: () =>
      outputJson(script.getByRole('status', { name: 'Script paste observations', exact: true })),
    editState: () =>
      outputJson(edit.getByRole('status', { name: 'Edit confirmation inputs', exact: true })),
    edits: () =>
      outputJson(edit.getByRole('status', { name: 'Edit confirmation observations', exact: true })),
  };
}
export const control = (scope, name) => scope.getByRole('button', { name, exact: true });
export const field = (scope, name) => scope.getByRole('textbox', { name, exact: true });
export const copy = (item, copied = false) =>
  control(item.card, label(copied ? 'chat_shared_copied_label' : 'chat_shared_copy_label'));
export const useScript = (item) =>
  control(item.card, label('chat_setupScriptCard_useScript_label'));
export const dialog = (item) =>
  item.page.getByRole('dialog', { name: label('chat_editRegenerate_confirm_title'), exact: true });
export const opener = (item) => item.edit.getByTestId('edit-confirmation-open');
export async function toggle(scope, name, checked) {
  const input = scope.getByRole('switch', { name, exact: true });
  if ((await input.getAttribute('aria-checked')) !== String(checked)) await input.click();
  await expect(input).toHaveAttribute('aria-checked', String(checked));
}
export async function capture(item, name, info, target = item.frame) {
  return captureTranscript(item.page, target, name, info);
}
export async function sameNode(locator, originalNode) {
  expect(await locator.evaluate((node, old) => node === old, originalNode)).toBe(true);
}
export async function expectIcon(svg, definition, info) {
  const expected = artwork[definition];
  const observed = await svg.evaluate((node, source) => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    const shapes = (root) =>
      [...root.querySelectorAll('path, circle, ellipse, line, polyline, polygon, rect')]
        .filter((shape) => !(shape.localName === 'rect' && shape.getAttribute('fill') === 'none'))
        .map((shape) => ({
          tag: shape.localName,
          attributes: Object.fromEntries(
            [...shape.attributes]
              .map((attribute) => [attribute.name, attribute.value])
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        }));
    return {
      actual: shapes(node),
      expected: shapes(document),
      parseError: !!document.querySelector('parsererror'),
      viewBox: node.getAttribute('viewBox'),
      hidden: node.getAttribute('aria-hidden'),
    };
  }, expected.svg);
  await info.attach(`source-icon-${definition}.json`, {
    body: JSON.stringify({ original, ...expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe('0 0 256 256');
  expect(observed.hidden).toBe('true');
}
export async function reachable(item, target, name, info) {
  await target.scrollIntoViewIfNeeded();
  const probe = await target.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      root: rect(root),
      viewport: { width: innerWidth, height: innerHeight },
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      buttons: [...root.querySelectorAll('button')].map((node) => {
        const bounds = rect(node);
        const hit = document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        );
        return {
          name: node.getAttribute('aria-label') ?? node.textContent,
          bounds,
          reachable: hit === node || node.contains(hit),
        };
      }),
      code: [...root.querySelectorAll('pre')].map((node) => ({
        bounds: rect(node),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      })),
    };
  });
  await info.attach(`${name}-geometry.json`, {
    body: JSON.stringify(probe, null, 2),
    contentType: 'application/json',
  });
  expect(probe.root.left).toBeGreaterThanOrEqual(0);
  expect(probe.root.right).toBeLessThanOrEqual(probe.viewport.width);
  expect(probe.scrollWidth).toBeLessThanOrEqual(probe.clientWidth + 1);
  for (const button of probe.buttons) {
    expect(button.bounds.width).toBeGreaterThan(0);
    expect(button.bounds.height).toBeGreaterThan(0);
    expect(button.reachable, `Control ${button.name} remains reachable`).toBe(true);
  }
  return probe;
}
export async function pasteCurrent(item, expected) {
  const target = item.script.getByTestId('script-paste');
  const count = (await item.pastes()).count;
  await target.fill('');
  await target.click();
  await item.page.keyboard.press('Control+V');
  await expect(target).toHaveValue(expected);
  await expect.poll(async () => (await item.pastes()).count).toBe(count + 1);
  const record = (await item.pastes()).records.at(-1);
  expect(record).toMatchObject({ type: 'paste', isTrusted: true, text: expected });
  expect(record.types).toContain('text/plain');
}
export async function grantScriptClipboard(page, context, info) {
  const origin = new URL(process.env.PARITY_CANDIDATE_URL).origin;
  const observePermissions = async (phase) => {
    const observation = await page.evaluate(async () => {
      const permissions = Object.fromEntries(
        await Promise.all(
          ['clipboard-read', 'clipboard-write'].map(async (name) => [
            name,
            (await navigator.permissions.query({ name })).state,
          ]),
        ),
      );
      return {
        origin: location.origin,
        secureContext: isSecureContext,
        documentFocused: document.hasFocus(),
        userActivation: {
          isActive: navigator.userActivation.isActive,
          hasBeenActive: navigator.userActivation.hasBeenActive,
        },
        permissions,
      };
    });
    await info.attach(`clipboard-permissions-${phase}.json`, {
      body: JSON.stringify(
        {
          phase,
          grantOrigin: origin,
          observedAt: 'query time, not click-time activation',
          ...observation,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  };
  await observePermissions('before-grant');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await observePermissions('after-grant');
}
export async function tabToScript(item, target) {
  await field(item.script, 'Script content').click();
  for (let step = 0; step < 12; step += 1) {
    await item.page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}
export async function openDialog(item, key) {
  if (key) {
    await control(item.edit, 'Reset parent open').click();
    await item.page.keyboard.press('Tab');
    await expect(opener(item)).toBeFocused();
    await item.page.keyboard.press(key);
  } else await opener(item).click();
  await expect(dialog(item)).toBeVisible();
  await expect(control(dialog(item), label('chat_editRegenerate_confirm_button'))).toBeFocused();
  expect(
    await dialog(item).evaluate(
      (node) => !!node.closest('[data-functional-example="script-actions"]'),
    ),
  ).toBe(false);
}
export async function expectClosed(item) {
  await expect(dialog(item)).toHaveCount(0);
  await expect(opener(item)).toBeFocused();
}
export async function expectEdit(item, callback, before, state) {
  await expect
    .poll(async () => (await item.edits()).records.length)
    .toBe(before.records.length + 1);
  const after = await item.edits();
  expect(after.confirmCount).toBe(before.confirmCount + Number(callback === 'onConfirm'));
  expect(after.cancelCount).toBe(before.cancelCount + Number(callback === 'onCancel'));
  expect(after.records.at(-1)).toEqual({
    callback,
    args: [],
    argumentCount: 0,
    callbackRevision: state.callbackRevision,
    mountRevision: state.mountRevision,
    parentOpen: true,
    closeParent: state.closeParent,
  });
}
