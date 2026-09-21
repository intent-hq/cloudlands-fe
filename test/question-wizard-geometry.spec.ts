import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

// Each test mounts a fresh host; report every contract failure independently.
test.describe.configure({ mode: 'default' });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    cacheDir: viteHarnessCacheDir('question-wizard-geometry'),
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
      await document.fonts.ready;
      // ResizeObserver retargets the card height after layout, even with reduced motion.
      // Wait for stable frames so zoom/font layout has propagated into the wrapper.
      let previous = '';
      let stableFrames = 0;
      const deadline = performance.now() + 5_000;
      while (stableFrames < 3) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const geometry = JSON.stringify(
          [
            ...target.querySelectorAll(
              '[data-question-wizard], [data-testid="question-wizard-card"], [data-animated-height-target]',
            ),
          ].map((node) => node.getBoundingClientRect().toJSON()),
        );
        stableFrames = geometry === previous ? stableFrames + 1 : 0;
        previous = geometry;
        if (performance.now() > deadline) throw new Error('Wizard layout did not settle');
      }
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
    // Wave 11 rebuild (d7663537) delegates the expanded surface to AskUserQuestions; the
    // collapsed pill owns its own bordered surface since #2531 (898107a1).
    const expanded = document.querySelector<HTMLElement>('[data-testid="question-wizard-card"]');
    const cardNode =
      expanded ?? document.querySelector<HTMLElement>('[data-question-state="collapsed"]')!;
    const card = cardNode.getBoundingClientRect();
    const safeArea = rect('[data-testid="platform-safe-area"]');
    const skipButton = [...cardNode.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Skip',
    );
    const footerNode = skipButton
      ? (cardNode.querySelector<HTMLElement>('[data-animated-height-target]')
          ?.lastElementChild as HTMLElement)
      : null;
    const footer = footerNode?.getBoundingClientRect();
    const buttons = footerNode
      ? [...footerNode.querySelectorAll<HTMLElement>('button')].map((button) =>
          button.getBoundingClientRect(),
        )
      : [];
    const cardStyle = getComputedStyle(cardNode);
    const inputBoundary = document.querySelector<HTMLElement>(
      '[data-testid="question-wizard-card"] textarea',
    )?.parentElement;
    const indicator = document.querySelector<HTMLElement>('[data-option-indicator]');
    const borderWidths = (node: HTMLElement | null | undefined) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      return [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ];
    };
    const boundaryStyle = getComputedStyle(
      document.querySelector<HTMLElement>('[data-testid="conversation-composer-boundary"]')!,
    );
    const metadataNode = cardNode.querySelector<HTMLElement>(
      '[data-slot="ask-user-questions-metadata"]',
    );
    const titleNode = cardNode.querySelector<HTMLElement>('h3');
    const counterNode = metadataNode?.firstElementChild as HTMLElement | null;
    const footerButtons = [...(footerNode?.querySelectorAll<HTMLElement>('button') ?? [])];
    const footerButton = (label: RegExp) =>
      footerButtons.find((button) => label.test(button.textContent?.trim() ?? ''));
    const skipNode = footerButton(/^Skip$/);
    const submitNode = footerButton(/Continue|Finish/);
    // #2530/#2531 (41c3428a, 898107a1) moved Hide/Dismiss from the metadata row into the footer.
    const hideNode = footerButton(/^Hide$/);
    const dismissNode = footerButton(/^Dismiss$/);
    const compactRect = (node: HTMLElement | null | undefined) => {
      if (!node) return null;
      const nodeRect = node.getBoundingClientRect();
      return {
        left: nodeRect.left,
        right: nodeRect.right,
        top: nodeRect.top,
        bottom: nodeRect.bottom,
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
      cardBorderWidths: borderWidths(cardNode),
      inputBorderWidths: borderWidths(inputBoundary),
      indicatorBorderWidths: borderWidths(indicator),
      boundaryOverflow: `${boundaryStyle.overflowX}/${boundaryStyle.overflowY}`,
      title: compactRect(titleNode),
      metadata: metadataNode
        ? { rect: compactRect(metadataNode), counter: compactRect(counterNode) }
        : null,
      footerActions:
        footer && hideNode && dismissNode
          ? { hide: compactRect(hideNode)!, dismiss: compactRect(dismissNode)! }
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
  // #2531 (898107a1) flattens both question surfaces: no elevation shadow, 1px border.
  expect(geometry.boxShadow).toBe('none');
  expect(geometry.cardBorderWidths).toEqual(['1px', '1px', '1px', '1px']);
  expect(geometry.boundaryOverflow).toBe('visible/visible');
}

test('expanded card is flush with the shared question footer across rendered geometries', async ({
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
    // Compact primitive footer (#2531, 898107a1): 4px above, 6px below; 4px content
    // padding + 1px border.
    const scale = 'zoom' in scenario ? scenario.zoom! : 1;
    expect(geometry.card.bottom - geometry.footer!.bottom).toBeCloseTo(5 * scale, 1);
    expect(geometry.footer!.topInset).toBeCloseTo(4 * scale, 1);
    expect(geometry.footer!.bottomInset).toBeCloseTo(6 * scale, 1);
  }
});

test('metadata sits above the question and footer actions share one row and typography', async ({
  page,
}) => {
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
    // #2530 (41c3428a): the metadata row only renders the step counter, and only for
    // multi-step wizards; Hide/Dismiss moved into the footer alongside Skip/Continue.
    if (scenario.props.questionCount === 1) {
      expect(geometry.metadata).toBeNull();
    } else {
      expect(geometry.metadata).not.toBeNull();
      expect(geometry.metadata!.counter).not.toBeNull();
      expect(geometry.title!.top).toBeGreaterThanOrEqual(geometry.metadata!.rect!.bottom);
      expect(geometry.metadata!.counter!.top).toBeGreaterThanOrEqual(geometry.metadata!.rect!.top);
      expect(geometry.metadata!.counter!.bottom).toBeLessThanOrEqual(
        geometry.metadata!.rect!.bottom,
      );
    }
    expect(geometry.footerActions).not.toBeNull();
    const { hide, dismiss } = geometry.footerActions!;
    expect(hide.top).toBeGreaterThanOrEqual(geometry.title!.bottom);
    expect(Math.max(hide.bottom, dismiss.bottom)).toBeLessThanOrEqual(geometry.footer!.bottom);
    // The footer wraps at narrow widths (the zoomed case lays out at ~240 CSS px); at
    // phone width and above Hide and Dismiss share one row.
    if (!scenario.zoom) {
      expect(hide.right).toBeLessThanOrEqual(dismiss.left);
      expect(hide.centerY).toBeCloseTo(dismiss.centerY, 1);
    }
    expect(geometry.footerTypography!.skipFontSize).toBe(geometry.footerTypography!.submitFontSize);
    expect(geometry.footerTypography!.skipLineHeight).toBe(
      geometry.footerTypography!.submitLineHeight,
    );
  }
});

