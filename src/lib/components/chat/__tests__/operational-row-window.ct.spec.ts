import { expect, test } from '../../../../test/ct-test';
import type { ContentBlock } from '$shared/types';
import OperationalRowWindowHost from './OperationalRowWindowHost.svelte';
import StreamingResponseGroupLifecycleHost from './StreamingResponseGroupLifecycleHost.svelte';

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    const counts: number[] = [];
    let count = 0;
    const observer = new MutationObserver((records) => {
      const added = new Set<Element>();
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.oldValue === null &&
          record.target instanceof Element &&
          record.target.hasAttribute('data-chat-operational-row')
        )
          added.add(record.target);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[data-chat-operational-row]')) added.add(node);
          node.querySelectorAll('[data-chat-operational-row]').forEach((row) => added.add(row));
        }
      }
      count += added.size;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-chat-operational-row'],
      attributeOldValue: true,
    });
    const frame = () => {
      counts.push(count);
      count = 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    Object.assign(window, { operationalMountCounts: counts });
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const geometry = await page.locator('[data-window-scroll]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const root = node as HTMLElement & { operationalSnapshot?: () => unknown };
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
          };
        };
        return {
          scrollTop: root.scrollTop,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
          box: box(root),
          policy: root.operationalSnapshot?.(),
          windows: [...root.querySelectorAll('[data-operational-window]')].map((window) => ({
            scope: window.getAttribute('data-operational-window'),
            box: box(window),
            rows: [...window.children].map((child) => ({
              key: child.getAttribute('data-operational-window-key'),
              spacer: child.getAttribute('data-operational-spacer-rows'),
              style: child.getAttribute('style'),
              box: box(child),
            })),
          })),
        };
      }),
    );
    await info.attach('operational-window-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
  }

  const counts = await page.evaluate(
    () => (window as unknown as { operationalMountCounts: number[] }).operationalMountCounts,
  );
  await info.attach('physical-row-mounts-per-frame', {
    body: JSON.stringify(counts),
    contentType: 'application/json',
  });
  expect(Math.max(0, ...counts)).toBeLessThanOrEqual(4);
});

