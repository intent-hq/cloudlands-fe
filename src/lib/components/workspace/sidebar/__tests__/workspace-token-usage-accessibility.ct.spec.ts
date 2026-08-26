import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceTokenUsageAccessibilityHost from './WorkspaceTokenUsageAccessibilityHost.svelte';

type Rgba = [number, number, number, number];

function luminance([red, green, blue]: Rgba): number {
  const channels = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('exposes compact values and keeps summary text readable on hover', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 280 },
  });
  const disclosure = component.locator('button[aria-controls^="workspace-token-usage-details-"]');

  await expect(disclosure).toHaveAccessibleDescription('1K tokens used');
  await disclosure.focus();
  await disclosure.press('Space');
  await expect(disclosure).toHaveAccessibleName('Collapse token usage details');
  await expect(disclosure).toHaveAccessibleDescription('1K tokens used');
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAccessibleName('Expand token usage details');
  await disclosure.click();
  await expect(disclosure).toHaveAccessibleName('Collapse token usage details');
  await expect(disclosure.locator('svg')).toHaveCount(0);
  const reducedDurations = await Promise.all([
    disclosure.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ]);
  expect(reducedDurations.every((duration) => duration <= 0.001)).toBe(true);

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme, width: 280 } });
    await expect(component).toHaveAttribute('data-theme', theme);
    await disclosure.hover();
    const textColors = await disclosure
      .locator('#workspace-token-usage-processed-token-usage-accessibility-ct > span')
      .evaluateAll((elements) => {
        const paint = (values: string[]): [number, number, number, number] => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext('2d')!;
          for (const value of values) {
            context.fillStyle = value;
            context.fillRect(0, 0, 1, 1);
          }
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        return elements.map((element) => {
          const backgrounds: string[] = [];
          for (let node: Element | null = element; node; node = node.parentElement) {
            backgrounds.push(getComputedStyle(node).backgroundColor);
          }
          return {
            label: element.textContent?.trim() ?? '',
            foreground: paint([getComputedStyle(element).color]),
            background: paint(backgrounds.reverse()),
          };
        });
      });

    for (const colors of textColors) {
      expect(
        contrastRatio(colors.foreground, colors.background),
        `${theme} hover: ${colors.label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('navigates exact stacked totals with accessible pointer, focus, theme, and touch behavior', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 304 },
  });
  const disclosure = component.getByTestId('token-usage-disclosure');
  await disclosure.click();

  const details = component.getByTestId('token-usage-details');
  const previewStatus = details.locator('.preview-status');
  const compositionRows = details.locator('.token-composition-row');
  const messageRows = details.locator('.message-composition-row');
  const agentSection = component.getByTestId('token-usage-by-agent');
  const agentButtons = agentSection.locator('.breakdown-item-control');
  const agentAlpha = agentButtons.first();
  const agentBeta = agentButtons.nth(1);
  const modelButtons = component
    .getByTestId('token-usage-by-model')
    .locator('.breakdown-item-control');
  const longModel = modelButtons.first();
  const finalModel = modelButtons.last();
  const compositionValues = () =>
    compositionRows.evaluateAll((rows) =>
      rows.map((row) => ({
        value: row.querySelector('.composition-value')?.textContent?.trim(),
        share: row.querySelector('.composition-context')?.textContent?.trim(),
      })),
    );

  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  await expect(agentAlpha).toHaveAttribute('aria-current', 'true');

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme, width: 304 } });
    await agentAlpha.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
    await expect(agentAlpha).toHaveAttribute('aria-current', 'true');
    expect(await compositionValues()).toEqual([
      { value: '550', share: '73.3%' },
      { value: '50', share: '6.7%' },
      { value: '150', share: '20%' },
      { value: '0', share: '0%' },
    ]);
    const activeStyle = await agentAlpha.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      transitionDuration: Number.parseFloat(getComputedStyle(element).transitionDuration),
    }));
    expect(activeStyle.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(activeStyle.transitionDuration).toBeLessThanOrEqual(0.001);
    await agentAlpha.dispatchEvent('pointerleave', { pointerType: 'mouse' });
    await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  }

  await agentBeta.focus();
  await expect(agentBeta).toBeFocused();
  await expect(previewStatus).toContainText('By agent Agent beta-02 150 processed');
  expect(await compositionValues()).toEqual([
    { value: '50', share: '33.3%' },
    { value: '30', share: '20%' },
    { value: '70', share: '46.7%' },
    { value: '0', share: '0%' },
  ]);
  await expect(messageRows.nth(0)).toHaveText(/Human messages\s+3/);
  await expect(messageRows.nth(1)).toHaveText(/Agent messages\s+6/);
  await agentBeta.blur();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');

  await finalModel.focus();
  await expect(finalModel).toBeFocused();
  await expect(previewStatus).toContainText('By model Model Production Final 50 processed');
  expect(await compositionValues()).toEqual([
    { value: '30', share: '60%' },
    { value: '5', share: '10%' },
    { value: '15', share: '30%' },
    { value: '0', share: '0%' },
  ]);
  await expect(details.locator('.composition-strip')).toHaveCount(0);

  await longModel.focus();
  const selectedLongModel = component
    .getByTestId('token-usage-by-model')
    .locator('.navigator-selection [title]');
  await expect(selectedLongModel).toHaveAttribute(
    'title',
    'provider/this-is-an-extraordinarily-long-model-name-for-truncation',
  );
  expect(
    await selectedLongModel.evaluate((element) => ({
      isTruncated: element.scrollWidth > element.clientWidth,
      textOverflow: getComputedStyle(element).textOverflow,
    })),
  ).toEqual({ isTruncated: true, textOverflow: 'ellipsis' });
  await finalModel.focus();
  await finalModel.blur();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');

  await agentBeta.dispatchEvent('pointerenter', { pointerType: 'touch' });
  await agentBeta.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await agentBeta.focus();
  await expect(previewStatus).toContainText('By agent Agent beta-02 150 processed');
  await agentBeta.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');

  await page.keyboard.press('Tab');
  await longModel.focus();
  await expect(previewStatus).toContainText('By model');
});

test('renders the full reference table as a wide overlay from the real workspace sidebar', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'dark', width: 304 },
  });
  const sidebar = component.getByTestId('workspace-sidebar');
  const sidebarRegion = component.getByTestId('token-usage-test-width');
  const workspaceContent = component.getByTestId('workspace-content');
  const shell = component.getByTestId('workspace-token-usage');
  const disclosure = component.getByTestId('token-usage-disclosure');

  const [closedBox, disclosureBox, sidebarBox, sidebarRegionBox, contentBox, summaryMetrics] =
    await Promise.all([
      shell.boundingBox(),
      disclosure.boundingBox(),
      sidebar.boundingBox(),
      sidebarRegion.boundingBox(),
      workspaceContent.boundingBox(),
      disclosure.evaluate((element) => {
        const processed = element.querySelector('[id^="workspace-token-usage-processed-"]')!;
        const tokenLabel = processed.querySelector('.summary-token-label')!;
        const processedValue = element.querySelector(
          '[id^="workspace-token-usage-processed-"] > span:not(.sr-only)',
        )!;
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: Number.parseFloat(style.borderRadius),
          borderColor: style.borderColor,
          processedFontSize: Number.parseFloat(getComputedStyle(processedValue).fontSize),
          processedFontWeight: getComputedStyle(processedValue).fontWeight,
          tokenLabelDisplay: getComputedStyle(tokenLabel).display,
          tokenLabelFontSize: Number.parseFloat(getComputedStyle(tokenLabel).fontSize),
          tokenLabelFontWeight: getComputedStyle(tokenLabel).fontWeight,
          tokenLabelText: tokenLabel.textContent?.trim(),
          tokenLabelTransform: getComputedStyle(tokenLabel).textTransform,
        };
      }),
    ]);
  expect(closedBox).not.toBeNull();
  expect(disclosureBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarRegionBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(sidebarBox!.width).toBeCloseTo(352, 0);
  expect(sidebarRegionBox!.width).toBeCloseTo(304, 0);
  expect(closedBox!.height).toBeGreaterThanOrEqual(34);
  expect(closedBox!.height).toBeLessThanOrEqual(36);
  expect(disclosureBox!.width).toBeCloseTo(304, 0);
  expect(summaryMetrics.borderRadius).toBeGreaterThanOrEqual(2);
  expect(summaryMetrics.borderRadius).toBeLessThanOrEqual(5);
  expect(summaryMetrics.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(summaryMetrics.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(summaryMetrics).toMatchObject({
    processedFontSize: 14,
    processedFontWeight: '400',
    tokenLabelDisplay: 'block',
    tokenLabelFontSize: 14,
    tokenLabelFontWeight: '400',
    tokenLabelText: 'tokens used',
    tokenLabelTransform: 'none',
  });
  await expect(disclosure.getByText('tokens used', { exact: true })).toBeVisible();
  await expect(disclosure.getByText('Cached', { exact: true })).toHaveCount(0);

  await disclosure.click();
  const agentSection = component.getByTestId('token-usage-by-agent');
  const modelSection = component.getByTestId('token-usage-by-model');
  const details = component.getByTestId('token-usage-details');
  const composition = details.locator('section[aria-labelledby$="-composition"]');
  const compositionHeader = composition.locator('.composition-header');
  const compositionRows = details.locator('.composition-row');
  const tokenCompositionRows = details.locator('.token-composition-row');
  const messageCompositionRows = details.locator('.message-composition-row');
  const agentRows = agentSection.getByRole('listitem');
  const modelRows = modelSection.getByRole('listitem');
  const detailsMetrics = await details.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: Number.parseFloat(style.borderRadius),
      position: style.position,
      zIndex: Number.parseInt(style.zIndex, 10),
    };
  });

  const accessibleOnlyChrome = details.locator('h4.sr-only, .preview-status.sr-only');
  await expect(accessibleOnlyChrome).toHaveCount(4);
  expect(
    await accessibleOnlyChrome.evaluateAll((elements) =>
      elements.every((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width <= 1 && box.height <= 1 && style.position === 'absolute';
      }),
    ),
  ).toBe(true);
  expect(detailsMetrics.borderRadius).toBeGreaterThanOrEqual(4);
  expect(detailsMetrics.borderRadius).toBeLessThanOrEqual(7);
  expect(detailsMetrics.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(detailsMetrics.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(detailsMetrics).toMatchObject({
    position: 'fixed',
    zIndex: 60,
  });
  await expect(details).toContainText('By agent Agent alpha-01 750 processed');
  await expect(compositionRows).toHaveCount(6);
  await expect(compositionHeader).toHaveText(/Metric\s+Value\s+Share/);
  await expect(compositionRows.nth(0)).toContainText('Cached context');
  await expect(compositionRows.nth(1)).toContainText('Input context');
  await expect(compositionRows.nth(2)).toContainText('Human messages');
  await expect(compositionRows.nth(3)).toContainText('Agent messages');
  await expect(compositionRows.nth(4)).toContainText('Model output');
  await expect(compositionRows.nth(5)).toContainText('Reasoning tokens');
  await expect(messageCompositionRows.nth(0)).toHaveText(/Human messages\s+4/);
  await expect(messageCompositionRows.nth(1)).toHaveText(/Agent messages\s+7/);
  await expect(compositionRows.locator('.composition-metric [aria-hidden="true"]')).toHaveCount(0);
  await expect(composition.locator('.composition-description')).toHaveCount(0);
  await expect(agentSection).toBeVisible();
  await expect(modelSection).toBeVisible();
  await expect(agentRows).toHaveCount(4);
  await expect(modelRows).toHaveCount(4);
  await expect(agentRows.first()).toBeVisible();
  await expect(modelRows.first()).toBeVisible();
  await expect(agentSection.locator('.navigator-selection')).toContainText('Agent alpha-01 75%');
  await expect(modelSection.locator('.navigator-selection')).toContainText(
    'Provider/this Is An Extraordinarily Long Model Name For Truncation 60%',
  );
  await expect(agentRows.locator('.breakdown-item-control')).toHaveCount(4);
  await expect(modelRows.locator('.breakdown-item-control')).toHaveCount(4);
  await expect(component.getByTestId('token-usage-message-counts')).toHaveCount(0);
  await expect(composition.locator('.composition-strip')).toHaveCount(0);

  const [
    detailsBox,
    openSidebarBox,
    openContentBox,
    dimensions,
    pageDimensions,
    desktopRows,
    agentBox,
    modelBox,
    navigatorStacks,
    breakdownDivider,
    compositionAlignment,
    compositionHeaderAlignment,
    breakdownAlignment,
  ] = await Promise.all([
    details.boundingBox(),
    sidebar.boundingBox(),
    workspaceContent.boundingBox(),
    shell.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    })),
    page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    tokenCompositionRows.evaluateAll((rows) =>
      rows.map((row) => {
        const box = (selector: string) =>
          row.querySelector(selector)!.getBoundingClientRect().toJSON();
        const metricElement = row.querySelector('.composition-metric')!;
        const valueElement = row.querySelector('.composition-value')!;
        const contextElement = row.querySelector('.composition-context')!;
        return {
          row: row.getBoundingClientRect().toJSON(),
          metric: box('.composition-metric'),
          metricFontSize: Number.parseFloat(getComputedStyle(metricElement).fontSize),
          metricClientWidth: metricElement.clientWidth,
          metricScrollWidth: metricElement.scrollWidth,
          value: box('.composition-value'),
          context: box('.composition-context'),
          valueAlign: getComputedStyle(valueElement).textAlign,
          contextAlign: getComputedStyle(contextElement).textAlign,
          valueColor: getComputedStyle(valueElement).color,
          contextColor: getComputedStyle(contextElement).color,
          valueFontWeight: getComputedStyle(valueElement).fontWeight,
          contextFontWeight: getComputedStyle(contextElement).fontWeight,
          contextDisplay: getComputedStyle(row.querySelector('.composition-context')!).display,
        };
      }),
    ),
    agentSection.boundingBox(),
    modelSection.boundingBox(),
    details.locator('.breakdown-stack').evaluateAll((stacks) =>
      stacks.map((stack) => {
        const stackBox = stack.getBoundingClientRect();
        const segments = Array.from(stack.children).map((segment) =>
          segment.getBoundingClientRect().toJSON(),
        );
        const controls = Array.from(stack.querySelectorAll('.breakdown-item-control')).map(
          (control) => {
            const box = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return {
              top: box.top,
              bottom: box.bottom,
              display: style.display,
              backgroundImage: style.backgroundImage,
              borderTopWidth: style.borderTopWidth,
              borderBottomWidth: style.borderBottomWidth,
            };
          },
        );
        const firstStyle = getComputedStyle(stack.firstElementChild!);
        const lastStyle = getComputedStyle(stack.lastElementChild!);
        return {
          box: stackBox.toJSON(),
          segmentCount: segments.length,
          controls,
          segmentWidth: segments.reduce((sum, segment) => sum + segment.width, 0),
          overflowX: getComputedStyle(stack).overflowX,
          borderRadius: getComputedStyle(stack).borderRadius,
          firstRadius: firstStyle.borderTopLeftRadius,
          lastRadius: lastStyle.borderTopRightRadius,
          lastRight: segments.at(-1)!.x + segments.at(-1)!.width,
        };
      }),
    ),
    details.locator('.breakdown-grid').evaluate((grid) => {
      const divider = getComputedStyle(grid, '::after');
      const secondSection = grid.querySelector('.breakdown-section + .breakdown-section')!;
      return {
        content: divider.content,
        backgroundColor: divider.backgroundColor,
        secondSectionBorderLeftWidth: getComputedStyle(secondSection).borderLeftWidth,
      };
    }),
    composition.evaluate((section) => {
      const row = section.querySelector('.composition-row')!.getBoundingClientRect();
      return {
        rowLeft: row.left,
      };
    }),
    compositionHeader.evaluate((header) =>
      Array.from(header.children).map((cell) => cell.getBoundingClientRect().toJSON()),
    ),
    details.locator('.breakdown-section').evaluateAll((sections) =>
      sections.map((section) => {
        const selection = section.querySelector('.navigator-selection')!;
        return {
          section: section.getBoundingClientRect().toJSON(),
          selection: selection.getBoundingClientRect().toJSON(),
          bar: section.querySelector('.breakdown-stack')!.getBoundingClientRect().toJSON(),
          percentColor: getComputedStyle(selection.lastElementChild!).color,
          percentFontWeight: getComputedStyle(selection.lastElementChild!).fontWeight,
        };
      }),
    ),
  ]);

  expect(detailsBox).not.toBeNull();
  expect(detailsBox!.width).toBeCloseTo(452, 0);
  expect(detailsBox!.x).toBeCloseTo(disclosureBox!.x, 0);
  expect(detailsBox!.y).toBeCloseTo(disclosureBox!.y + disclosureBox!.height + 8, 0);
  expect(detailsBox!.width / disclosureBox!.width).toBeCloseTo(1.49, 2);
  expect(openSidebarBox).toEqual(sidebarBox);
  expect(openContentBox).toEqual(contentBox);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(pageDimensions.scrollWidth).toBeLessThanOrEqual(pageDimensions.clientWidth);
  expect(agentBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(Math.abs(agentBox!.y - modelBox!.y)).toBeLessThanOrEqual(1);
  expect(agentBox!.width).toBeCloseTo(modelBox!.width, 0);
  expect(detailsBox!.height).toBeGreaterThanOrEqual(220);
  expect(detailsBox!.height).toBeLessThanOrEqual(300);
  expect(agentBox!.height).toBeGreaterThanOrEqual(40);
  expect(modelBox!.height).toBeGreaterThanOrEqual(40);
  expect(breakdownDivider.content).toBe('none');
  expect(breakdownDivider.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(breakdownDivider.secondSectionBorderLeftWidth).toBe('0px');
  expect(
    Math.abs(breakdownAlignment[0].selection.left - compositionAlignment.rowLeft),
  ).toBeLessThanOrEqual(1);
  expect(
    breakdownAlignment.every(
      ({ section, selection, bar, percentFontWeight }) =>
        Math.abs(bar.left - selection.left) <= 1 &&
        bar.top >= selection.top + selection.height + 5 &&
        bar.right <= section.right + 1 &&
        percentFontWeight === '400',
    ),
  ).toBe(true);
  expect(breakdownAlignment[0].percentColor).toBe(breakdownAlignment[1].percentColor);
  expect(breakdownAlignment[1].selection.left).toBeCloseTo(
    detailsBox!.x + detailsBox!.width / 2 + 16,
    0,
  );
  expect(
    navigatorStacks.every(
      ({
        box,
        segmentCount,
        controls,
        segmentWidth,
        overflowX,
        borderRadius,
        firstRadius,
        lastRadius,
        lastRight,
      }) =>
        box.height === 10 &&
        segmentCount === 4 &&
        controls.every(
          (control) =>
            Math.abs(control.top - box.top) <= 0.01 &&
            Math.abs(control.bottom - box.bottom) <= 0.01 &&
            control.display === 'block' &&
            control.backgroundImage === 'none' &&
            control.borderTopWidth === '0px' &&
            control.borderBottomWidth === '0px',
        ) &&
        Math.abs(segmentWidth - box.width) <= 1 &&
        overflowX === 'hidden' &&
        borderRadius === '2px' &&
        firstRadius === '2px' &&
        lastRadius === '2px' &&
        lastRight <= box.x + box.width + 1,
    ),
  ).toBe(true);
  expect(compositionHeaderAlignment).toHaveLength(3);
  expect(compositionHeaderAlignment[0].x).toBeCloseTo(desktopRows[0].metric.x, 0);
  expect(compositionHeaderAlignment[1].right).toBeCloseTo(
    desktopRows[0].value.x + desktopRows[0].value.width,
    0,
  );
  expect(compositionHeaderAlignment[2].right).toBeCloseTo(
    desktopRows[0].context.x + desktopRows[0].context.width,
    0,
  );
  const navigatorButtons = details.locator('.breakdown-item-control');
  await expect(navigatorButtons).toHaveCount(8);
  await navigatorButtons.last().focus();
  await expect(navigatorButtons.last()).toBeFocused();
  const focusedBarStyle = await navigatorButtons.last().evaluate((button) => {
    const stack = button.closest('.breakdown-stack')!;
    return {
      buttonBoxShadow: getComputedStyle(button).boxShadow,
      stackOutlineStyle: getComputedStyle(stack).outlineStyle,
      stackOutlineWidth: getComputedStyle(stack).outlineWidth,
    };
  });
  expect(focusedBarStyle).toEqual({
    buttonBoxShadow: 'none',
    stackOutlineStyle: 'solid',
    stackOutlineWidth: '2px',
  });
  expect(
    desktopRows.every(
      ({
        row,
        metric,
        metricFontSize,
        metricClientWidth,
        metricScrollWidth,
        value,
        context,
        valueAlign,
        contextAlign,
        valueColor,
        contextColor,
        valueFontWeight,
        contextFontWeight,
        contextDisplay,
      }) =>
        row.height >= 28 &&
        row.height <= 32 &&
        metricFontSize === 14 &&
        metricScrollWidth <= metricClientWidth &&
        contextDisplay !== 'none' &&
        valueAlign === 'right' &&
        contextAlign === 'right' &&
        valueColor === contextColor &&
        valueFontWeight === '400' &&
        contextFontWeight === '400' &&
        metric.x < value.x &&
        value.x < context.x &&
        Math.abs(metric.y - value.y) <= 1 &&
        Math.abs(value.y - context.y) <= 1,
    ),
  ).toBe(true);
  const valueRightEdges = desktopRows.map(({ value }) => value.x + value.width);
  const contextRightEdges = desktopRows.map(({ context }) => context.x + context.width);
  expect(Math.max(...valueRightEdges) - Math.min(...valueRightEdges)).toBeLessThanOrEqual(1);
  expect(Math.max(...contextRightEdges) - Math.min(...contextRightEdges)).toBeLessThanOrEqual(1);
  const topmost = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('[data-testid="token-usage-details"]')
        ?.getAttribute('data-testid'),
    {
      x: Math.max(contentBox!.x + 24, detailsBox!.x + detailsBox!.width - 48),
      y: detailsBox!.y + 24,
    },
  );
  expect(topmost).toBe('token-usage-details');

  await component.update({ props: { theme: 'dark', width: 452 } });
  const [wideSidebarRegion, wideDetails, wideSummaryMetrics] = await Promise.all([
    sidebarRegion.boundingBox(),
    details.boundingBox(),
    disclosure.evaluate((element) => {
      const tokenLabel = element.querySelector('.summary-token-label')!;
      const processedValue = element.querySelector(
        '[id^="workspace-token-usage-processed-"] > span:not(.summary-token-label)',
      )!;
      return {
        tokenLabelDisplay: getComputedStyle(tokenLabel).display,
        tokenLabelFontSize: getComputedStyle(tokenLabel).fontSize,
        processedFontSize: getComputedStyle(processedValue).fontSize,
      };
    }),
  ]);
  expect(wideSidebarRegion!.width).toBeCloseTo(452, 0);
  expect(wideDetails!.width).toBeCloseTo(452, 0);
  expect(wideSummaryMetrics.tokenLabelDisplay).toBe('block');
  expect(wideSummaryMetrics.tokenLabelFontSize).toBe(wideSummaryMetrics.processedFontSize);

  await navigatorButtons.last().blur();
  await component.update({ props: { theme: 'dark', width: 280 } });
  const [
    narrowSidebarRegion,
    narrowDetails,
    narrowRows,
    narrowAgentBox,
    narrowModelBox,
    longModel,
  ] = await Promise.all([
    sidebarRegion.boundingBox(),
    details.boundingBox(),
    tokenCompositionRows.evaluateAll((rows) =>
      rows.map((row) => {
        const box = (selector: string) => row.querySelector(selector)!.getBoundingClientRect();
        const metric = box('.composition-metric');
        const value = box('.composition-value');
        const context = box('.composition-context');
        return {
          ys: [metric.y, value.y, context.y],
          valueRight: value.right,
          contextRight: context.right,
          contextDisplay: getComputedStyle(row.querySelector('.composition-context')!).display,
        };
      }),
    ),
    agentSection.boundingBox(),
    modelSection.boundingBox(),
    modelSection
      .locator(
        '.navigator-selection [title="provider/this-is-an-extraordinarily-long-model-name-for-truncation"]',
      )
      .evaluate((label) => ({
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
        overflow: getComputedStyle(label).overflow,
        textOverflow: getComputedStyle(label).textOverflow,
        whiteSpace: getComputedStyle(label).whiteSpace,
      })),
  ]);
  expect(narrowSidebarRegion!.width).toBeCloseTo(280, 0);
  expect(narrowDetails!.width).toBeCloseTo(452, 0);
  expect(
    narrowRows.every(
      ({ ys, contextDisplay }) =>
        contextDisplay !== 'none' && Math.max(...ys) - Math.min(...ys) <= 1,
    ),
  ).toBe(true);
  expect(
    Math.max(...narrowRows.map(({ valueRight }) => valueRight)) -
      Math.min(...narrowRows.map(({ valueRight }) => valueRight)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...narrowRows.map(({ contextRight }) => contextRight)) -
      Math.min(...narrowRows.map(({ contextRight }) => contextRight)),
  ).toBeLessThanOrEqual(1);
  expect(narrowAgentBox).not.toBeNull();
  expect(narrowModelBox).not.toBeNull();
  expect(Math.abs(narrowAgentBox!.y - narrowModelBox!.y)).toBeLessThanOrEqual(1);
  expect(narrowAgentBox!.width).toBeCloseTo(narrowModelBox!.width, 0);
  expect(longModel.scrollWidth).toBeGreaterThan(longModel.clientWidth);
  expect(longModel).toMatchObject({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
});

test('dismisses, repositions, flips, and clamps the overlay without changing workspace geometry', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'dark', width: 304, placement: 'top', side: 'left' },
  });
  const sidebar = component.getByTestId('workspace-sidebar');
  const sidebarScroll = component.getByTestId('workspace-sidebar-scroll');
  const workspaceContent = component.getByTestId('workspace-content');
  const disclosure = component.getByTestId('token-usage-disclosure');

  await disclosure.click();
  let details = component.getByTestId('token-usage-details');
  const beforeScroll = await details.boundingBox();
  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 20 }));
  await expect
    .poll(async () => {
      const [anchor, panel] = await Promise.all([disclosure.boundingBox(), details.boundingBox()]);
      return panel!.y - (anchor!.y + anchor!.height);
    })
    .toBeCloseTo(8, 0);
  const afterScroll = await details.boundingBox();
  expect(afterScroll!.y).toBeLessThan(beforeScroll!.y);

  const contentBox = await workspaceContent.boundingBox();
  await workspaceContent.click({
    position: { x: contentBox!.width - 24, y: contentBox!.height - 24 },
  });
  await expect(details).toHaveCount(0);

  await disclosure.click();
  details = component.getByTestId('token-usage-details');
  await disclosure.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(disclosure).toBeFocused();

  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 0 }));
  await component.update({ props: { placement: 'bottom', side: 'left' } });
  await page.setViewportSize({ width: 700, height: 360 });
  await disclosure.click();
  details = component.getByTestId('token-usage-details');
  let [anchorBox, detailsBox] = await Promise.all([
    disclosure.boundingBox(),
    details.boundingBox(),
  ]);
  expect(detailsBox!.y).toBeGreaterThanOrEqual(8);
  expect(detailsBox!.y + detailsBox!.height).toBeCloseTo(anchorBox!.y - 8, 0);
  expect(detailsBox!.height).toBeLessThanOrEqual(anchorBox!.y - 16);

  await sidebar.evaluate((element) => {
    element.style.position = 'absolute';
    element.style.right = '0';
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect.poll(async () => (await sidebar.boundingBox())!.x).toBeGreaterThan(300);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect
    .poll(async () => {
      const box = await details.boundingBox();
      return box!.x + box!.width;
    })
    .toBeCloseTo(692, 0);
  [anchorBox, detailsBox] = await Promise.all([disclosure.boundingBox(), details.boundingBox()]);
  expect(detailsBox!.x).toBeLessThan(anchorBox!.x);
  expect(detailsBox!.x).toBeGreaterThanOrEqual(8);

  await sidebar.evaluate((element) => {
    element.style.position = '';
    element.style.right = '';
  });
  await component.update({
    props: { theme: 'dark', width: 304, placement: 'top', side: 'left' },
  });
  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 0 }));
  await page.setViewportSize({ width: 280, height: 520 });
  const compositionRows = details.locator('.token-composition-row');
  const agentSection = component.getByTestId('token-usage-by-agent');
  const modelSection = component.getByTestId('token-usage-by-model');
  const [summaryBox280, compactBox280, compactRows, agentBox, modelBox, pageDimensions280] =
    await Promise.all([
      disclosure.boundingBox(),
      details.boundingBox(),
      compositionRows.evaluateAll((rows) =>
        rows.map((row) => {
          const metric = row.querySelector('.composition-metric')!.getBoundingClientRect();
          const value = row.querySelector('.composition-value')!.getBoundingClientRect();
          const context = row.querySelector('.composition-context')!.getBoundingClientRect();
          return { metric, value, context };
        }),
      ),
      agentSection.boundingBox(),
      modelSection.boundingBox(),
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ]);
  expect(summaryBox280!.width).toBeCloseTo(232, 0);
  expect(compactBox280!.width).toBeCloseTo(264, 0);
  expect(compactBox280!.x).toBeCloseTo(8, 0);
  expect(compactBox280!.x + compactBox280!.width).toBeCloseTo(272, 0);
  expect(pageDimensions280.scrollWidth).toBeLessThanOrEqual(pageDimensions280.clientWidth);
  expect(
    compactRows.every(
      ({ metric, value, context }) =>
        Math.max(metric.y, value.y, context.y) - Math.min(metric.y, value.y, context.y) <= 1,
    ),
  ).toBe(true);
  expect(Math.abs(agentBox!.y - modelBox!.y)).toBeLessThanOrEqual(1);
  expect(agentBox!.width).toBeCloseTo(modelBox!.width, 0);

  await page.setViewportSize({ width: 248, height: 480 });
  await expect.poll(async () => (await details.boundingBox())!.width).toBeCloseTo(232, 0);
  const [summaryBox248, compactBox248, pageDimensions248] = await Promise.all([
    disclosure.boundingBox(),
    details.boundingBox(),
    page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
  ]);
  expect(summaryBox248!.width).toBeCloseTo(200, 0);
  expect(compactBox248!.width).toBeCloseTo(232, 0);
  expect(compactBox248!.x).toBeCloseTo(8, 0);
  expect(compactBox248!.x + compactBox248!.width).toBeCloseTo(240, 0);
  expect(pageDimensions248.scrollWidth).toBeLessThanOrEqual(pageDimensions248.clientWidth);
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(248, 0);
});
