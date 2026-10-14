import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, openExample, outputJson } from './functional.mjs';
import { repoRoot } from './manifest.mjs';
import { verifyReference, candidateProvenance, changedSources } from './provenance.mjs';
import { observeErrors, stableLocatorScreenshot } from './browser.mjs';
import { compareImages } from './compare.mjs';

// Display-prop evidence only. Source oracle: the four avatar leaves at 003bc52.
// No Store, transport, observer replacement, CSS assertions or reference mount.
export const test = base.extend({
  avatarNetwork: [
    async ({ page }, use, info) => {
      const requests = [];
      const sockets = [];
      const failures = [];
      const rpcMethods = [];
      const publicUrl = (value) => {
        const url = new URL(value);
        for (const key of ['token', 'auth', 'key']) {
          if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
        }
        return url.href;
      };
      page.on('request', (request) => {
        requests.push({ method: request.method(), url: publicUrl(request.url()) });
      });
      page.on('requestfailed', (request) => {
        failures.push({ url: publicUrl(request.url()), error: request.failure()?.errorText });
      });
      page.on('websocket', (socket) => {
        sockets.push(publicUrl(socket.url()));
        socket.on('framesent', ({ payload }) => {
          try {
            const frame = JSON.parse(String(payload));
            if (typeof frame.method === 'string') rpcMethods.push(frame.method);
          } catch {
            // Preserve socket identity; non-JSON Vite frames are not RPC calls.
          }
        });
      });
      try {
        await use();
      } finally {
        await info.attach('agent-avatar-network.json', {
          body: JSON.stringify({ requests, sockets, failures, rpcMethods }, null, 2),
          contentType: 'application/json',
        });
        const candidate = new URL(process.env.PARITY_CANDIDATE_URL);
        expect(
          sockets.filter((value) => {
            const url = new URL(value);
            return url.host !== candidate.host || url.pathname !== '/';
          }),
          'The approved no-bridge page may open only the same-origin Vite HMR socket',
        ).toEqual([]);
        expect(rpcMethods, 'Avatar display checks must not send daemon RPC').toEqual([]);
        expect(
          requests.filter(
            ({ method, url }) =>
              !['GET', 'HEAD'].includes(method) || new URL(url).pathname.startsWith('/intentd/'),
          ),
          'The display exercise must not issue mutations or use the daemon HTTP bridge',
        ).toEqual([]);
        expect(failures, 'Native request failures must remain visible').toEqual([]);
      }
    },
    { auto: true },
  ],
});
export { expect, outputJson };

export const display = (host) => host.getByTestId('controlled-avatar-display');
export const surface = (host) => display(host).locator('[data-agent-avatar-with-state]');
export const stack = (host) =>
  host.getByTestId('avatar-stack-container').locator('[data-agent-avatar-stack]');
export const items = (host) => stack(host).locator('[data-agent-avatar-stack-item]');
export const activations = (host) => host.getByLabel('Avatar item activations', { exact: true });

export async function openAvatar(page, motion = 'reduced') {
  expect(
    process.env.PARITY_AGENT_AVATAR_APPROVED,
    'Coordinator must approve the exact frozen root, no-bridge URL and bounded cases',
  ).toBe('1');
  let host;
  if (motion === 'reduced') {
    host = await openExample(page, 'agent-avatar', 'agent-avatar');
  } else {
    // The shared opener intentionally always uses reduced motion. This private
    // case uses the same public route with its supported full-motion query.
    const url = new URL('/sandbox/agent-avatar', process.env.PARITY_CANDIDATE_URL);
    url.search = new URLSearchParams({
      example: 'interactive',
      theme: 'light',
      motion,
      width: '420',
    });
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBe(true);
    host = page.locator('[data-functional-example="agent-avatar"]');
    await expect(host).toBeVisible({ timeout: 15_000 });
    await expect(host.locator('[data-catalog-unimplemented]')).toHaveCount(0);
  }
  expect(
    await page.evaluate(() => ({
      preload: typeof window.electronAPI,
      daemonUrl: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
    })),
  ).toEqual({ preload: 'undefined', daemonUrl: null });
  await page.evaluate(() => document.fonts.ready);
  return host;
}