for (const renderer of ['streaming', 'settled'] as const) {
  test(`${renderer}: a huge message mounts only viewport rows and bounded overscan`, async ({
    mount,
    page,
  }) => {
    const host = await mount(OperationalRowWindowHost, { props: { renderer } });
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeGreaterThan(0);
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
    await expect.poll(() => host.locator('[data-operational-spacer]').count()).toBeLessThan(5);
    await host.evaluate((node) => {
      node.scrollTop = node.scrollHeight / 2;
    });
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
    await expect(host.getByText('Inspecting 0', { exact: true })).toHaveCount(0);
    await host.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(host.getByText('Checking 999', { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/operational-window-${renderer}.png` });
  });
}

test('concurrent messages share the physical mount allowance, including parent replacement', async ({
  mount,
  page,
}) => {
  const host = await mount(OperationalRowWindowHost, { props: { count: 3, messages: 2 } });
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(12);
  await host.update({ props: { count: 3, messages: 2, shown: false } });
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  );
  await host.update({ props: { count: 3, messages: 2, shown: true, generation: 1 } });
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(12);
  const maximum = await page.evaluate(() =>
    Math.max(...(window as unknown as { operationalMountCounts: number[] }).operationalMountCounts),
  );
  expect(maximum).toBeLessThanOrEqual(4);
});

test('expanded response groups cannot bypass the panel bound', async ({ mount }) => {
  const host = await mount(OperationalRowWindowHost, { props: { grouped: true } });
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeGreaterThan(1);
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
  await host.getByTestId('response-group-disclosure').click();
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(1);
});

test('many admitted messages still share one viewport window', async ({ mount }) => {
  const host = await mount(OperationalRowWindowHost, { props: { messages: 100, count: 10 } });
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeGreaterThan(0);
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(
    host.locator('[data-operational-window="m99"]').getByText('Checking 9', { exact: true }),
  ).toBeVisible();
  await expect(
    host.locator('[data-operational-window="m0"] [data-chat-operational-row]'),
  ).toHaveCount(0);
});

for (const renderer of ['streaming', 'settled'] as const) {
  test(`${renderer}: nested standalone tool results are windowed`, async ({ mount }) => {
    const host = await mount(OperationalRowWindowHost, {
      props: { renderer, nestedResult: true, count: 400 },
    });
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeGreaterThan(0);
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
    await host.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(host.locator('[data-tool-use-id="m0-nested-399"]')).toBeVisible();
    await expect(host.locator('[data-tool-use-id="m0-nested-0"]')).toHaveCount(0);
  });
}

test('visible children remain reachable after their group summary scrolls far away', async ({
  mount,
}) => {
  const host = await mount(OperationalRowWindowHost, { props: { grouped: true } });
  await expect(host.getByTestId('response-group-disclosure')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(host.getByText('Checking 999', { exact: true })).toBeVisible();
  await expect(host.getByTestId('response-group-disclosure')).toHaveCount(0);
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
  await host.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(host.getByTestId('response-group-disclosure')).toBeVisible();
  await host.getByTestId('response-group-disclosure').click();
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(1);
  await host.getByTestId('response-group-disclosure').click();
  await expect(host.getByText('Inspecting 0', { exact: true })).toBeVisible();
});

test('two clipped streaming previews share overscan while each retains local scroll history', async ({
  mount,
}) => {
  const host = await mount(OperationalRowWindowHost, {
    props: { grouped: true, live: true, messages: 2, count: 300 },
  });
  await expect(host.getByTestId('response-group-disclosure')).toHaveCount(2);
  await expect(host.getByText('Checking 299', { exact: true })).toHaveCount(2);
  const counts = () =>
    host.evaluate((root) => {
      const rows = [...root.querySelectorAll('[data-chat-operational-row]')];
      let visible = 0;
      for (const row of rows) {
        const summary = row.querySelector('[data-operational-disclosure-row]');
        if (!summary) continue;
        const box = summary.getBoundingClientRect();
        let top = 0,
          bottom = innerHeight;
        for (let ancestor = summary.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowY)) {
            const clip = ancestor.getBoundingClientRect();
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        if (box.bottom > top && box.top < bottom) visible++;
      }
      return rows.length - visible;
    });
  await expect.poll(counts).toBeLessThanOrEqual(24);
  const scrollers = host.locator('.cylinder-scroller');
  await scrollers.first().evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(host.getByText('Inspecting 0', { exact: true })).toHaveCount(1);
  await expect(host.getByText('Checking 299', { exact: true })).toHaveCount(1);
  await expect.poll(counts).toBeLessThanOrEqual(24);
});

test('disclosure state survives parent disposal and viewport resizing', async ({ mount }) => {
  const host = await mount(OperationalRowWindowHost, { props: { grouped: true, count: 100 } });
  const disclosure = host.getByTestId('response-group-disclosure');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await host.update({ props: { grouped: true, count: 100, generation: 1 } });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(1);
  await disclosure.click();
  await expect(host.getByText('Inspecting 0', { exact: true })).toBeVisible();
  // Exercise resizing after the reveal reaches its natural height. Scrolling
  // during the reveal targets its temporary, smaller scroll extent.
  await expect
    .poll(() =>
      host
        .locator('[data-response-group-motion="height-opacity-y"]')
        .first()
        .evaluate((node) => (node as HTMLElement).style.height),
    )
    .toBe('');
  await host.evaluate((node) => {
    node.style.width = '320px';
    node.scrollTop = node.scrollHeight;
  });
  await expect(host.getByText('Checking 99', { exact: true })).toBeVisible();
  await host.evaluate((node) => {
    node.style.width = '600px';
    node.scrollTop = 0;
  });
  await expect(host.getByText('Inspecting 0', { exact: true })).toBeVisible();
});

test('panel teardown releases row and window observations', async ({ mount, page }) => {
  await page.evaluate(() => {
    const Native = window.ResizeObserver;
    const observed = new Set<Element>();
    window.ResizeObserver = class extends Native {
      private nodes = new Set<Element>();
      observe(node: Element, options?: ResizeObserverOptions) {
        this.nodes.add(node);
        observed.add(node);
        super.observe(node, options);
      }
      unobserve(node: Element) {
        this.nodes.delete(node);
        observed.delete(node);
        super.unobserve(node);
      }
      disconnect() {
        this.nodes.forEach((node) => observed.delete(node));
        this.nodes.clear();
        super.disconnect();
      }
    };
    Object.assign(window, { observedOperationalNodes: observed });
  });
  const host = await mount(OperationalRowWindowHost, {
    props: { grouped: true, live: true, count: 200 },
  });
  await expect(host.getByTestId('response-group-disclosure')).toBeVisible();
  await host.getByTestId('response-group-disclosure').click();
  await expect(host.getByText('Inspecting 0', { exact: true })).toBeVisible();
  await host.unmount();
  expect(
    await page.evaluate(
      () =>
        [
          ...(window as unknown as { observedOperationalNodes: Set<Element> })
            .observedOperationalNodes,
        ].filter((node) => node.matches('[data-operational-window], [data-operational-window-key]'))
          .length,
    ),
  ).toBe(0);
});

for (const zoom of [1, 2]) {
  test(`measuring newly admitted rows preserves the scroll anchor at ${zoom * 100}%`, async ({
    mount,
  }) => {
    const host = await mount(OperationalRowWindowHost);
    await host.evaluate((node, scale) => {
      node.style.zoom = String(scale);
    }, zoom);
    await expect(host.getByText('Inspecting 0', { exact: true })).toBeVisible();
    const anchor = await host.evaluate(async (node) => {
      node.scrollTop = node.scrollHeight / 2;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const viewport = node.getBoundingClientRect();
      const row = [...node.querySelectorAll<HTMLElement>('[data-operational-window-key]')].find(
        (row) => {
          const box = row.getBoundingClientRect();
          return box.top >= viewport.top && box.bottom <= viewport.bottom;
        },
      );
      if (!row) throw new Error('No admitted anchor row');
      return { key: row.dataset.operationalWindowKey, top: row.getBoundingClientRect().top };
    });
    await host.evaluate(async () => {
      for (let frame = 0; frame < 30; frame++) await new Promise(requestAnimationFrame);
    });
    const top = await host.evaluate(
      (node, key) =>
        [...node.querySelectorAll<HTMLElement>('[data-operational-window-key]')]
          .find((row) => row.dataset.operationalWindowKey === key)
          ?.getBoundingClientRect().top,
      anchor.key,
    );
    expect(top).toBeDefined();
    expect(Math.abs((top ?? Infinity) - anchor.top)).toBeLessThanOrEqual(1);
  });
}

for (const renderer of ['streaming', 'settled'] as const) {
  test(`${renderer}: group disclosure belongs to its source after prose insertion and replacement`, async ({
    mount,
  }) => {
    const group = (name: string, id: string): ContentBlock[] => [
      { type: 'text', text: `<group:${name}>` },
      { type: 'thinking', id, text: `## ${name} thought\n\nDetails.` },
      { type: 'text', text: '</group>' },
    ];
    const a = group('Alpha', 'a');
    const b = group('Beta', 'b');
    const host = await mount(OperationalRowWindowHost, {
      props: { renderer, contentOverride: [...a, ...b] },
    });
    const alpha = host.getByTestId('response-group-disclosure').filter({ hasText: 'Alpha' });
    const beta = host.getByTestId('response-group-disclosure').filter({ hasText: 'Beta' });
    await expect(alpha).toHaveAttribute('aria-expanded', 'false');
    await alpha.click();
    await expect(alpha).toHaveAttribute('aria-expanded', 'true');
    await expect(beta).toHaveAttribute('aria-expanded', 'true');
    await beta.click();
    await expect(beta).toHaveAttribute('aria-expanded', 'false');
    await host.update({
      props: { renderer, contentOverride: [{ type: 'text', text: 'Inserted prose' }, ...a, ...b] },
    });
    await expect(alpha).toHaveAttribute('aria-expanded', 'true');
    await expect(beta).toHaveAttribute('aria-expanded', 'false');
    await host.update({
      props: { renderer, contentOverride: [...group('Alpha', 'replacement'), ...b] },
    });
    await expect(alpha).toHaveAttribute('aria-expanded', 'false');
    await expect(beta).toHaveAttribute('aria-expanded', 'false');
  });
}

for (const zoom of [1, 2]) {
  test(`document scrolling preserves measured row anchors at ${zoom * 100}%`, async ({
    mount,
    page,
  }) => {
    const host = await mount(OperationalRowWindowHost, { props: { documentScroll: true } });
    await page.evaluate(() => {
      document.documentElement.style.overflow = 'auto';
      document.body.style.overflow = 'visible';
      document.body.style.height = 'auto';
    });
    await host.evaluate((node, scale) => {
      node.style.zoom = String(scale);
    }, zoom);
    await expect(host.getByText('Inspecting 0', { exact: true })).toBeVisible();
    const anchor = await host.evaluate(async (node) => {
      window.scrollTo(0, node.scrollHeight / 2);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const row = [...node.querySelectorAll<HTMLElement>('[data-operational-window-key]')].find(
        (row) => {
          const box = row.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= window.innerHeight;
        },
      );
      if (!row) throw new Error('No admitted document anchor');
      return { key: row.dataset.operationalWindowKey, top: row.getBoundingClientRect().top };
    });
    await host.evaluate(async () => {
      for (let frame = 0; frame < 30; frame++) await new Promise(requestAnimationFrame);
    });
    const top = await host.evaluate(
      (node, key) =>
        [...node.querySelectorAll<HTMLElement>('[data-operational-window-key]')]
          .find((row) => row.dataset.operationalWindowKey === key)
          ?.getBoundingClientRect().top,
      anchor.key,
    );
    expect(top).toBeDefined();
    expect(Math.abs((top ?? Infinity) - anchor.top)).toBeLessThanOrEqual(1);
  });
}

test('zero-width clipping ancestors admit no operational rows', async ({ mount }) => {
  const host = await mount(OperationalRowWindowHost, {
    props: { count: 20, horizontallyClipped: true },
  });
  await host.evaluate(async () => {
    for (let frame = 0; frame < 20; frame++) await new Promise(requestAnimationFrame);
  });
  await expect(host.locator('[data-chat-operational-row]')).toHaveCount(0);
});

test('a prepended same-name group cannot take the active group disclosure', async ({ mount }) => {
  const original: ContentBlock[] = [
    { type: 'text', text: '<group:Work>' },
    { type: 'tool_use', id: 'a', name: 'inspect', input: {} },
  ];
  const host = await mount(OperationalRowWindowHost, {
    props: { live: true, contentOverride: original },
  });
  const groups = host.getByTestId('response-group-disclosure');
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toHaveAttribute('aria-expanded', 'false');
  await groups.first().click();
  await expect(groups.first()).toHaveAttribute('aria-expanded', 'true');
  await host.update({
    props: {
      live: true,
      contentOverride: [
        { type: 'text', text: '<group:Work>Earlier unrelated description</group>' },
        ...original,
      ],
    },
  });
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(groups.nth(1)).toHaveAttribute('aria-expanded', 'true');
});

for (const renderer of ['streaming', 'settled'] as const) {
  test(`${renderer}: reversing a live group outro reattaches rows within the shared frame allowance`, async ({
    mount,
  }) => {
    const component = await mount(StreamingResponseGroupLifecycleHost, { props: { renderer } });
    const trigger = component.getByTestId('response-group-disclosure');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await component.update({ props: { renderer, phase: 'live', isStreaming: true } });
    await expect(
      component.locator('[data-operational-preview-content] [data-response-group-child]'),
    ).toHaveCount(6);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(
      component.locator('[data-operational-expanded-content] [data-response-group-child]'),
    ).toHaveCount(6);
    await expect(
      component.getByText(
        'I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
      ),
    ).toBeVisible();
  });
}
