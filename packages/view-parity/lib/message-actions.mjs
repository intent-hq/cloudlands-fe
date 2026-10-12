// DRAFT ONLY. Publication and native execution require separate coordinator release.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const blob = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committedHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const unchanged = [
  'src/lib/components/chat/MessageActions.svelte',
  'src/lib/components/chat/message-action-surface.ts',
  'src/lib/components/chat/message-action-day-clock.ts',
  'src/lib/components/chat/message-controls-mount-queue.ts',
  'src/lib/components/chat/lazy-turn-observer.ts',
  'src/lib/components/chat/QueuedMessageNoticeHeader.svelte',
  'src/lib/components/patterns/action-menu/ActionBar.svelte',
  'src/lib/components/patterns/action-menu/ActionMenu.svelte',
  'src/lib/components/patterns/action-menu/actions.ts',
  'src/lib/i18n/format.ts',
  'src/shared/i18n/formatters.ts',
];
const profile = [
  'apps/react/src/features/chat/components/message-actions.tsx',
  'apps/react/src/features/chat/components/queued-message-notice-header.tsx',
  'apps/react/src/components/patterns/action-menu/action-bar.tsx',
  'apps/react/src/components/patterns/action-menu/action-menu.tsx',
  'apps/react/src/catalog/message-action-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/styles/app.css',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
];
const runnerFiles = [
  'packages/view-parity/lib/message-actions.mjs',
  'packages/view-parity/tests/message-actions.core.spec.mjs',
  'packages/view-parity/tests/message-actions.extended.spec.mjs',
  'packages/view-parity/lib/functional.mjs',
  'packages/view-parity/lib/browser.mjs',
  'packages/view-parity/lib/provenance.mjs',
  'packages/view-parity/lib/manifest.mjs',
  'packages/view-parity/lib/agent-avatar.mjs',
  'packages/view-parity/lib/compare.mjs',
  'packages/view-parity/lib/chat-transcript.mjs',
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
export function label(key, params = {}) {
  if (typeof english[key] !== 'string') throw new Error(`Missing original message ${key}`);
  return english[key].replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in params)) throw new Error(`Missing original message parameter ${name}`);
    return String(params[name]);
  });
}

let dateOracleEvidence;

