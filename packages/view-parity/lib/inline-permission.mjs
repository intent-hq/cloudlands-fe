import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';
import { captureTranscript } from './chat-transcript.mjs';

// Native display and empty-admission checks only. No actual permission outcome,
// live recovery, hydration, full-motion or source-pixel acceptance. Independent
// expected values come from original003; never import the candidate parser.
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const componentSource = 'src/lib/components/chat/InlinePermissionRequest.svelte';
const categoryHelper = 'src/lib/components/chat/permission-category-classes.ts';
const unchangedSources = [
  'src/lib/components/chat/permission-parser.ts',
  'src/lib/components/chat/permission-shortcut.ts',
  'src/lib/components/ui/button/button.svelte',
  'src/lib/components/shared/icons/FaWrapper.svelte',
];
const extractedDependencies = [
  componentSource,
  categoryHelper,
  'src/lib/styles/tokens.css',
  'apps/react/src/styles/app.css',
  'apps/react/src/features/chat/components/inline-permission-request.tsx',
  'apps/react/src/catalog/inline-permission-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/store/provider-runtime.ts',
  'apps/react/src/features/permission/permission-client.ts',
  'src/lib/client/live/backend-permission-client.ts',
  'src/lib/icons/icon-definition.ts',
  'src/lib/icons/phosphor-icon-definitions.ts',
  'src/lib/icons/phosphor-icon-mapping.ts',
  'messages/en.json',
];
const generatedDependencies = [
  'src/shared/paraglide/messages.js',
  'src/shared/paraglide/runtime.js',
  'src/shared/paraglide/messages/_index.js',
  ...['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'].map(
    (locale) => `src/shared/paraglide/messages/${locale}.js`,
  ),
];
const ownFiles = [
  'packages/view-parity/lib/inline-permission.mjs',
  'packages/view-parity/tests/inline-permission.core.spec.mjs',
  'packages/view-parity/tests/inline-permission.extended.spec.mjs',
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
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const committed = (file, sha = original) =>
  execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const committedHashes = (files, sha = original) =>
  Object.fromEntries(files.map((file) => [file, digest(committed(file, sha))]));

// Read expected localized contracts and icon definitions from immutable003,
// never from the candidate component or its presentation projection.
const english = JSON.parse(committed('messages/en.json'));
const headerSource = committed(componentSource);
const parserSource = committed(unchangedSources[0]);
const messageKeys = [
  ...new Set([...(headerSource + parserSource).matchAll(/m\.(\w+)\(/g)].map((x) => x[1])),
];
export const label = (key, args = {}) => {
  const value = english[key];
  if (typeof value !== 'string') throw new Error(`Missing original message ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in args)) throw new Error(`Missing original message argument ${name}`);
    return String(args[name]);
  });
};
const originalMapping = committed('src/lib/icons/phosphor-icons.ts');
const originalVite = committed('vite.config.mjs');
if (
  !originalVite.includes('src/lib/icons/phosphor-icons.ts') ||
  !originalVite.includes('src/lib/components/shared/icons/fa-proxy.ts')
)
  throw new Error('Original icon aliases changed');
const artwork = Object.fromEntries(
  ['faShieldHalved', 'faChevronDown', 'faChevronLeft'].map((definition) => {
    // original faShieldHalved aliases through faShieldAlt before icon().
    let binding = definition;
    const visited = new Set();
    let name;
    while (!name) {
      if (visited.has(binding)) throw new Error(`Cyclic original icon alias ${definition}`);
      visited.add(binding);
      const expression = originalMapping.match(
        new RegExp('export const ' + binding + ' = ([^;]+);'),
      )?.[1];
      if (!expression) throw new Error(`Missing original icon binding ${binding}`);
      name = expression.match(/^icon\('([^']+)'\)$/)?.[1];
      if (!name) binding = expression;
    }
    const table = originalMapping.split('const iconComponents:')[1].split('\n};')[0];
    const symbol = [...table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*(\w+Icon),?$/gm)].find(
      (entry) => (entry[1] || entry[2]) === name,
    )?.[3];
    if (!symbol) throw new Error(`Missing original icon mapping ${definition}`);
    const file = `node_modules/phosphor-svelte/lib/${symbol}.svelte`;
    const bytes = readFileSync(path.join(repoRoot, file), 'utf8');
    const body = bytes.split('weight === "regular"}')[1]?.split('{:')[0];
    if (!body) throw new Error(`Missing original regular icon artwork ${symbol}`);
    return [
      definition,
      {
        definition,
        name,
        symbol,
        file,
        sha256: digest(bytes),
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + body + '</svg>',
      },
    ];
  }),
);
const iconPackage = 'node_modules/phosphor-svelte/package.json';
const iconVersion = JSON.parse(readFileSync(path.join(repoRoot, iconPackage), 'utf8')).version;
if (!committed('pnpm-lock.yaml').includes('phosphor-svelte@' + iconVersion + ':'))
  throw new Error('Local icon version differs from original lock');
const iconFiles = [iconPackage, ...Object.values(artwork).map((item) => item.file)];
const iconHashes = hashes(iconFiles);

const helperBlock = headerSource.match(
  /  function getCategoryColor\(category: string\): string \{[\s\S]*?\n  \}\n\n/,
)?.[0];
if (!helperBlock) throw new Error('Original category helper boundary is missing');
const originalHelper =
  'export ' +
  helperBlock
    .trimEnd()
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n') +
  '\n';
const categoryAliases = {
  'red-500': 'permission-delete',
  'emerald-500': 'permission-execute',
  'blue-500': 'permission-read',
  'violet-500': 'permission-other',
};
let profiledHelper = originalHelper;
for (const [old, semantic] of Object.entries(categoryAliases))
  profiledHelper = profiledHelper.replaceAll(old, semantic);
const profiledSource = headerSource
  .replace(helperBlock, '')
  .replace(
    "  import { shouldHandlePermissionShortcut } from './permission-shortcut';",
    "  import { shouldHandlePermissionShortcut } from './permission-shortcut';\n  import { getCategoryColor } from './permission-category-classes';",
  );
function checkSourceProfile(root) {
  const read = (file) => readFileSync(path.join(root, file), 'utf8');
  expect(
    read(componentSource),
    'Only the approved helper extraction may change original markup',
  ).toBe(profiledSource);
  expect(
    read(categoryHelper),
    'Only four reviewed semantic substitutions may change the helper',
  ).toBe(profiledHelper);
  for (const [old, semantic] of Object.entries(categoryAliases))
    expect(read('src/lib/styles/tokens.css')).toContain(
      `--color-${semantic}: var(--color-${old});`,
    );
  expect(read('apps/react/src/styles/app.css')).toContain(
    "@source '../../../../src/lib/components/chat/permission-category-classes.ts';",
  );
  return {
    name: 'inline-permission-category-semantic-aliases-v2',
    originalSourceSha256: digest(headerSource),
    originalHelperSha256: digest(originalHelper),
    profiledSourceSha256: digest(profiledSource),
    profiledHelperSha256: digest(profiledHelper),
    categoryAliases,
    runtimeColorEqualityVerified: false,
  };
}

export const test = base.extend({
  permissionFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(
        process.env.PARITY_INLINE_PERMISSION_APPROVED,
        'Explicit runtime release required',
      ).toBe('1');
      const sha = process.env.PARITY_INLINE_PERMISSION_SHA;
      const testSha = process.env.PARITY_INLINE_PERMISSION_TEST_SHA;
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
      const before = hashes(runnerFiles);
      expect(before, 'The runner must match the reviewed test freeze').toEqual(
        committedHashes(runnerFiles, testSha),
      );
      expect(hashes(iconFiles)).toEqual(iconHashes);
      const sourceBefore = hashes(unchangedSources);
      expect(sourceBefore).toEqual(committedHashes(unchangedSources));
      expect(hashes(unchangedSources, root)).toEqual(sourceBefore);
      const extractedBefore = hashes(extractedDependencies, root);
      expect(extractedBefore).toEqual(committedHashes(extractedDependencies, sha));
      const generatedBefore = hashes(generatedDependencies, root);
      const sourceProfile = checkSourceProfile(root);
      const currentEnglish = JSON.parse(readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
      for (const key of messageKeys)
        expect(currentEnglish[key], `Original localized contract changed: ${key}`).toBe(
          english[key],
        );
      try {
        await use();
      } finally {
        const after = hashes(runnerFiles);
        const sourceAfter = hashes(unchangedSources);
        const candidateSourceAfter = hashes(unchangedSources, root);
        const extractedAfter = hashes(extractedDependencies, root);
        const generatedAfter = hashes(generatedDependencies, root);
        const candidateAfter = candidateProvenance(root);
        await info.attach('inline-permission-freeze.json', {
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
              extractedBefore,
              extractedAfter,
              generatedBefore,
              generatedAfter,
              candidate,
              candidateAfter,
              sourceProfile,
              selectedOriginalMessages: Object.fromEntries(
                messageKeys.map((key) => [key, english[key]]),
              ),
              messageKeys,
              iconVersion,
              iconHashes,
              artwork,
              originalMappingSha256: digest(originalMapping),
              originalViteSha256: digest(originalVite),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(checkSourceProfile(root)).toEqual(sourceProfile);
        expect(hashes(iconFiles)).toEqual(iconHashes);
        expect(after).toEqual(before);
        expect(sourceAfter).toEqual(sourceBefore);
        expect(candidateSourceAfter).toEqual(sourceBefore);
        expect(extractedAfter).toEqual(extractedBefore);
        expect(generatedAfter).toEqual(generatedBefore);
        expect(candidateAfter.commit).toBe(sha);
        expect(candidateAfter.sourceDirty).toBe(false);
        expect(candidateAfter.sourceTreeSha256).toBe(candidate.sourceTreeSha256);
      }
    },
    { auto: true },
  ],
  permissionNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('inline-permission-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
  permissionObservations: [
    async ({ page }, use, info) => {
      try {
        await use();
      } finally {
        if (!page.isClosed())
          await info.attach('inline-permission-observations.json', {
            body: JSON.stringify(
              await page
                .locator('[data-functional-example="inline-permission"] pre')
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

export async function openPermission(page) {
  const host = await openExample(page, 'inline-permission', 'inline-permission');
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
    reduced: true,
    dark: false,
  });
  await page.evaluate(() => document.fonts.ready);
  const frame = host.getByTestId('inline-permission-frame');
  const card = frame.locator(':scope > div');
  await expect(card).toHaveCount(1);
  return {
    page,
    host,
    frame,
    card,
    state: () => outputJson(host.getByTestId('permission-state')),
  };
}

const passiveObserverSource =
  '// PROPOSAL ONLY. Do not evaluate in a browser before coordinator approval.\n// The final owned inline-permission helper may retain this exact function source.\n// Use a single evaluateHandle for one case; always call dispose, then dispose the\n// JSHandle, in finally. No global properties, synthetic events or product writes.\nexport function observeNativePermissionKeys() {\n  const records = [];\n  const identity = new WeakMap();\n  const lifetime = [{ operation: "install", order: 1 }];\n  let sequence = 0;\n  let disposed = false;\n\n  function snapshot(event) {\n    const target = event.target;\n    return {\n      type: event.type,\n      key: event.key,\n      code: event.code,\n      isTrusted: event.isTrusted,\n      defaultPrevented: event.defaultPrevented,\n      ctrlKey: event.ctrlKey,\n      metaKey: event.metaKey,\n      altKey: event.altKey,\n      shiftKey: event.shiftKey,\n      target:\n        target instanceof Element\n          ? {\n              tag: target.localName,\n              testId: target.getAttribute("data-testid"),\n              editable:\n                target instanceof HTMLElement &&\n                (target.isContentEditable || target.contentEditable === "true"),\n              editableAncestor: Boolean(\n                target.closest(\n                  \'input, textarea, select, [contenteditable]:not([contenteditable="false"])\',\n                ),\n              ),\n            }\n          : null,\n    };\n  }\n\n  function capture(event) {\n    const record = { sequence: ++sequence, capture: snapshot(event), tail: null };\n    identity.set(event, record);\n    records.push(record);\n  }\n\n  function tail(event) {\n    const record = identity.get(event);\n    if (record) record.tail = snapshot(event);\n  }\n\n  document.addEventListener("keydown", capture, { capture: true, passive: true });\n  window.addEventListener("keydown", tail, { passive: true });\n\n  return {\n    // Run after a known component commit so this observer follows its current\n    // window listener. This changes only the probe\'s own listener registration.\n    armTail() {\n      if (disposed) throw new Error("Cannot rearm a disposed native-key observer");\n      window.removeEventListener("keydown", tail);\n      window.addEventListener("keydown", tail, { passive: true });\n      lifetime.push({ operation: "arm-tail", order: lifetime.length + 1 });\n    },\n    drain() {\n      return records.splice(0);\n    },\n    lifecycle() {\n      return lifetime.slice();\n    },\n    dispose() {\n      if (disposed) return;\n      document.removeEventListener("keydown", capture, true);\n      window.removeEventListener("keydown", tail);\n      disposed = true;\n      lifetime.push({ operation: "dispose", order: lifetime.length + 1 });\n    },\n  };\n}\n';
const approvedObserverSha256 = 'ad392eb7fc56eaceb8e067b2a88ce677bb23b0d34b351caef2cb88dc3b2dcd7a';

export const field = (item, name) => item.host.getByTestId(`permission-${name}`);
export const disclosure = (item, expanded = false) =>
  item.card.getByRole('button', {
    name: label(
      expanded
        ? 'chat_inlinePermission_hideRawDetails_label'
        : 'chat_inlinePermission_showRawDetails_label',
    ),
    exact: true,
  });
export async function apply(item, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    if (name === 'descriptionMode') await field(item, `description-mode-${value}`).click();
    else await field(item, name).fill(name === 'options' ? JSON.stringify(value) : String(value));
  }
  const before = (await item.state()).inputRevision;
  await field(item, 'apply').click();
  await expect.poll(async () => (await item.state()).inputRevision).toBe(before + 1);
  await expect(field(item, 'input-error')).toHaveCount(0);
}
export async function setSwitch(item, name, value) {
  const target = field(item, name);
  if ((await target.getAttribute('aria-checked')) !== String(value)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(value));
}
export async function expectQuestion(item, text) {
  const header = item.card.locator(':scope > div').first();
  await expect(header.getByText(text, { exact: true })).toHaveCount(1);
}
export async function expectDetails(item, text) {
  const content = item.card.locator(':scope > div').nth(1);
  // Check the actual visible friendly detail, never the caller's JSON echo.
  if (text !== null) await expect(content.getByText(text, { exact: true })).toHaveCount(1);
  else {
    const texts = await content
      .locator(':scope > div')
      .evaluateAll((nodes) =>
        nodes.filter((node) => !node.querySelector('button')).map((node) => node.textContent),
      );
    expect(
      texts.filter((value) => value && value !== label('chat_inlinePermission_keyboardHint_label')),
    ).toEqual([]);
  }
}
export async function sameNode(current, old) {
  expect(await current.evaluate((node, previous) => node === previous, old)).toBe(true);
}
export async function detached(old) {
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
}
export async function capturePermission(page, item, name, info) {
  await item.frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = () =>
    item.frame.evaluate((root) => {
      const bounds = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        root: bounds(root),
        nodes: [...root.querySelectorAll('div,button,kbd,svg')].map((node) => ({
          tag: node.localName,
          text: node.textContent,
          bounds: bounds(node),
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          scrollTop: node.scrollTop,
          scrollLeft: node.scrollLeft,
        })),
      };
    });
  const before = { geometry: await geometry(), ax: await item.frame.ariaSnapshot() };
  await captureTranscript(page, item.frame, name, info);
  const after = { geometry: await geometry(), ax: await item.frame.ariaSnapshot() };
  await info.attach(`${name}-permission-geometry-ax.json`, {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capture must preserve observed geometry, scrolling and accessibility').toEqual(
    before,
  );
}
export async function expectArtwork(svg, definition, info) {
  const expected = artwork[definition];
  await expect(svg).toHaveCount(1);
  const observed = await svg.evaluate((node, source) => {
    const tree = new DOMParser().parseFromString(source, 'image/svg+xml');
    const shapes = (root) =>
      [...root.querySelectorAll('path,circle,ellipse,line,polyline,polygon,rect')]
        .filter((shape) => !(shape.localName === 'rect' && shape.getAttribute('fill') === 'none'))
        .map((shape) => ({
          tag: shape.localName,
          attributes: Object.fromEntries(
            [...shape.attributes]
              .map((a) => [a.name, a.value])
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        }));
    return {
      actual: shapes(node),
      expected: shapes(tree),
      viewBox: node.getAttribute('viewBox'),
      expectedViewBox: tree.documentElement.getAttribute('viewBox'),
      hidden: node.getAttribute('aria-hidden'),
      parseError: !!tree.querySelector('parsererror'),
    };
  }, expected.svg);
  await info.attach(`artwork-${definition}.json`, {
    body: JSON.stringify({ original, expected, observed }, null, 2),
    contentType: 'application/json',
  });
  expect(observed.parseError).toBe(false);
  expect(observed.expected.length).toBeGreaterThan(0);
  expect(observed.actual).toEqual(observed.expected);
  expect(observed.viewBox).toBe(observed.expectedViewBox);
  expect(observed.hidden).toBe('true');
  expect(digest(readFileSync(path.join(repoRoot, expected.file)))).toBe(expected.sha256);
}

export async function withNativeKeys(page, info, run) {
  expect(digest(passiveObserverSource)).toBe(approvedObserverSha256);
  await info.attach('native-key-observer.mjs', {
    body: passiveObserverSource,
    contentType: 'text/javascript',
  });
  // The approved script owns only a retained local closure. No browser globals.
  const script = `(() => { ${passiveObserverSource.replace('export function', 'function')}\n return observeNativePermissionKeys(); })()`;
  const handle = await page.evaluateHandle(script);
  const journal = [];
  let lifecycle;
  try {
    await run({
      async press(target, key, expectedKey, prevented, extra = {}) {
        const pending = await handle.evaluate((probe) => probe.drain());
        if (pending.length) journal.push({ stage: 'other-real-events', records: pending });
        await handle.evaluate((probe) => probe.armTail());
        await target.press(key);
        const records = await handle.evaluate((probe) => probe.drain());
        journal.push({ stage: 'press', key, expectedKey, prevented, records });
        const matching = records.filter((record) => record.capture.key === expectedKey);
        expect(matching, `One real ${expectedKey} keydown must reach the observers`).toHaveLength(
          1,
        );
        const event = matching[0];
        expect(event.capture).toMatchObject({ isTrusted: true, ...extra });
        expect(event.tail, 'The real event must reach the final window observer').toMatchObject({
          isTrusted: true,
          key: expectedKey,
          defaultPrevented: prevented,
          ...extra,
        });
        return event;
      },
    });
  } finally {
    try {
      const pending = await handle.evaluate((probe) => probe.drain());
      if (pending.length) journal.push({ stage: 'remaining-real-events', records: pending });
      lifecycle = await handle.evaluate((probe) => {
        probe.dispose();
        return probe.lifecycle();
      });
    } finally {
      await handle.dispose();
      await info.attach('native-key-observations.json', {
        body: JSON.stringify(
          { observerSha256: approvedObserverSha256, journal, lifecycle },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    }
    expect(lifecycle[0]).toMatchObject({ operation: 'install' });
    expect(lifecycle.at(-1)).toMatchObject({ operation: 'dispose' });
  }
}

export async function expectControlContained(item, target, info, name) {
  await target.scrollIntoViewIfNeeded();
  const frame = await item.frame.elementHandle();
  try {
    const result = await target.evaluate((node, outer) => {
      const bounds = (element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const box = bounds(node);
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return {
        box,
        frame: bounds(outer),
        viewport: innerWidth,
        hit: node === hit || node.contains(hit),
        frameClientWidth: outer.clientWidth,
        frameScrollWidth: outer.scrollWidth,
      };
    }, frame);
    await info.attach(`${name}-containment.json`, {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    expect(result.frame.left).toBeGreaterThanOrEqual(0);
    expect(result.frame.right).toBeLessThanOrEqual(result.viewport);
    expect(result.frameScrollWidth).toBeLessThanOrEqual(result.frameClientWidth);
    expect(result.box.left).toBeGreaterThanOrEqual(result.frame.left);
    expect(result.box.right).toBeLessThanOrEqual(result.frame.right);
    expect(result.box.width).toBeGreaterThan(0);
    expect(result.box.height).toBeGreaterThan(0);
    expect(result.hit, 'Actual button must be reachable and unobscured').toBe(true);
  } finally {
    await frame.dispose();
  }
}