test('single-select radio rows submit through the keyboard and lock completed answers', async ({
  page,
}) => {
  await mountWizard(
    page,
    { width: 390, height: 560 },
    { optionCount: 2, questionCount: 1, multiSelect: false },
    { theme: 'dark' },
  );

  // Wave 11 rebuild (d7663537) exposes single choices through the radio role.
  const options = page.getByRole('radio');
  await expect(options).toHaveCount(2);
  const restingShadow = (await readGeometry(page)).boxShadow;

  await options.nth(0).focus();
  await expect(options.nth(0)).toBeFocused();
  expect((await readGeometry(page)).boxShadow).toBe(restingShadow);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel-boundary')).toHaveAttribute('data-completion-count', '1');
  await expect(page.getByTestId('panel-boundary')).toHaveAttribute(
    'data-completed-labels',
    'Option 1',
  );
  await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(options.nth(0)).toBeDisabled();
  await expect(options.nth(1)).toBeDisabled();

  await mountWizard(
    page,
    { width: 390, height: 560 },
    { optionCount: 2, questionCount: 1, multiSelect: false },
    { theme: 'dark' },
  );
  await options.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('panel-boundary')).toHaveAttribute('data-completion-count', '1');
  await expect(page.getByTestId('panel-boundary')).toHaveAttribute(
    'data-completed-labels',
    'Option 2',
  );
  await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');

  const widths = await options.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).getBoundingClientRect().width),
  );
  expect(widths.every((width) => width > 300)).toBe(true);
});

