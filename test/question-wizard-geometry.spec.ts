import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

test.describe.configure({ mode: 'serial' });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

type HostProps = {
  collapsed?: boolean;
  optionCount?: number;
  questionCount?: number;
  safeArea?: number;
  longChat?: boolean;
  longHeader?: boolean;
  multiSelect?: boolean;
};

async function mountWizard(
  page: Page,
  viewport: { width: number; height: number },
  props: HostProps,
  options: { theme?: 'light' | 'dark'; zoom?: number } = {},
) {
  const zoom = options.zoom ?? 1;
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: options.theme ?? 'light' });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.evaluate(
    async ({ props: hostProps, theme, zoom: scale }) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      const [{ mount, tick }, { default: Host }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/QuestionWizardGeometryHost.svelte'),
      ]);
      document.documentElement.className = theme;
      document.documentElement.style.height = '100%';
      document.body.style.cssText = 'margin:0;width:100%;height:100%;overflow:hidden;';
      document.body.replaceChildren();
      const target = document.createElement('div');
      target.style.cssText = `width:${100 / scale}%;height:${100 / scale}%;zoom:${scale};`;
      document.body.append(target);
      mount(Host, { target, props: hostProps });
      await tick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { props, theme: options.theme ?? 'light', zoom },
  );
}

async function readGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const boundary = rect('[data-testid="conversation-composer-boundary"]');
    const wrapper = rect('[data-testid="question-wizard-slot"]');
    const card = rect('[data-testid="question-wizard-card"]');
    const safeArea = rect('[data-testid="platform-safe-area"]');
    const footerNode = document.querySelector<HTMLElement>(
      '[data-testid="question-wizard-footer"]',
    );
    const footer = footerNode?.getBoundingClientRect();
    const buttons = footerNode
      ? [...footerNode.querySelectorAll<HTMLElement>('button')].map((button) =>
          button.getBoundingClientRect(),
        )
      : [];
    const cardStyle = getComputedStyle(
      document.querySelector<HTMLElement>('[data-testid="question-wizard-card"]')!,
    );
    const boundaryStyle = getComputedStyle(
      document.querySelector<HTMLElement>('[data-testid="conversation-composer-boundary"]')!,
    );
    const headerNode = document.querySelector<HTMLElement>('[data-question-wizard-header]');
    const titleNode = document.querySelector<HTMLElement>('[data-question-header-title]');
    const counterNode = document.querySelector<HTMLElement>('[data-question-step-counter]');
    const actionsNode = document.querySelector<HTMLElement>('[data-question-header-actions]');
    const skipNode = [...(footerNode?.querySelectorAll<HTMLElement>('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Skip',
    );
    const submitNode = footerNode?.querySelector<HTMLElement>('[data-slot="button"]');
    const compactRect = (node: HTMLElement | null | undefined) => {
      if (!node) return null;
      const nodeRect = node.getBoundingClientRect();
      return {
        left: nodeRect.left,
        right: nodeRect.right,
        centerY: nodeRect.top + nodeRect.height / 2,
      };
    };
    return {
      boundary: { left: boundary.left, right: boundary.right, bottom: boundary.bottom },
      wrapper: { bottom: wrapper.bottom },
      card: { left: card.left, right: card.right, bottom: card.bottom, height: card.height },
      footer: footer
        ? {
            bottom: footer.bottom,
            topInset: Math.min(...buttons.map((button) => button.top)) - footer.top,
            bottomInset: footer.bottom - Math.max(...buttons.map((button) => button.bottom)),
          }
        : null,
      safeArea: safeArea.height,
      boxShadow: cardStyle.boxShadow,
      borderBottomWidth: cardStyle.borderBottomWidth,
      boundaryOverflow: `${boundaryStyle.overflowX}/${boundaryStyle.overflowY}`,
      header: headerNode
        ? {
            rect: compactRect(headerNode),
            title: compactRect(titleNode),
            counter: compactRect(counterNode),
            actions: compactRect(actionsNode),
            titleTruncated: titleNode ? titleNode.scrollWidth > titleNode.clientWidth : false,
          }
        : null,
      footerTypography:
        skipNode && submitNode
          ? {
              skipFontSize: getComputedStyle(skipNode).fontSize,
              skipLineHeight: getComputedStyle(skipNode).lineHeight,
              submitFontSize: getComputedStyle(submitNode).fontSize,
              submitLineHeight: getComputedStyle(submitNode).lineHeight,
            }
          : null,
    };
  });
}

function expectFlushGeometry(geometry: Awaited<ReturnType<typeof readGeometry>>, safeArea: number) {
  expect(geometry.boundary.bottom - geometry.wrapper.bottom).toBeCloseTo(0, 1);
  expect(geometry.wrapper.bottom - geometry.card.bottom).toBeCloseTo(0, 1);
  expect(geometry.safeArea).toBeCloseTo(safeArea, 1);
  expect(geometry.card.left).toBeGreaterThanOrEqual(geometry.boundary.left - 1);
  expect(geometry.card.right).toBeLessThanOrEqual(geometry.boundary.right + 1);
  expect(geometry.boxShadow).not.toBe('none');
  expect(geometry.borderBottomWidth).toBe('1px');
  expect(geometry.boundaryOverflow).toBe('visible/visible');
}

