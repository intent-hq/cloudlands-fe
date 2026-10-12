// Ignored executable draft. Import paths intentionally target future maintained
// placement; do not import/discover here. Publication and native GO are separate.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { candidateProvenance } from './provenance.mjs';
import { stableLocatorScreenshot } from './browser.mjs';
import { observeAvatarPairNetwork, assertAvatarPairNetwork } from './agent-avatar.mjs';

export { expect, outputJson };
const original = '003bc52c00dcfffe8513cd6be1b8f45011716714';
const sourcePort = '8a05278b842cc4dd80c0d0913c576208e17eabb9';
// Intentional shared canonical correction; all other source-port files stay pinned.
const sourceCorrection = {
  commit: 'd47f4dc54d23956becbc898f6d61e490a385075a',
  file: 'src/lib/components/chat/operational-panel-core.ts',
  sha256: '18e4e0ce6e67b7c9311027579de1307c21581d1fbf4cf02b72f3ad52f4f11c2c',
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (file, sha) => execFileSync('git', ['show', `${sha}:${file}`], { cwd: repoRoot });
const hashes = (files, root = repoRoot) =>
  Object.fromEntries(files.map((file) => [file, digest(readFileSync(path.join(root, file)))]));
const blobHashes = (files, sha) =>
  Object.fromEntries(files.map((file) => [file, digest(blob(file, sha))]));
const unchanged = [
  'src/lib/components/chat/operational-row-window.ts',
  'src/lib/utils/layout-phases.ts',
  'src/lib/components/chat/OperationalWindow.svelte',
  'src/lib/components/chat/operational-window-items.ts',
  'src/lib/components/chat/MessageContent.svelte',
  'src/lib/components/chat/StreamingMessageContent.svelte',
  'src/lib/components/chat/ChatPanel.svelte',
];
const sourceFiles = [
  'src/lib/components/chat/operational-panel.svelte.ts',
  'src/lib/components/chat/operational-panel-core.ts',
  'apps/react/src/features/chat/components/operational-panel.tsx',
  'apps/react/src/features/chat/components/operational-window.tsx',
];
const profile = [
  ...sourceFiles,
  'apps/react/src/catalog/operational-window-examples.tsx',
  'apps/react/src/catalog/functional-examples.tsx',
  'apps/react/src/client.tsx',
  'apps/react/src/catalog/catalog-shell.tsx',
  'apps/react/src/catalog/catalog-shell.css',
];
const runnerFiles = [
  'packages/view-parity/lib/operational-window.mjs',
  'packages/view-parity/tests/operational-window.core.spec.mjs',
  'packages/view-parity/tests/operational-window.extended.spec.mjs',
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

export const test = base.extend({
  operationalFreeze: [
    async ({ browserName }, use, info) => {
      expect(browserName).toBe('chromium');
      expect(process.env.PARITY_OPERATIONAL_APPROVED, 'Exact coordinator native GO required').toBe(
        '1',
      );
      const sha = process.env.PARITY_OPERATIONAL_SHA;
      const testSha = process.env.PARITY_OPERATIONAL_TEST_SHA;
      const caseId = process.env.PARITY_OPERATIONAL_CASE;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(testSha).toMatch(/^[a-f0-9]{40}$/);
      expect(caseId).toMatch(/^OW(?:[1-9]|10)$/);
      expect(info.title.startsWith(`operational-window ${caseId} `)).toBe(true);
      expect(
        process.env.PARITY_GREP,
        'Select exactly one case; review every PNG before the next',
      ).toBe(`operational-window ${caseId} `);
      expect(
        JSON.parse(readFileSync(path.join(process.env.PARITY_RUN_DIR, 'session.json'), 'utf8'))
          .grep,
      ).toBe(`operational-window ${caseId} `);
      expect(info.retry).toBe(0);
      expect(info.project.retries).toBe(0);
      expect(info.config.workers).toBe(1);
      const root = realpathSync(process.env.PARITY_CANDIDATE_ROOT);
      expect(root).not.toBe(realpathSync(repoRoot));
      const read = () => ({
        runner: hashes(runnerFiles),
        unchanged: hashes(unchanged, root),
        source: hashes(sourceFiles, root),
        profile: hashes(profile, root),
        generated: hashes(generated, root),
        candidate: candidateProvenance(root),
      });
      const before = read();
      expect(before.runner).toEqual(blobHashes(runnerFiles, testSha));
      expect(before.unchanged).toEqual(blobHashes(unchanged, original));
      const expectedSource = blobHashes(sourceFiles, sourcePort);
      expect(digest(blob(sourceCorrection.file, sourceCorrection.commit))).toBe(
        sourceCorrection.sha256,
      );
      expectedSource[sourceCorrection.file] = sourceCorrection.sha256;
      expect(before.source).toEqual(expectedSource);
      expect(before.profile).toEqual(blobHashes(profile, sha));
      expect(before.candidate.commit).toBe(sha);
      expect(before.candidate.dirty).toBe(false);
      expect(before.candidate.sourceDirty).toBe(false);
      try {
        await use();
      } finally {
        const after = read();
        await info.attach('operational-freeze.json', {
          body: JSON.stringify(
            { original, sourcePort, sourceCorrection, sha, testSha, caseId, root, before, after },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        expect(
          after,
          'Any source, test, generated or candidate drift invalidates this case',
        ).toEqual(before);
      }
    },
    { auto: true },
  ],
  operationalNetwork: [
    async ({ page }, use, info) => {
      const network = observeAvatarPairNetwork(page);
      try {
        await use();
      } finally {
        await info.attach('operational-network.json', {
          body: JSON.stringify(network, null, 2),
          contentType: 'application/json',
        });
        assertAvatarPairNetwork(network, process.env.PARITY_CANDIDATE_URL);
      }
    },
    { auto: true },
  ],
});

export function panel(host, independent = false) {
  const region = host.getByRole('region', {
    name: independent ? 'Independent operational panel' : 'Primary operational panel',
    exact: true,
  });
  return {
    region,
    scroll: region.getByTestId('operational-panel-scroll'),
    windows: region.locator('[data-operational-window]'),
    rows: region.locator('[data-caller-row-key]'),
    snapshot: region.getByLabel('Operational panel snapshot', { exact: true }),
    observations: region.getByLabel('Operational row observations', { exact: true }),
    inner: (index) => region.getByTestId(`operational-scroll-${index}`),
  };
}
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export async function choice(host, name, value) {
  const target = host
    .getByRole('radiogroup', { name, exact: true })
    .getByRole('radio', { name: value, exact: true });
  if ((await target.getAttribute('aria-checked')) !== 'true') await target.click();
  await expect(target).toHaveAttribute('aria-checked', 'true');
}
export async function toggle(host, name, checked) {
  const target = host.getByRole('switch', { name, exact: true });
  if ((await target.getAttribute('aria-checked')) !== String(checked)) await target.click();
  await expect(target).toHaveAttribute('aria-checked', String(checked));
}
export async function openOperational(page) {
  const host = await openExample(page, 'operational-window', 'operational-window');
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      preload: typeof window.electronAPI,
      daemonUrl: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
    })),
  ).toEqual({
    width: 420,
    height: 900,
    reduced: true,
    dark: false,
    preload: 'undefined',
    daemonUrl: null,
  });
  await page.evaluate(() => document.fonts.ready);
  return { host, primary: panel(host), independent: panel(host, true) };
}
export const rowByLabel = (item, label) =>
  item.rows.filter({
    has: item.region.page().getByRole('button', { name: `Observe ${label}`, exact: true }),
  });
export async function focusScroll(scroll) {
  // The real scrollport is a focusable public control. Clicking its edge leaves
  // descendant row controls alone; normal Playwright input may reveal the target.
  await scroll.click({ position: { x: 1, y: 1 } });
  await expect(scroll).toBeFocused();
}
export async function pageDownAndWaitForScrollEnd(page, scroll, info) {
  const observation = await scroll.evaluateHandle((node) => {
    const describe = (target) =>
      target instanceof Element
        ? {
            tag: target.localName,
            testId: target.getAttribute('data-testid'),
            role: target.getAttribute('role'),
            label: target.getAttribute('aria-label'),
          }
        : null;
    const measure = () => ({
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    });
    const armed = { at: performance.now(), target: describe(node), ...measure() };
    const events = [];
    let pageDownSeen = false;
    const onEvent = (event) => {
      if (event.type === 'keydown' && event.key !== 'PageDown') return;
      if (
        event.type === 'keydown' &&
        event.isTrusted &&
        event.target === node &&
        event.currentTarget === node
      )
        pageDownSeen = true;
      events.push({
        type: event.type,
        key: event.type === 'keydown' ? event.key : null,
        afterPageDown: event.type === 'scrollend' && pageDownSeen,
        at: performance.now(),
        eventTimeStamp: event.timeStamp,
        trusted: event.isTrusted,
        target: describe(event.target),
        sameTarget: event.target === node,
        sameCurrentTarget: event.currentTarget === node,
        ...measure(),
      });
    };
    node.addEventListener('keydown', onEvent, { passive: true });
    node.addEventListener('scrollend', onEvent, { passive: true });
    return {
      read: () => ({ armed, events: [...events], current: measure() }),
      dispose: () => {
        node.removeEventListener('keydown', onEvent);
        node.removeEventListener('scrollend', onEvent);
      },
    };
  });
  try {
    await page.keyboard.press('PageDown');
    await expect
      .poll(
        () =>
          observation.evaluate((observer) =>
            observer
              .read()
              .events.some(
                (event) =>
                  event.afterPageDown &&
                  event.trusted &&
                  event.sameTarget &&
                  event.sameCurrentTarget,
              ),
          ),
        { timeout: 5000 },
      )
      .toBe(true);
  } finally {
    try {
      const receipt = await observation.evaluate((observer) => observer.read());
      await info.attach('OW3-PageDown-scrollend.json', {
        body: JSON.stringify(receipt, null, 2),
        contentType: 'application/json',
      });
    } finally {
      try {
        await observation.evaluate((observer) => observer.dispose());
      } finally {
        await observation.dispose();
      }
    }
  }
}
export const scrollState = (scroll) =>
  scroll.evaluate((node) => ({
    top: node.scrollTop,
    height: node.clientHeight,
    total: node.scrollHeight,
    documentTop: document.scrollingElement.scrollTop,
  }));
export async function wheel(page, scroll, delta) {
  const box = await scroll.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, Math.max(1, box.y) + Math.min(box.height / 2, 80));
  await page.mouse.wheel(0, delta);
}
export async function revealNewOperationalRowOnce(page, item, excludedKeys, info) {
  const observation = await item.inner(0).evaluateHandle((node, excluded) => {
    const outer = node.closest('[data-testid="operational-panel-scroll"]');
    if (!outer) throw new Error('The first inner scrollport must have its actual outer root');
    const rect = (element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const clientClip = (element) => {
      const box = rect(element);
      const scaleX = box.width / element.offsetWidth;
      const scaleY = box.height / element.offsetHeight;
      const left = box.left + element.clientLeft * scaleX;
      const top = box.top + element.clientTop * scaleY;
      const width = element.clientWidth * scaleX;
      const height = element.clientHeight * scaleY;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        scaleX,
        scaleY,
      };
    };
    const clipping = () => {
      const inner = clientClip(node);
      const parent = clientClip(outer);
      const left = Math.max(0, inner.left, parent.left);
      const top = Math.max(0, inner.top, parent.top);
      const right = Math.min(innerWidth, inner.right, parent.right);
      const bottom = Math.min(innerHeight, inner.bottom, parent.bottom);
      return { left, top, right, bottom, width: right - left, height: bottom - top, inner, parent };
    };
    const focused = document.activeElement;
    const focus = () =>
      document.activeElement instanceof Element
        ? {
            tag: document.activeElement.localName,
            testId: document.activeElement.getAttribute('data-testid'),
            rowKey:
              document.activeElement
                .closest('[data-caller-row-key]')
                ?.getAttribute('data-caller-row-key') ?? null,
          }
        : null;
    const measure = () => ({
      inner: { top: node.scrollTop, height: node.clientHeight, total: node.scrollHeight },
      outer: { top: outer.scrollTop, height: outer.clientHeight, total: outer.scrollHeight },
      document: { x: scrollX, y: scrollY },
    });
    const hittable = (control) => {
      if (!control?.isConnected) return false;
      const box = rect(control);
      const clip = clipping();
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.left >= clip.left &&
        box.right <= clip.right &&
        box.top >= clip.top &&
        box.bottom <= clip.bottom &&
        !!hit &&
        control.contains(hit)
      );
    };
    const candidates = [...node.querySelectorAll('[data-caller-row-key]')].flatMap((row) => {
      const key = row.getAttribute('data-caller-row-key');
      const kind = row.getAttribute('data-item-kind');
      const admitted = row.getAttribute('data-admitted') === 'true';
      const control = row.querySelector('button');
      if (!key || excluded.includes(key) || kind === 'content' || !admitted || !control) return [];
      return [{ key, kind, admitted, control, bounds: rect(control) }];
    });
    const clip = clipping();
    const alreadyVisibleKey = candidates.find(({ control }) => hittable(control))?.key ?? null;
    const selected = candidates
      .filter(
        ({ bounds }) =>
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= clip.left &&
          bounds.right <= clip.right &&
          bounds.top >= clip.bottom,
      )
      .sort((a, b) => a.bounds.top - b.bounds.top)[0];
    const point = { x: (clip.left + clip.right) / 2, y: (clip.top + clip.bottom) / 2 };
    const hitInside = () => {
      const hit = document.elementFromPoint(point.x, point.y);
      return (
        !!hit && node.contains(hit) && hit.closest('[data-testid^="operational-scroll-"]') === node
      );
    };
    const plan = {
      at: performance.now(),
      alreadyVisibleKey,
      clip,
      point,
      target: selected
        ? {
            key: selected.key,
            kind: selected.kind,
            admitted: selected.admitted,
            bounds: selected.bounds,
          }
        : null,
      delta: selected ? (selected.bounds.top + selected.bounds.bottom) / 2 - point.y : null,
      scrolls: measure(),
      focus: focus(),
    };
    const events = [];
    const onWheel = (event) =>
      events.push({
        at: performance.now(),
        eventTimeStamp: event.timeStamp,
        trusted: event.isTrusted,
        target:
          event.target instanceof Element
            ? {
                tag: event.target.localName,
                rowKey:
                  event.target
                    .closest('[data-caller-row-key]')
                    ?.getAttribute('data-caller-row-key') ?? null,
              }
            : null,
        targetInside: event.target instanceof Element && node.contains(event.target),
        sameCurrentTarget: event.currentTarget === node,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        scrolls: measure(),
      });
    node.addEventListener('wheel', onWheel, { passive: true });
    return {
      read: () => ({
        plan,
        events: [...events],
        current: {
          clip: clipping(),
          scrolls: measure(),
          hitInside: hitInside(),
          targetBounds: selected?.control.isConnected ? rect(selected.control) : null,
          targetHittable: selected ? hittable(selected.control) : false,
          focus: focus(),
          sameFocusedNode: document.activeElement === focused,
        },
      }),
      dispose: () => node.removeEventListener('wheel', onWheel),
    };
  }, excludedKeys);
  try {
    const before = await observation.evaluate((observer) => observer.read());
    const { plan } = before;
    expect(plan.clip.width).toBeGreaterThan(0);
    expect(plan.clip.height).toBeGreaterThan(0);
    if (plan.alreadyVisibleKey) {
      expect(before.events).toHaveLength(0);
      return;
    }
    expect(
      plan.target,
      'A mounted new operational control below the clip is required',
    ).not.toBeNull();
    expect(plan.target.kind).not.toBe('content');
    expect(plan.target.admitted).toBe(true);
    expect(excludedKeys).not.toContain(plan.target.key);
    expect(Number.isFinite(plan.delta)).toBe(true);
    expect(plan.delta).toBeGreaterThan(0);
    expect(
      plan.delta,
      'One native reveal is bounded by one actual clip height',
    ).toBeLessThanOrEqual(plan.clip.height);
    expect(before.current.hitInside, 'The wheel point must hit the first inner scrollport').toBe(
      true,
    );
    await page.mouse.move(plan.point.x, plan.point.y);
    const ready = await observation.evaluate((observer) => observer.read());
    expect(ready.current.clip).toEqual(plan.clip);
    expect(ready.current.scrolls).toEqual(plan.scrolls);
    expect(ready.current.targetBounds).toEqual(plan.target.bounds);
    expect(ready.current.hitInside).toBe(true);
    expect(ready.current.sameFocusedNode).toBe(true);
    await page.mouse.wheel(0, plan.delta);
    await expect
      .poll(
        async () => {
          const receipt = await observation.evaluate((observer) => observer.read());
          return receipt.events.some(
            (event) =>
              event.trusted &&
              event.targetInside &&
              event.sameCurrentTarget &&
              event.deltaX === 0 &&
              event.deltaY > 0 &&
              event.deltaMode === 0,
          );
        },
        { timeout: 5000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const receipt = await observation.evaluate((observer) => observer.read());
          return receipt.current.targetHittable;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    const after = await observation.evaluate((observer) => observer.read());
    expect(after.events).toHaveLength(1);
    expect(after.current.scrolls.inner.top).toBeGreaterThan(plan.scrolls.inner.top);
    expect(after.current.scrolls.outer.top).toBe(plan.scrolls.outer.top);
    expect(after.current.scrolls.document).toEqual(plan.scrolls.document);
    expect(after.current.sameFocusedNode).toBe(true);
    expect(after.current.focus).toEqual(plan.focus);
  } finally {
    try {
      const receipt = await observation.evaluate((observer) => observer.read());
      await info.attach('OW4-native-reveal.json', {
        body: JSON.stringify(receipt, null, 2),
        contentType: 'application/json',
      });
    } finally {
      try {
        await observation.evaluate((observer) => observer.dispose());
      } finally {
        await observation.dispose();
      }
    }
  }
}

export async function visibleRows(item) {
  return item.rows.evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const control = node.querySelector('button');
      if (!control) return [];
      const rect = control.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      if (
        !(
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          target &&
          control.contains(target)
        )
      )
        return [];
      return [
        {
          key: node.getAttribute('data-caller-row-key'),
          label: control.textContent.replace(/^Observe /, ''),
          kind: node.getAttribute('data-item-kind'),
          admitted: node.getAttribute('data-admitted') === 'true',
        },
      ];
    }),
  );
}
export async function visibleRow(item, excludedKeys = []) {
  let found;
  await expect
    .poll(
      async () => {
        found = (await visibleRows(item)).find(
          (row) => row.kind !== 'content' && !excludedKeys.includes(row.key),
        );
        return Boolean(found);
      },
      { message: 'A new operational row must be actually visible and hittable' },
    )
    .toBe(true);
  return { ...found, node: rowByLabel(item, found.label) };
}
export async function activate(item, row, { revision = 0, callbackRevision = 0, draft = '' } = {}) {
  const before = await outputJson(item.observations);
  await button(row.node, `Observe ${row.label}`).click();
  const after = await outputJson(item.observations);
  const receipt = after.at(-1);
  expect(after.filter((record) => record.event === 'activate').length).toBe(
    before.filter((record) => record.event === 'activate').length + 1,
  );
  expect(receipt).toMatchObject({
    event: 'activate',
    trusted: true,
    key: row.key,
    label: row.label,
    revision,
    callbackRevision,
    draft,
    admitted: true,
  });
  return receipt;
}
export async function sameNode(current, old) {
  expect(await current.evaluate((node, previous) => node === previous, old)).toBe(true);
}
export async function disconnected(old) {
  await expect.poll(() => old.evaluate((node) => node.isConnected)).toBe(false);
}
export async function readSnapshot(item) {
  await button(item.region, 'Read panel snapshot').click();
  const value = await outputJson(item.snapshot);
  expect(value).not.toBeNull();
  return value;
}
export async function geometry(item) {
  return item.region.evaluate((root) => {
    const rect = (node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      page: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight },
      frame: rect(root),
      activeKey:
        document.activeElement
          ?.closest('[data-caller-row-key]')
          ?.getAttribute('data-caller-row-key') ?? null,
      windows: [...root.querySelectorAll('[data-operational-window]')].map((node) => ({
        scope: node.getAttribute('data-operational-window'),
        bounds: rect(node),
        parts: [...node.children].map((part) => ({
          key: part.getAttribute('data-operational-window-key'),
          spacerRows: Number(part.getAttribute('data-operational-spacer-rows') ?? 0),
          hidden: part.getAttribute('aria-hidden'),
          bounds: rect(part),
          kind: part.querySelector('[data-item-kind]')?.getAttribute('data-item-kind'),
          admitted: part.querySelector('[data-admitted]')?.getAttribute('data-admitted'),
        })),
      })),
      scrolls: [
        ...root.querySelectorAll(
          '[data-testid^="operational-scroll-"], [data-testid="operational-panel-scroll"]',
        ),
      ].map((node) => ({
        name: node.getAttribute('data-testid'),
        top: node.scrollTop,
        height: node.clientHeight,
        total: node.scrollHeight,
        bounds: rect(node),
      })),
    };
  });
}
export async function capture(page, item, name, info, target = item.scroll) {
  await page.evaluate(() => document.fonts.ready);
  // Observe the real browser's layout across its native frame boundary. This
  // never advances/fakes a clock or calls the admission owner as an oracle.
  let before;
  await expect
    .poll(
      async () => {
        const first = await geometry(item);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        before = await geometry(item);
        return JSON.stringify(first) === JSON.stringify(before);
      },
      { message: 'Real rows and geometry must settle before capture' },
    )
    .toBe(true);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(420);
  expect(box.y, 'Capture target must already be wholly in the viewport').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  await info.attach(`${name}-before-geometry.json`, {
    body: JSON.stringify(before, null, 2),
    contentType: 'application/json',
  });
  const png = await stableLocatorScreenshot(page, target, async ({ png: raw, ...attempt }) => {
    if (raw)
      await info.attach(`${name}-attempt-${attempt.attempt}.png`, {
        body: raw,
        contentType: 'image/png',
      });
    await info.attach(`${name}-attempt-${attempt.attempt}.json`, {
      body: JSON.stringify({ ...attempt, sha256: raw ? digest(raw) : null }, null, 2),
      contentType: 'application/json',
    });
  });
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  // Native viewport capture supplies context even for document mode. It never
  // scrolls/repositions a locator and cannot mask a changed capture context.
  const viewport = await page.screenshot({
    animations: 'allow',
    caret: 'hide',
    scale: 'css',
    fullPage: false,
  });
  await info.attach(`${name}-viewport.png`, { body: viewport, contentType: 'image/png' });
  const after = await geometry(item);
  await info.attach(`${name}-geometry-ax.json`, {
    body: JSON.stringify({ before, after, ax: await item.region.ariaSnapshot() }, null, 2),
    contentType: 'application/json',
  });
  expect(after, 'Capturing must not change scroll, focus, rows or geometry').toEqual(before);
}
