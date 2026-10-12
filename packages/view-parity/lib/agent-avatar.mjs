import { createHash } from 'node:crypto';
import { test as base, expect, openExample, outputJson } from './functional.mjs';

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
    if (!(art instanceof SVGGraphicsElement)) throw new Error('Missing native SVG artwork');
    const bounds = art.getBBox();
    return { width: bounds.width, height: bounds.height };
  });
  expect(box.width, 'The selected avatar must contain rendered SVG geometry').toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return box;
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
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
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