test('free-text field grows with its content to a six-line cap and keeps a manual resize', async ({
  page,
}) => {
  await mountWizard(page, { width: 720, height: 640 }, { optionCount: 2, questionCount: 2 });
  await page.evaluate(() => document.fonts.ready);

  const field = page.locator('[data-testid="question-wizard-card"] textarea');
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const metrics = () =>
    field.evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(node).lineHeight),
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      value: (node as HTMLTextAreaElement).value,
    }));

  const empty = await metrics();
  expect(empty.lineHeight).toBeGreaterThan(0);
  expect(empty.height).toBeCloseTo(empty.lineHeight, 1);

  await field.click();
  await page.keyboard.type(
    'This answer is intentionally long so that it wraps onto a second line inside the wizard field, which starts out one line tall and should grow.',
  );
  await settle();
  const wrapped = await metrics();
  expect(wrapped.height).toBeCloseTo(2 * empty.lineHeight, 1);
  expect(wrapped.scrollHeight).toBe(wrapped.clientHeight);

  for (let line = 3; line <= 10; line += 1) {
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(`line ${line}`);
  }
  await settle();
  const capped = await metrics();
  expect(capped.value.split('\n')).toHaveLength(9);
  expect(capped.height).toBeCloseTo(6 * empty.lineHeight, 1);
  expect(capped.scrollHeight).toBeGreaterThan(capped.clientHeight);

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('short');
  await settle();
  expect((await metrics()).height).toBeCloseTo(empty.lineHeight, 1);

  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height + 60, { steps: 8 });
  await page.mouse.up();
  await settle();
  const dragged = await metrics();
  expect(dragged.height).toBeGreaterThanOrEqual(empty.lineHeight + 40);

  await page.keyboard.type(' plus more typing after the drag');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('and a second line');
  await settle();
  const afterTyping = await metrics();
  expect(afterTyping.value).toBe('short plus more typing after the drag\nand a second line');
  expect(afterTyping.height).toBeCloseTo(dragged.height, 1);
  await expect(page.getByTestId('panel-boundary')).toHaveAttribute('data-completion-count', '0');

  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('');
  await settle();
  const nextStep = await metrics();
  expect(nextStep.height).toBeCloseTo(empty.lineHeight, 1);
  await expect(page.getByTestId('panel-boundary')).toHaveAttribute('data-completion-count', '0');
});

test('collapsed and scrolling states keep the slot flush without clipping or scroll jumps', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const cases = [
    { viewport: { width: 390, height: 420 } },
    { viewport: { width: 390, height: 420 }, theme: 'dark' as const },
    { viewport: { width: 960, height: 840 }, zoom: 2 },
  ];

  for (const scenario of cases) {
    await mountWizard(
      page,
      scenario.viewport,
      { collapsed: true, optionCount: 3, questionCount: 3, safeArea: 12 },
      scenario,
    );
    const collapsed = await readGeometry(page);
    expectFlushGeometry(collapsed, 12 * (scenario.zoom ?? 1));
    expect(collapsed.footer).toBeNull();
    expect(collapsed.card.height).toBeLessThan(64 * (scenario.zoom ?? 1));
  }

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

test('dismiss confirmation dialog preserves the resting question surface elevation', async ({
  page,
}) => {
  await mountWizard(page, { width: 960, height: 720 }, { questionCount: 1 });
  const restingShadow = (await readGeometry(page)).boxShadow;
  await page.getByRole('button', { name: 'Dismiss' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((node) => getComputedStyle(node).boxShadow))
    .not.toBe('none');
  await expect
    .poll(() =>
      page.getByTestId('question-wizard-card').evaluate((node) => getComputedStyle(node).boxShadow),
    )
    .toBe(restingShadow);
});