export async function choose(page, host, label, value) {
  const trigger = host.getByRole('combobox', { name: label, exact: true });
  await trigger.press('Enter');
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

export async function expectStack(host, visible, remaining) {
  await expect(items(host)).toHaveCount(visible);
  const overflow = stack(host).locator('[data-agent-avatar-overflow]');
  if (remaining) await expect(overflow).toHaveText(`+${remaining}`);
  else await expect(overflow).toHaveCount(0);
}

export async function nativeArt(svg) {
  await expect(svg).toBeVisible();
  const box = await svg.evaluate((node) => {
    const art = node.querySelector('g');
    if (!(art instanceof window.SVGGraphicsElement)) throw new Error('Missing native SVG artwork');
    const bounds = art.getBBox();
    return { width: bounds.width, height: bounds.height };
  });
  expect(box.width, 'The selected avatar must contain rendered SVG geometry').toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return box;
}

export async function settleAvatarMotion(surface, name, info) {
  // original003's wrapper disables transitions, while the shared reduced-motion
  // blanket can create a finite background transition on the inner SVG. Observe
  // native Animation completion; never finish/cancel it or suppress descendants.
  const evidence = await surface.evaluate(async (root) => {
    const rect = (node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const art = root.querySelector('svg[data-agent-avatar]');
    const bounds = () => ({ surface: rect(root), art: art ? rect(art) : null });
    const snapshot = (animation) => {
      const timing = animation.effect?.getComputedTiming();
      return {
        type: animation.constructor.name,
        property: animation.transitionProperty ?? null,
        playState: animation.playState,
        pending: animation.pending,
        currentTime: animation.currentTime,
        isAvatarArt: animation.effect?.target === art,
        finiteOnce:
          timing?.iterations === 1 &&
          Number.isFinite(timing.activeDuration) &&
          Number.isFinite(timing.endTime),
      };
    };
    const own = root.getAnimations().map(snapshot);
    const animations = root.getAnimations({ subtree: true });
    const before = animations.map(snapshot);
    const beforeBounds = bounds();
    const allowed = before.every(
      (item) =>
        item.type === 'CSSTransition' &&
        item.property === 'background-color' &&
        item.isAvatarArt &&
        item.finiteOnce,
    );
    if (own.length || !allowed) return { own, before, beforeBounds, allowed, settled: false };
    await Promise.all(animations.map((animation) => animation.finished));
    return {
      own,
      before,
      after: animations.map(snapshot),
      beforeBounds,
      afterBounds: bounds(),
      allowed,
      settled: root.getAnimations({ subtree: true }).length === 0,
    };
  });
  await info.attach(`${name}-motion.json`, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  expect(evidence.own, 'Reduced motion must leave the state wrapper unanimated').toEqual([]);
  expect(evidence.allowed, 'Only a finite native avatar SVG background transition is allowed').toBe(
    true,
  );
  expect(evidence.settled, 'Observed native transitions must finish naturally').toBe(true);
  expect(evidence.afterBounds, 'Natural settlement must preserve avatar geometry').toEqual(
    evidence.beforeBounds,
  );
}

export async function captureAvatar(page, target, name, info) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const observe = () =>
    target.evaluate((root) => {
      const rect = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        target: rect(root),
        nodes: [
          ...root.querySelectorAll(
            '[data-agent-avatar], [data-agent-avatar-surface], [data-agent-avatar-stack-item], [data-agent-avatar-overflow]',
          ),
        ].map((node) => ({
          state: node.getAttribute('data-avatar-state'),
          design: node.getAttribute('data-avatar-design'),
          key: node.getAttribute('data-agent-avatar-stack-key'),
          bounds: rect(node),
        })),
      };
    });
  const before = await observe();
  const png = await page.screenshot({ animations: 'allow' });
  const after = await observe();
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  await info.attach(`${name}-geometry.json`, {
    body: JSON.stringify(
      { before, after, sha256: createHash('sha256').update(png).digest('hex') },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(after, 'The screenshot must not change the observed capture geometry').toEqual(before);
  return after;
}

export function avatarSourceFreeze() {
  const plan = JSON.parse(readFileSync(process.env.PARITY_AGENT_AVATAR_SOURCE_PLAN, 'utf8'));
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  expect(plan.inputSha256).toBe('097ea6ee94b1ede00e00adcf263852f188c3aacdecc1008f2bf395927d431b03');
  expect(digest(JSON.stringify(plan.input))).toBe(plan.inputSha256);
  const source = verifyReference(plan.input.reference.root, plan.input.reference);
  expect(source.commit).toBe('003bc52c00dcfffe8513cd6be1b8f45011716714');
  const inputs = [
    [plan.input.reference.root, { ...plan.input.closure.hashes, ...plan.input.auxiliarySha256 }],
    [repoRoot, plan.input.setupSha256],
  ];
  const hashes = {};
  for (const [root, expected] of inputs) {
    for (const [file, hash] of Object.entries(expected)) {
      const actual = digest(readFileSync(path.join(root, file)));
      hashes[path.join(root, file)] = actual;
      expect(actual, `Reviewed source input changed: ${file}`).toBe(hash);
    }
  }
  return { plan, source, hashes };
}

export function observeAvatarPairNetwork(page) {
  const evidence = { requests: [], sockets: [], frames: [], failures: [], rpc: [] };
  const publicUrl = (value) => {
    const url = new URL(value);
    for (const key of ['token', 'auth', 'key']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.href;
  };
  page.on('request', (request) => {
    evidence.requests.push({ method: request.method(), url: publicUrl(request.url()) });
  });
  page.on('requestfailed', (request) => {
    evidence.failures.push({ url: publicUrl(request.url()), error: request.failure()?.errorText });
  });
  page.on('websocket', (socket) => {
    const url = publicUrl(socket.url());
    evidence.sockets.push(url);
    for (const direction of ['framesent', 'framereceived']) {
      socket.on(direction, ({ payload }) => {
        const raw = String(payload);
        evidence.frames.push({ url, direction, raw });
        try {
          const frame = JSON.parse(raw);
          if (typeof frame.method === 'string')
            evidence.rpc.push({ direction, method: frame.method });
        } catch {
          // Preserve every raw frame, including non-JSON development messages.
        }
      });
    }
  });
  return evidence;
}

export function assertAvatarPairNetwork(evidence, origin) {
  const allowedOrigin = new URL(origin);
  expect(
    evidence.sockets.filter((value) => {
      const url = new URL(value);
      return url.host !== allowedOrigin.host || url.pathname !== '/';
    }),
    'Only this page’s same-origin Vite HMR socket is permitted',
  ).toEqual([]);
  expect(evidence.rpc, 'A pure avatar comparison must not communicate with a daemon').toEqual([]);
  // Pinned Vite 6.4.3 / 8.3.4 servers send only { type: 'connected' } at
  // startup; their clients send { type: 'ping' } heartbeats. This frozen run
  // permits no updates or custom events. Keep unknown raw frames and fail.
  for (const frame of evidence.frames) {
    expect(['framesent', 'framereceived']).toContain(frame.direction);
    expect(evidence.sockets).toContain(frame.url);
    expect(JSON.parse(frame.raw), `Unexpected ${frame.direction} frame: ${frame.raw}`).toEqual({
      type: frame.direction === 'framereceived' ? 'connected' : 'ping',
    });
  }
  for (const url of evidence.sockets) {
    expect(
      evidence.frames.some((frame) => frame.url === url && frame.direction === 'framereceived'),
      'Every observed HMR connection must retain its startup frame',
    ).toBe(true);
  }
  expect(evidence.failures, 'Every failed request remains fatal').toEqual([]);
  expect(
    evidence.requests.filter(
      ({ method, url }) =>
        !['GET', 'HEAD'].includes(method) ||
        new URL(url).origin !== allowedOrigin.origin ||
        new URL(url).pathname.startsWith('/intentd/'),
    ),
  ).toEqual([]);
}

async function inspectAvatarPairHost(page) {
  await page.evaluate(async () => {
    await Promise.all(
      [400, 500, 600].map((weight) => document.fonts.load(`${weight} 12px 'Inter Variable'`)),
    );
    await document.fonts.ready;
  });
  const target = page.getByTestId('source-avatar-waiting-host');
  await expect(target).toHaveCount(1);
  await expect(target).toBeVisible();
  await expect(target.getByTestId('reactive-waiting-avatar').getByRole('img')).toHaveAccessibleName(
    'Waiting',
  );
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const evidence = await target.evaluate((root) => {
    const base = root.getBoundingClientRect();
    const fonts = Array.from(document.fonts)
      .filter((face) => face.family.replaceAll(/['"]/g, '').trim() === 'Inter Variable')
      .map((face) => ({
        family: face.family,
        weight: face.weight,
        style: face.style,
        status: face.status,
      }));
    const nodes = [
      ...root.querySelectorAll(
        '[data-agent-avatar-catalog], [data-agent-avatar], [data-agent-avatar-with-state], [data-agent-avatar-overflow]',
      ),
    ].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        state: node.getAttribute('data-avatar-state'),
        design: node.getAttribute('data-avatar-design'),
        bounds: { x: rect.x - base.x, y: rect.y - base.y, width: rect.width, height: rect.height },
      };
    });
    return {
      fonts,
      environment: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio,
        locale: navigator.language,
        timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      geometry: { width: base.width, height: base.height, nodes },
      svgCount: root.querySelectorAll('svg[data-agent-avatar]').length,
      preload: typeof window.electronAPI,
      daemonUrl: globalThis.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl ?? null,
    };
  });
  expect(evidence.fonts.some((font) => font.status === 'loaded')).toBe(true);
  expect(evidence.environment).toEqual({
    width: 1024,
    height: 900,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  expect(evidence.preload).toBe('undefined');
  expect(evidence.daemonUrl).toBeNull();
  return evidence;
}

export async function compareAvatarSourcePair(candidate, browser, candidateErrors, info) {
  expect(
    process.env.PARITY_AGENT_AVATAR_PAIR_APPROVED,
    'The exact pair needs a separate review',
  ).toBe('1');
  const before = avatarSourceFreeze();
  const candidateRoot = process.env.PARITY_CANDIDATE_ROOT;
  const candidateBefore = candidateProvenance(candidateRoot);
  expect(candidateBefore.commit).toBe('c6da68fc53cde59998a1f17cc77f5ff58d133b44');
  expect(candidateBefore.sourceDirty).toBe(false);
  const options = {
    viewport: { width: 1024, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  };
  const sourceContext = await browser.newContext(options);
  const source = await sourceContext.newPage();
  const sourceErrors = await observeErrors(source);
  const network = {
    source: observeAvatarPairNetwork(source),
    candidate: observeAvatarPairNetwork(candidate),
  };
  const metadata = { before, candidateBefore, options, browserVersion: browser.version(), network };
  try {
    const response = await source.goto(before.plan.url, { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBe(true);
    await expect(source.locator('[data-avatar-source-ready="true"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    const ready = await source.evaluate(() => window.__INTENT_AVATAR_SOURCE__);
    metadata.sourceReady = ready;
    expect(ready.status).toBe('ready');
    expect(ready.props).toEqual({ theme: 'light', motionReduced: true, state: 'waiting', zoom: 1 });
    expect(ready.provenance.planSha256).toBe(before.plan.inputSha256);
    expect(ready.provenance.commit).toBe(before.source.commit);
    expect(ready.provenance.sourceTreeSha256).toBe(before.source.sourceTreeSha256);
    expect(ready.provenance.sourcePins).toEqual(before.plan.input.sourcePins);
    expect(sourceErrors).toEqual([]);

    const url = new URL('/sandbox/agent-avatar', process.env.PARITY_CANDIDATE_URL);
    url.search = new URLSearchParams({
      example: 'interactive',
      theme: 'light',
      motion: 'reduced',
      width: '1024',
    });
    expect((await candidate.goto(url.href, { waitUntil: 'domcontentloaded' }))?.ok()).toBe(true);
    const host = candidate.locator('[data-functional-example="agent-avatar"]');
    await expect(host).toBeVisible({ timeout: 15_000 });
    await expect(host.locator('[data-catalog-unimplemented]')).toHaveCount(0);
    await choose(candidate, host, 'Display mode', 'source waiting host');
    await choose(candidate, host, 'Avatar state', 'waiting');
    await expect(host.getByRole('combobox', { name: 'Source host zoom', exact: true })).toHaveText(
      '1',
    );
    expect(candidateErrors).toEqual([]);

    const pages = [
      ['source', source],
      ['candidate', candidate],
    ];
    metadata.hosts = {};
    const captures = {};
    for (const [side, page] of pages) {
      metadata.hosts[side] = await inspectAvatarPairHost(page);
      const target = page.getByTestId('source-avatar-waiting-host');
      captures[side] = await stableLocatorScreenshot(page, target, async ({ png, ...attempt }) => {
        if (png)
          await info.attach(`${side}-avatar-attempt-${attempt.attempt}.png`, {
            body: png,
            contentType: 'image/png',
          });
        await info.attach(`${side}-avatar-attempt-${attempt.attempt}.json`, {
          body: JSON.stringify(
            { ...attempt, sha256: png ? createHash('sha256').update(png).digest('hex') : null },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      });
      metadata.hosts[side].aria = await target.ariaSnapshot();
    }
    const { diff, ...comparison } = compareImages(captures.source, captures.candidate);
    metadata.comparison = comparison;
    metadata.images = {};
    for (const [name, png] of Object.entries({
      source: captures.source,
      candidate: captures.candidate,
      diff,
    })) {
      metadata.images[name] = createHash('sha256').update(png).digest('hex');
      await info.attach(`${name}-avatar.png`, { body: png, contentType: 'image/png' });
    }
    // Native source measurements are the oracle; no copied sizes or tolerances.
    expect(metadata.hosts.candidate.geometry).toEqual(metadata.hosts.source.geometry);
    expect(metadata.hosts.candidate.svgCount).toBe(metadata.hosts.source.svgCount);
    expect(metadata.hosts.candidate.aria).toBe(metadata.hosts.source.aria);
    expect(comparison.dimensionsMatch).toBe(true);
    expect(comparison.diffPixels, 'The complete reviewed source host must match every pixel').toBe(
      0,
    );
  } finally {
    await sourceContext.close();
    metadata.sourceContextClosed = true;
    metadata.errors = { source: sourceErrors, candidate: candidateErrors };
    try {
      metadata.after = avatarSourceFreeze();
      metadata.candidateAfter = candidateProvenance(candidateRoot);
      metadata.changedCandidatePaths = changedSources(candidateBefore, metadata.candidateAfter);
    } catch (error) {
      metadata.provenanceError = String(error);
    }
    await info.attach('avatar-source-comparison.json', {
      body: JSON.stringify(metadata, null, 2),
      contentType: 'application/json',
    });
    expect(metadata.provenanceError).toBeUndefined();
    expect(metadata.after.hashes).toEqual(before.hashes);
    expect(metadata.changedCandidatePaths).toEqual([]);
    expect(sourceErrors).toEqual([]);
    expect(candidateErrors).toEqual([]);
    assertAvatarPairNetwork(network.source, before.plan.url);
    assertAvatarPairNetwork(network.candidate, process.env.PARITY_CANDIDATE_URL);
  }
}