// Original module bodies are retained verbatim apart from type erasure and import URLs.
// The coordinator approved this pure oracle; it never imports the React candidate.
export async function originalFormats(info) {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Run the Node oracle under TZ=UTC').toBe(
    'UTC',
  );
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const file = 'src/shared/i18n/formatters.ts';
  const resolverFile = 'src/lib/components/chat/message-action-surface.ts';
  const source = blob(file);
  const resolverSource = blob(resolverFile);
  const packagePath = require.resolve('date-fns/package.json');
  const packageRoot = path.dirname(packagePath);
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  expect(blob('pnpm-lock.yaml')).toContain(`  date-fns@${packageJson.version}:`);
  const resolved = Object.fromEntries(
    ['date-fns', 'date-fns/locale'].map((name) => [
      name,
      path.resolve(
        packageRoot,
        packageJson.exports[name === 'date-fns' ? '.' : './locale'].import.default,
      ),
    ]),
  );
  const sourceModules = new Map([
    [file, stripTypeScriptTypes(source)],
    [resolverFile, stripTypeScriptTypes(resolverSource)],
  ]);
  const edges = [];
  const closure = new Map();
  const visit = (absolute) => {
    absolute = realpathSync(absolute);
    if (closure.has(absolute)) return;
    const relative = path.relative(realpathSync(packageRoot), absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error(`Oracle dependency escaped date-fns: ${absolute}`);
    const text = readFileSync(absolute, 'utf8');
    closure.set(absolute, digest(text));
    imports(absolute, text, (specifier) => {
      if (!specifier.startsWith('.')) throw new Error(`Unexpected date-fns import ${specifier}`);
      const next = path.resolve(path.dirname(absolute), specifier);
      edges.push({
        from: path.relative(repoRoot, absolute),
        specifier,
        to: path.relative(repoRoot, next),
      });
      visit(next);
    });
  };
  function imports(name, text, onImport) {
    const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const walk = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier))
          throw new Error(`Nonliteral oracle import in ${name}`);
        onImport(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]))
          throw new Error(`Unresolved oracle import in ${name}`);
        onImport(node.arguments[0].text);
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
  }
  for (const [name, program] of sourceModules)
    imports(name, program, (specifier) => {
      if (!(specifier in resolved))
        throw new Error(`Unexpected original oracle import ${specifier}`);
      edges.push({ from: name, specifier, to: path.relative(repoRoot, resolved[specifier]) });
      visit(resolved[specifier]);
    });
  for (const dependency of [
    packagePath,
    require.resolve('typescript'),
    require.resolve('typescript/package.json'),
  ])
    closure.set(realpathSync(dependency), digest(readFileSync(dependency)));
  const dependencyHashes = Object.fromEntries(
    [...closure]
      .map(([absolute, hash]) => [path.relative(repoRoot, absolute), hash])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  let program = stripTypeScriptTypes(source);
  for (const name of Object.keys(resolved)) {
    program = program.replaceAll(`'${name}'`, JSON.stringify(pathToFileURL(resolved[name]).href));
  }
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(program).toString('base64')}`
  );
  const resolverProgram = sourceModules.get(resolverFile);
  const resolver = await import(
    `data:text/javascript;base64,${Buffer.from(resolverProgram).toString('base64')}`
  );
  dateOracleEvidence = {
    original,
    file,
    sourceSha256: digest(source),
    programSha256: digest(program),
    resolverFile,
    resolverSourceSha256: digest(resolverSource),
    resolverProgramSha256: digest(resolverProgram),
    dependencyHashes,
    dependencyTreeSha256: digest(JSON.stringify(dependencyHashes)),
    edges,
    packageVersion: packageJson.version,
    nodeVersion: process.version,
    locale: 'en',
    timezone: 'UTC',
  };
  await info.attach('original-date-oracle.json', {
    body: JSON.stringify(dateOracleEvidence, null, 2),
    contentType: 'application/json',
  });
  expect(hashes(Object.keys(dependencyHashes))).toEqual(dependencyHashes);
  return {
    ...module.createFormatters(() => 'en'),
    resolveMessageActionDate: resolver.resolveMessageActionDate,
  };
}

export const test = base.extend({
  messageActionsFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_MESSAGE_ACTIONS_APPROVED,
        'Separate explicit native GO required',
      ).toBe('1');
      const sha = process.env.PARITY_MESSAGE_ACTIONS_SHA;
      const testSha = process.env.PARITY_MESSAGE_ACTIONS_TEST_SHA;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(info.retry, 'No retries authorized').toBe(0);
      const root = process.env.PARITY_CANDIDATE_ROOT;
      expect(realpathSync(root)).not.toBe(realpathSync(repoRoot));
      const candidate = candidateProvenance(root);
      expect(candidate.commit).toBe(sha);
      expect(candidate.sourceDirty).toBe(false);
      const before = hashes(runnerFiles);
      expect(before).toEqual(committedHashes(runnerFiles, testSha));
      const sourceBefore = hashes(unchanged);
      expect(sourceBefore).toEqual(committedHashes(unchanged));
      expect(hashes(unchanged, root)).toEqual(sourceBefore);
      const profileBefore = hashes(profile, root);
      expect(profileBefore).toEqual(committedHashes(profile, sha));
      const generatedBefore = hashes(generated, root);
      const candidateEnglish = JSON.parse(
        readFileSync(path.join(root, 'messages/en.json'), 'utf8'),
      );
      const keys = [
        ...new Set([...blob(unchanged[0]).matchAll(/m\.(\w+)\(/g)].map((match) => match[1])),
      ];
      for (const key of keys) expect(candidateEnglish[key]).toBe(english[key]);
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(unchanged);
        const candidateSourceAfter = hashes(unchanged, root);
        const profileAfter = hashes(profile, root);
        const generatedAfter = hashes(generated, root);
        const candidateAfter = candidateProvenance(root);
        const oracleDependenciesAfter =
          dateOracleEvidence && hashes(Object.keys(dateOracleEvidence.dependencyHashes));
        await info.attach('message-actions-freeze.json', {
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
              dateOracleEvidence,
              oracleDependenciesAfter,
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
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
        if (dateOracleEvidence)
          expect(oracleDependenciesAfter).toEqual(dateOracleEvidence.dependencyHashes);
      }
    },
    { auto: true },
  ],
  messageActionsNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('message-actions-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  messageActionsObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('message-actions-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="message-actions"] output')
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
  const host = await openExample(page, 'message-actions', 'message-actions');
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemon: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
      width: innerWidth,
      height: innerHeight,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    })),
  ).toEqual({
    preload: 'undefined',
    daemon: null,
    width: 420,
    height: 900,
    timezone: 'UTC',
    reduced: true,
  });
  await page.evaluate(() => document.fonts.ready);
  const frame = host.getByTestId('message-actions-frame');
  const item = {
    page,
    host,
    frame,
    parent: host.getByTestId('message-actions-parent'),
    viewport: host.getByTestId('message-actions-viewport'),
    surface: host.getByTestId('message-actions'),
    state: () =>
      outputJson(host.getByRole('status', { name: 'Message action inputs', exact: true })),
    observations: () =>
      outputJson(host.getByRole('status', { name: 'Message action observations', exact: true })),
  };
  await expect(item.surface.locator('[data-slot="action-bar"]')).toHaveCount(1);
  return item;
}
export const control = (item, name) => item.host.getByRole('button', { name, exact: true });
export const field = (item, name) => item.host.getByRole('textbox', { name, exact: true });
export const action = (item, id) => item.surface.locator(`[data-action-id="${id}"]`);
export async function choice(item, name, value) {
  const option = item.host
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  await option.click();
  await expect(option).toBeChecked();
}
export async function toggle(item, name, enabled) {
  const target = item.host.getByRole('switch', { name, exact: true });
  if ((await target.getAttribute('aria-checked')) !== String(enabled)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(enabled));
}
export async function refresh(item) {
  const previous = (await item.observations()).revision;
  await control(item, 'Refresh observations').click();
  await expect.poll(async () => (await item.observations()).revision).toBe(previous + 1);
  return item.observations();
}
export async function clear(item) {
  await control(item, 'Clear observations').click();
  await expect.poll(async () => (await item.observations()).callbacks).toEqual([]);
}
export async function inline(item, role = 'assistant') {
  await choice(item, 'Message role', role);
  await choice(item, 'Timestamp type', 'omit');
  await choice(item, 'Created at type', 'omit');
  await choice(item, 'Show on hover', 'false');
}
export async function expectOrder(item, expected) {
  await expect
    .poll(() =>
      item.surface
        .locator('[data-action-id]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action-id'))),
    )
    .toEqual(expected);
}
export async function tabTo(item, target) {
  await control(item, 'Focus message').click();
  for (let index = 0; index < 10; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await item.page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
export async function activate(item, target, name, args = [], via = 'click') {
  const state = await item.state();
  const before = await refresh(item);
  if (via === 'click') await target.click();
  else {
    await tabTo(item, target);
    await item.page.keyboard.press(via);
  }
  const after = await refresh(item);
  expect(after.callbacks).toHaveLength(before.callbacks.length + 1);
  const callback = after.callbacks.at(-1);
  expect(callback).toMatchObject({
    callback: name,
    args,
    argumentCount: args.length,
    callbackRevision: state.callbackRevision,
    mountRevision: state.mountRevision,
    capturedEvent: { type: 'click', isTrusted: true, button: 0, detail: via === 'click' ? 1 : 0 },
  });
  const id = callback.capturedEvent.objectId;
  const native = after.native.filter((event) => event.objectId === id && event.phase !== 'settled');
  expect(native.some((event) => event.phase === 'capture')).toBe(true);
  expect(native.some((event) => event.phase === 'bubble')).toBe(true);
  for (const event of native) expect(event).toMatchObject({ type: 'click', isTrusted: true });
  return callback;
}
export async function capture(item, name, info, target = item.frame) {
  return captureTranscript(item.page, target, name, info);
}
export async function geometry(item, name, info) {
  const probe = await item.frame.evaluate((root) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const parent = root.querySelector('[data-testid="message-actions-parent"]');
    const surface = root.querySelector('[data-testid="message-actions"]');
    const viewport = root.querySelector('[data-testid="message-actions-viewport"]');
    return {
      frame: rect(root),
      viewport: rect(viewport),
      windowWidth: innerWidth,
      root: viewport.hasAttribute('data-message-controls-root'),
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      parent: rect(parent),
      surface: surface && rect(surface),
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      actions: [...(surface?.querySelectorAll('button') ?? [])].map((node) => {
        const bounds = rect(node);
        const hit = document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        );
        return {
          id: node.getAttribute('data-action-id'),
          disabled: node.disabled,
          bounds,
          hit: node === hit || node.contains(hit),
        };
      }),
    };
  });
  await info.attach(`${name}-geometry.json`, {
    body: JSON.stringify(probe, null, 2),
    contentType: 'application/json',
  });
  return probe;
}
export async function expectContained(item, name, info) {
  await item.frame.scrollIntoViewIfNeeded();
  const probe = await geometry(item, name, info);
  expect(probe.frame.left).toBeGreaterThanOrEqual(0);
  expect(probe.frame.right).toBeLessThanOrEqual(probe.windowWidth);
  expect(probe.scrollWidth).toBeLessThanOrEqual(probe.clientWidth + 1);
  for (const entry of probe.actions) {
    expect(entry.bounds.width).toBeGreaterThan(0);
    expect(entry.bounds.height).toBeGreaterThan(0);
    expect(entry.bounds.left).toBeGreaterThanOrEqual(probe.surface.left - 1);
    expect(entry.bounds.right).toBeLessThanOrEqual(probe.surface.right + 1);
    expect(entry.hit, `Action ${entry.id} must be reachable`).toBe(true);
  }
  return probe;
}
export async function disconnected(handle) {
  await expect.poll(() => handle.evaluate((node) => node.isConnected)).toBe(false);
}