test('expanded card is flush with a compact symmetric footer across rendered geometries', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const cases = [
    { viewport: { width: 960, height: 720 }, props: { optionCount: 3, questionCount: 3 } },
    {
      viewport: { width: 390, height: 560 },
      props: { optionCount: 1, questionCount: 1, safeArea: 18 },
      theme: 'dark' as const,
    },
    {
      viewport: { width: 960, height: 1200 },
      props: { optionCount: 1, questionCount: 1 },
      zoom: 2,
    },
  ];

  for (const scenario of cases) {
    await mountWizard(page, scenario.viewport, scenario.props, scenario);
    const geometry = await readGeometry(page);
    expectFlushGeometry(geometry, scenario.props.safeArea ?? 0);
    expect(geometry.footer).not.toBeNull();
    expect(geometry.card.bottom - geometry.footer!.bottom).toBeLessThanOrEqual(2);
    expect(geometry.footer!.topInset).toBeCloseTo(geometry.footer!.bottomInset, 1);
    expect(geometry.footer!.topInset).toBeGreaterThanOrEqual(8);
  }
});

test('compact header stays on one row and footer actions share typography', async ({ page }) => {
  const cases: Array<{
    viewport: { width: number; height: number };
    props: HostProps;
    theme?: 'light' | 'dark';
    zoom?: number;
  }> = [
    { viewport: { width: 960, height: 720 }, props: { questionCount: 3 } },
    {
      viewport: { width: 390, height: 560 },
      props: { questionCount: 1, longHeader: true },
      theme: 'dark',
    },
    {
      viewport: { width: 960, height: 1200 },
      props: { questionCount: 1, longHeader: true },
      zoom: 2,
    },
  ];

  for (const scenario of cases) {
    await mountWizard(page, scenario.viewport, scenario.props, scenario);
    const geometry = await readGeometry(page);
    expect(geometry.header).not.toBeNull();
    expect(geometry.header!.title!.right).toBeLessThanOrEqual(geometry.header!.actions!.left);
    expect(geometry.header!.title!.centerY).toBeCloseTo(geometry.header!.actions!.centerY, 1);
    if (scenario.props.questionCount === 1) {
      expect(geometry.header!.counter).toBeNull();
    } else {
      expect(geometry.header!.counter!.right).toBeLessThanOrEqual(geometry.header!.title!.left);
      expect(geometry.header!.counter!.centerY).toBeCloseTo(geometry.header!.title!.centerY, 1);
    }
    if (scenario.props.longHeader) expect(geometry.header!.titleTruncated).toBe(true);
    expect(geometry.footerTypography!.skipFontSize).toBe(geometry.footerTypography!.submitFontSize);
    expect(geometry.footerTypography!.skipLineHeight).toBe(
      geometry.footerTypography!.submitLineHeight,
    );
  }
});

test('single-select rows use native full-row keyboard selection without radio indicators', async ({
  page,
}) => {
  await mountWizard(
    page,
    { width: 390, height: 560 },
    { optionCount: 2, questionCount: 1, multiSelect: false },
    { theme: 'dark' },
  );

  const options = page.locator('[data-question-option]');
  await expect(options).toHaveCount(2);
  await expect(page.locator('[data-option-indicator]')).toHaveCount(0);

  await options.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'true');

  await options.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true');

  const widths = await options.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).getBoundingClientRect().width),
  );
  expect(widths.every((width) => width > 300)).toBe(true);
});

test('collapsed and scrolling states keep the slot flush without clipping or scroll jumps', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mountWizard(
    page,
    { width: 390, height: 420 },
    { collapsed: true, optionCount: 3, questionCount: 3, safeArea: 12 },
    { theme: 'dark' },
  );
  const collapsed = await readGeometry(page);
  expectFlushGeometry(collapsed, 12);
  expect(collapsed.footer).toBeNull();
  expect(collapsed.card.height).toBeLessThan(64);

  await mountWizard(page, { width: 960, height: 560 }, { longChat: true, safeArea: 12 });
  const scrolling = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="chat-scroll-region"]')!;
    const composer = document
      .querySelector<HTMLElement>('[data-testid="conversation-composer-boundary"]')!
      .getBoundingClientRect();
    scroller.scrollTop = scroller.scrollHeight;
    const after = document
      .querySelector<HTMLElement>('[data-testid="conversation-composer-boundary"]')!
      .getBoundingClientRect();
    return {
      scrollable: scroller.scrollHeight > scroller.clientHeight,
      reachedBottom: scroller.scrollTop === scroller.scrollHeight - scroller.clientHeight,
      composerTopBefore: composer.top,
      composerTopAfter: after.top,
    };
  });
  expect(scrolling.scrollable).toBe(true);
  expect(scrolling.reachedBottom).toBe(true);
  expect(scrolling.composerTopAfter).toBeCloseTo(scrolling.composerTopBefore, 1);
  expectFlushGeometry(await readGeometry(page), 12);
});
