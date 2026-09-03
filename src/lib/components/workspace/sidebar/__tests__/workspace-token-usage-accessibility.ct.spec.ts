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

for (const scenario of [
  { name: 'cross-filter rows and navigators', crossFilter: true, navigators: true, messages: 2 },
  { name: 'legacy rows and navigators', crossFilter: false, navigators: true, messages: 0 },
  { name: 'legacy rows without navigators', crossFilter: false, navigators: false, messages: 0 },
] as const) {
  test(`keeps exactly 12px below the token table with ${scenario.name}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
      props: {
        theme: 'light',
        width: 304,
        crossFilter: scenario.crossFilter,
        navigators: scenario.navigators,
      },
    });
    await component.getByTestId('token-usage-disclosure').click();

    const details = page.getByTestId('token-usage-details');
    await expect(details.locator('.message-composition-row')).toHaveCount(scenario.messages);
    await expect(details.locator('.breakdown-grid')).toHaveCount(scenario.navigators ? 1 : 0);
    const geometry = await details.evaluate((element) => {
      const composition = element.querySelector<HTMLElement>(
        'section[aria-labelledby$="-composition"]',
      )!;
      const lastRow = composition
        .querySelector('.composition-row:last-child')!
        .getBoundingClientRect();
      const navigator = element.querySelector('.breakdown-grid')?.getBoundingClientRect();
      const detailsBox = element.getBoundingClientRect();
      const detailsStyle = getComputedStyle(element);
      const innerBottom = detailsBox.bottom - Number.parseFloat(detailsStyle.borderBottomWidth);
      return {
        paddingBottom: getComputedStyle(composition).paddingBottom,
        gap: (navigator?.top ?? innerBottom) - lastRow.bottom,
      };
    });

    expect(geometry.paddingBottom).toBe('12px');
    expect(geometry.gap).toBeCloseTo(12, 2);
  });
}

test('keeps the disclosure background transparent across pointer and keyboard states', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 280 },
  });
  const disclosure = component.getByTestId('token-usage-disclosure');
  const transparent = 'rgba(0, 0, 0, 0)';
  const background = () =>
    disclosure.evaluate((element) => getComputedStyle(element).backgroundColor);

  await page.mouse.move(1000, 700);
  await expect.poll(background).toBe(transparent);

  await disclosure.hover();
  await expect.poll(background).toBe(transparent);

  await page.mouse.move(1000, 700);
  await page.keyboard.press('Tab');
  await expect(disclosure).toBeFocused();
  await expect.poll(background).toBe(transparent);

  await disclosure.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(background).toBe(transparent);

  await disclosure.hover();
  await expect.poll(background).toBe(transparent);
});

test('exposes compact values and keeps summary text readable on hover', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 280 },
  });
  const disclosure = component.locator('button[aria-controls^="workspace-token-usage-details-"]');

  await expect(disclosure).toHaveAccessibleDescription('1K tokens used');
  await disclosure.focus();
  const disclosureFocus = await disclosure.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'hsl(var(--ring))';
    document.body.append(probe);
    const ringColor = getComputedStyle(probe).color;
    probe.remove();
    return { boxShadow: getComputedStyle(element).boxShadow, ringColor };
  });
  expect(disclosureFocus.boxShadow).toContain(disclosureFocus.ringColor);
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
      .locator('span[aria-hidden="true"]')
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

  const details = page.getByTestId('token-usage-details');
  const previewStatus = details.locator('.preview-status');
  const compositionRows = details.locator('.token-composition-row');
  const messageRows = details.locator('.message-composition-row');
  const agentSection = page.getByTestId('token-usage-by-agent');
  const agentGroup = agentSection.getByRole('radiogroup', { name: 'By agent' });
  const agentButtons = agentSection.locator('.breakdown-item-control');
  const agentAlpha = agentButtons.first();
  const agentBeta = agentButtons.nth(1);
  const agentFinal = agentButtons.last();
  const modelSection = page.getByTestId('token-usage-by-model');
  const modelGroup = modelSection.getByRole('radiogroup', { name: 'By model' });
  const modelButtons = modelSection.locator('.breakdown-item-control');
  const longModel = modelButtons.first();
  const finalModel = modelButtons.last();
  const compositionValues = () =>
    compositionRows.evaluateAll((rows) =>
      rows.map((row) => ({
        value: row.querySelector('.composition-value .animated-number-value')?.textContent?.trim(),
        share: row
          .querySelector('.composition-context .animated-number-value')
          ?.textContent?.trim(),
      })),
    );
  const themeCompositionColors: string[][] = [];

  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  await expect(agentAlpha).toHaveRole('radio');
  await expect(agentAlpha).toHaveAttribute('aria-checked', 'true');
  await expect(agentAlpha).toHaveAttribute('tabindex', '0');
  await expect(agentBeta).toHaveAttribute('tabindex', '-1');
  await expect(agentGroup.getByRole('radio')).toHaveCount(4);
  await expect(modelGroup.getByRole('radio')).toHaveCount(4);

  await agentBeta.focus();
  await expect(previewStatus).toContainText('By agent Agent beta-02 150 processed');
  await page.keyboard.press('Shift+Tab');
  await expect(disclosure).toBeFocused();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  await page.keyboard.press('Tab');
  await expect(agentAlpha).toBeFocused();

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme, width: 304 } });
    await expect(component).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
    await agentAlpha.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
    await expect(agentAlpha).toHaveAttribute('aria-checked', 'true');
    expect(await compositionValues()).toEqual([
      { value: '550 tokens', share: '73% of total' },
      { value: '150', share: '20%' },
      { value: '0', share: '0%' },
      { value: '50', share: '7%' },
    ]);
    const compositionSegments = details.locator('.composition-strip-segment');
    await expect(compositionSegments).toHaveCount(3);
    const readSegmentColors = () =>
      compositionSegments.evaluateAll((segments) =>
        segments.map((segment) => ({
          metric: (segment as HTMLElement).dataset.metric,
          color: getComputedStyle(segment).backgroundColor,
        })),
      );
    if (themeCompositionColors.length > 0) {
      await expect
        .poll(async () => (await readSegmentColors()).map(({ color }) => color))
        .not.toEqual(themeCompositionColors.at(-1));
    }
    const keyColors = await compositionRows.locator('.composition-key').evaluateAll((keys) =>
      keys.map((key) => ({
        metric: (key as HTMLElement).dataset.metric,
        color: getComputedStyle(key).backgroundColor,
      })),
    );
    await expect
      .poll(readSegmentColors)
      .toEqual(keyColors.filter(({ metric }) => metric !== 'reasoning'));
    const segmentColors = await readSegmentColors();
    themeCompositionColors.push(segmentColors.map(({ color }) => color));
    expect(new Set(themeCompositionColors.at(-1)).size).toBe(3);
    expect(new Set(keyColors.map(({ color }) => color)).size).toBe(4);
    await expect(messageRows.locator('.composition-key')).toHaveCount(0);
    await agentAlpha.focus();
    const navigatorColors = await details.evaluate((element) => {
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
      const tokenColor = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = `hsl(var(${token}))`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const controls = Array.from(element.querySelectorAll<HTMLElement>('.breakdown-item-control'));
      const active = controls.filter((control) => control.dataset.previewActive === 'true');
      const inactive = controls.filter((control) => control.dataset.previewActive !== 'true');
      const surface = getComputedStyle(element).backgroundColor;
      const neutralFocusColor = tokenColor('--foreground');
      return {
        foreground: tokenColor('--foreground'),
        mutedForeground: tokenColor('--muted-foreground'),
        appRingColor: tokenColor('--ring'),
        neutralFocusColor,
        neutralFocus: paint([neutralFocusColor]),
        surface: paint([surface]),
        active: active.map((control) => ({
          color: getComputedStyle(control).backgroundColor,
          effective: paint([surface, getComputedStyle(control).backgroundColor]),
          transitionDuration: Number.parseFloat(getComputedStyle(control).transitionDuration),
        })),
        inactive: inactive.map((control) => ({
          color: getComputedStyle(control).backgroundColor,
          effective: paint([surface, getComputedStyle(control).backgroundColor]),
        })),
        percentages: Array.from(
          element.querySelectorAll<HTMLElement>('.navigator-selection > :last-child'),
        ).map((percentage) => getComputedStyle(percentage).color),
      };
    });
    expect(navigatorColors.active).toHaveLength(2);
    expect(navigatorColors.active.every(({ color }) => color === navigatorColors.foreground)).toBe(
      true,
    );
    expect(
      navigatorColors.active.every(({ transitionDuration }) => transitionDuration <= 0.001),
    ).toBe(true);
    expect(
      navigatorColors.inactive.every(({ color }) => color !== navigatorColors.foreground),
    ).toBe(true);
    expect(
      navigatorColors.percentages.every((color) => color === navigatorColors.mutedForeground),
    ).toBe(true);
    const currentAgentAlpha = agentSection.locator('.breakdown-item-control').first();
    await currentAgentAlpha.focus();
    await expect(currentAgentAlpha).toBeFocused();
    const focus = await currentAgentAlpha.evaluate((element) => {
      const stack = element.closest<HTMLElement>('.breakdown-stack')!;
      return {
        outlineColor: getComputedStyle(stack).outlineColor,
        outlineStyle: getComputedStyle(stack).outlineStyle,
        outlineWidth: getComputedStyle(stack).outlineWidth,
      };
    });
    expect(focus).toEqual({
      outlineColor: navigatorColors.neutralFocusColor,
      outlineStyle: 'solid',
      outlineWidth: '2px',
    });
    for (const colors of navigatorColors.active) {
      expect(
        contrastRatio(colors.effective, navigatorColors.surface),
        `${theme} selected`,
      ).toBeGreaterThanOrEqual(3);
    }
    for (const colors of navigatorColors.inactive) {
      expect(
        contrastRatio(colors.effective, navigatorColors.surface),
        `${theme} inactive`,
      ).toBeLessThan(3);
    }
    expect(
      contrastRatio(navigatorColors.neutralFocus, navigatorColors.surface),
      `${theme} focus`,
    ).toBeGreaterThanOrEqual(3);
    expect(focus.outlineColor).toBe(navigatorColors.foreground);
    expect(focus.outlineColor).not.toBe(navigatorColors.appRingColor);
    await currentAgentAlpha.blur();
    await agentAlpha.dispatchEvent('pointerleave', { pointerType: 'mouse' });
    await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  }
  expect(themeCompositionColors[0]).not.toEqual(themeCompositionColors[1]);

  await agentAlpha.focus();
  await agentAlpha.press('ArrowRight');
  await expect(agentBeta).toBeFocused();
  await expect(agentBeta).toHaveAttribute('aria-checked', 'true');
  await expect(agentBeta).toHaveAttribute('tabindex', '0');
  await expect(previewStatus).toContainText('By agent Agent beta-02 150 processed');
  await agentBeta.press('ArrowLeft');
  await expect(agentAlpha).toBeFocused();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  await agentAlpha.press('ArrowLeft');
  await expect(agentFinal).toBeFocused();
  await expect(previewStatus).toContainText('By agent Agent producti 25 processed');
  await agentFinal.press('ArrowRight');
  await expect(agentAlpha).toBeFocused();
  await agentAlpha.press('End');
  await expect(agentFinal).toBeFocused();
  await agentFinal.press('Home');
  await expect(agentAlpha).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(longModel).toBeFocused();
  await expect(previewStatus).toContainText(
    'By model Provider/this Is An Extraordinarily Long Model Name For Truncation 600 processed',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(agentAlpha).toBeFocused();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');

  await agentBeta.focus();
  await expect(agentBeta).toBeFocused();
  await expect(previewStatus).toContainText('By agent Agent beta-02 150 processed');
  expect(await compositionValues()).toEqual([
    { value: '50 tokens', share: '33% of total' },
    { value: '70', share: '47%' },
    { value: '0', share: '0%' },
    { value: '30', share: '20%' },
  ]);
  await expect(messageRows.nth(0)).toHaveText(/Human messages\s+3/);
  await expect(messageRows.nth(1)).toHaveText(/Agent messages\s+6/);
  const reducedNumberStyles = await details.locator('.animated-number').evaluateAll((numbers) =>
    numbers.map((number) => ({
      animationName: getComputedStyle(number).animationName,
      transform: getComputedStyle(number).transform,
      transitionDuration: Number.parseFloat(getComputedStyle(number).transitionDuration),
    })),
  );
  expect(
    reducedNumberStyles.every(
      ({ animationName, transform, transitionDuration }) =>
        animationName === 'none' && transform === 'none' && transitionDuration <= 0.001,
    ),
  ).toBe(true);
  await agentBeta.blur();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');

  await finalModel.focus();
  await expect(finalModel).toBeFocused();
  await expect(previewStatus).toContainText('By model Model Production Final 50 processed');
  expect(await compositionValues()).toEqual([
    { value: '30 tokens', share: '60% of total' },
    { value: '15', share: '30%' },
    { value: '0', share: '0%' },
    { value: '5', share: '10%' },
  ]);
  await expect(details.locator('.composition-strip-segment')).toHaveCount(3);
  await expect(details.locator('.composition-strip')).toHaveAccessibleName(
    /Token composition, Cached context: 30 tokens, 60%.*Model output: 15 tokens, 30%.*Input context: 5 tokens, 10%/,
  );

  await longModel.focus();
  const selectedLongModel = page
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

test('uses localized radio group and segment semantics', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 304, locale: 'de' },
  });
  await component.getByTestId('token-usage-disclosure').click();

  const agentGroup = page.getByRole('radiogroup', { name: 'Nach Agent' });
  const modelGroup = page.getByRole('radiogroup', { name: 'Nach Modell' });
  await expect(agentGroup).toBeVisible();
  await expect(modelGroup).toBeVisible();
  await expect(agentGroup.getByRole('radio')).toHaveCount(4);
  await expect(agentGroup.getByRole('radio').first()).toHaveAccessibleName(
    /Nach Agent, Agent alpha-01: 750 Token/,
  );
  await expect(agentGroup.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
  await agentGroup.getByRole('radio').nth(1).focus();
  const localizedStatus = (await page.locator('.preview-status').textContent())
    ?.replace(/\s+/g, ' ')
    .trim();
  expect(localizedStatus).toBe('Aktiver Bereich Nach Agent Agent beta-02 150 verarbeitet');
  expect(localizedStatus?.match(/Nach Agent/g)).toHaveLength(1);
  await expect(agentGroup.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true');
});

test('retargets animated values smoothly with final-only accessibility and stable geometry', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 304 },
  });
  await component.getByTestId('token-usage-disclosure').click();

  const details = page.getByTestId('token-usage-details');
  const previewStatus = details.locator('.preview-status');
  const rows = details.locator('.token-composition-row');
  const animatedValues = rows.locator('.composition-value .animated-number-value');
  const finalTargets = rows.locator('.composition-value .animated-number-target');
  const animatedNumbers = details.locator('.animated-number');
  const agentBeta = page
    .getByTestId('token-usage-by-agent')
    .locator('.breakdown-item-control')
    .nth(1);
  const finalModel = page
    .getByTestId('token-usage-by-model')
    .locator('.breakdown-item-control')
    .last();
  const geometry = async () => ({
    details: await details.boundingBox(),
    rightEdges: await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const value = row.querySelector('.composition-value')!.getBoundingClientRect();
        const share = row.querySelector('.composition-context')!.getBoundingClientRect();
        return [value.right, share.right];
      }),
    ),
    numbers: await animatedNumbers.evaluateAll((numbers) =>
      numbers.map((number) => {
        const box = number.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          transform: getComputedStyle(number).transform,
        };
      }),
    ),
  });
  const initialGeometry = await geometry();
  await expect(animatedNumbers).toHaveCount(13);
  expect(
    await animatedNumbers.evaluateAll((numbers) =>
      numbers.every(
        (number) =>
          (number as HTMLElement).dataset.pulse === 'false' &&
          getComputedStyle(number).transform === 'none',
      ),
    ),
  ).toBe(true);

  await agentBeta.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await expect(previewStatus).toContainText('By agent Agent beta-02 150 processed');
  await expect(finalTargets).toHaveText(['50 tokens', '70', '0', '30']);
  expect(
    await animatedValues.evaluateAll((values) =>
      values.every((value) => value.ariaHidden === 'true'),
    ),
  ).toBe(true);
  await page.clock.runFor(75);
  const midpoint = Number.parseFloat((await animatedValues.first().textContent()) ?? '');
  expect(midpoint).toBeGreaterThan(50);
  expect(midpoint).toBeLessThan(550);
  expect(await geometry()).toEqual(initialGeometry);
  expect(
    (await details.locator('.animated-number-value').allTextContents()).every(
      (value) => !/[0-9][.,][0-9]/.test(value),
    ),
  ).toBe(true);

  await finalModel.focus();
  await agentBeta.dispatchEvent('pointerleave', { pointerType: 'mouse' });
  await expect(previewStatus).toHaveAttribute('aria-atomic', 'true');
  await expect(previewStatus).toContainText('By model Model Production Final 50 processed');
  await expect(finalTargets).toHaveText(['30 tokens', '15', '0', '5']);
  expect(
    await finalTargets.evaluateAll((targets) =>
      targets.every((target) => target.ariaAtomic === 'true'),
    ),
  ).toBe(true);
  const midpointGeometry = await geometry();
  expect(midpointGeometry).toEqual(initialGeometry);

  await page.clock.runFor(350);
  await expect(animatedValues).toHaveText(['30 tokens', '15', '0', '5']);
  expect(await geometry()).toEqual(initialGeometry);

  await finalModel.blur();
  await expect(previewStatus).toContainText('By agent Agent alpha-01 750 processed');
  await page.clock.runFor(350);
  await expect(animatedValues).toHaveText(['550 tokens', '150', '0', '50']);
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
        const processedValue = element.querySelector('span[aria-hidden="true"]')!;
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: Number.parseFloat(style.borderRadius),
          borderColor: style.borderColor,
          processedFontSize: Number.parseFloat(getComputedStyle(processedValue).fontSize),
          processedFontWeight: getComputedStyle(processedValue).fontWeight,
          processedText: processedValue.textContent?.trim(),
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
  expect(closedBox!.height).toBeCloseTo(24, 0);
  expect(disclosureBox!.height).toBeCloseTo(24, 0);
  expect(disclosureBox!.width).toBeLessThan(64);
  expect(
    Math.abs(
      disclosureBox!.x + disclosureBox!.width - (sidebarRegionBox!.x + sidebarRegionBox!.width - 8),
    ),
  ).toBeLessThanOrEqual(1);
  expect(summaryMetrics.borderRadius).toBeGreaterThanOrEqual(2);
  expect(summaryMetrics.borderRadius).toBeLessThanOrEqual(5);
  expect(summaryMetrics.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(summaryMetrics.borderColor).toBe('rgba(0, 0, 0, 0)');
  expect(summaryMetrics).toMatchObject({
    processedFontSize: 12,
    processedFontWeight: '400',
    processedText: '1K',
  });
  await expect(disclosure).toHaveText(/1K/);
  await expect(disclosure.getByText('tokens used', { exact: true })).not.toBeVisible();
  await expect(disclosure.getByText('Cached', { exact: true })).toHaveCount(0);

  await disclosure.click();
  await page.mouse.move(1000, 700);
  const agentSection = page.getByTestId('token-usage-by-agent');
  const modelSection = page.getByTestId('token-usage-by-model');
  const details = page.getByTestId('token-usage-details');
  const composition = details.locator('section[aria-labelledby$="-composition"]');
  const compositionStrip = composition.locator('.composition-strip');
  const compositionSegments = compositionStrip.locator('.composition-strip-segment');
  const compositionRows = details.locator('.composition-row');
  const tokenCompositionRows = details.locator('.token-composition-row');
  const messageCompositionRows = details.locator('.message-composition-row');
  const agentRows = agentSection.locator('.breakdown-stack-item');
  const modelRows = modelSection.locator('.breakdown-stack-item');
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
  await expect
    .poll(() =>
      disclosure.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, borderColor: style.borderColor };
      }),
    )
    .toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderColor: 'rgba(0, 0, 0, 0)',
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
    zIndex: 40,
  });
  await expect(details).toContainText('By agent Agent alpha-01 750 processed');
  await expect(compositionRows).toHaveCount(6);
  await expect(compositionStrip).toHaveRole('img');
  await expect(compositionStrip).toHaveAccessibleName(
    /Token composition, Cached context: 550 tokens, 73%.*Model output: 150 tokens, 20%.*Input context: 50 tokens, 7%/,
  );
  await expect(compositionSegments).toHaveCount(3);
  await expect(composition.locator('.composition-header')).toHaveCount(0);
  await expect(compositionRows.nth(0)).toContainText('Cached context');
  await expect(
    compositionRows.nth(0).locator('.composition-value .animated-number-value'),
  ).toHaveText('550 tokens');
  await expect(
    compositionRows.nth(0).locator('.composition-context .animated-number-value'),
  ).toHaveText('73% of total');
  await expect(compositionRows.nth(1)).toContainText('Model output');
  await expect(compositionRows.nth(2)).toContainText('Reasoning tokens');
  await expect(compositionRows.nth(3)).toContainText('Human messages');
  await expect(compositionRows.nth(4)).toContainText('Agent messages');
  await expect(compositionRows.nth(5)).toContainText('Input context');
  await expect(messageCompositionRows.nth(0)).toHaveText(/Human messages\s+4/);
  await expect(messageCompositionRows.nth(1)).toHaveText(/Agent messages\s+7/);
  await expect(tokenCompositionRows.locator('.composition-key[aria-hidden="true"]')).toHaveCount(4);
  await expect(messageCompositionRows.locator('.composition-key')).toHaveCount(0);
  await expect(composition.locator('.composition-description')).toHaveCount(0);
  await expect(details).not.toContainText(/cost|\$/i);
  await expect(details.locator('[data-testid="token-usage-total-cost"]')).toHaveCount(0);
  expect(
    await details
      .locator('[aria-label], [aria-description], [title]')
      .evaluateAll((elements) =>
        elements.every((element) =>
          Array.from(element.attributes).every((attribute) => !/cost|\$/i.test(attribute.value)),
        ),
      ),
  ).toBe(true);
  await expect(agentSection).toBeVisible();
  await expect(modelSection).toBeVisible();
  await expect(agentRows).toHaveCount(4);
  await expect(modelRows).toHaveCount(4);
  await expect(agentRows.first()).toBeVisible();
  await expect(modelRows.first()).toBeVisible();
  await expect(agentSection.locator('.navigator-selection .animated-number-value')).toHaveText(
    '75%',
  );
  await expect(modelSection.locator('.navigator-selection .animated-number-value')).toHaveText(
    '60%',
  );
  await expect(agentRows.locator('.breakdown-item-control')).toHaveCount(4);
  await expect(modelRows.locator('.breakdown-item-control')).toHaveCount(4);
  await expect(component.getByTestId('token-usage-message-counts')).toHaveCount(0);

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
    messageAlignment,
    breakdownAlignment,
    compositionBar,
    contentOrder,
    visibleTextWeights,
    typeHierarchy,
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
        const markerElement = row.querySelector('.composition-key')!;
        const valueElement = row.querySelector('.composition-value')!;
        const contextElement = row.querySelector('.composition-context')!;
        return {
          isZero: row.getAttribute('data-zero') === 'true',
          row: row.getBoundingClientRect().toJSON(),
          metric: box('.composition-metric'),
          metricFontSize: Number.parseFloat(getComputedStyle(metricElement).fontSize),
          metricColor: getComputedStyle(metricElement).color,
          markerColor: getComputedStyle(markerElement).backgroundColor,
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
          gaps: segments
            .slice(1)
            .map((segment, index) => segment.x - (segments[index].x + segments[index].width)),
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
      const composition = grid.parentElement!.querySelector<HTMLElement>(
        'section[aria-labelledby$="-composition"]',
      )!;
      const rows = Array.from(grid.parentElement!.querySelectorAll('.composition-row'));
      const neutralProbe = document.createElement('span');
      neutralProbe.style.color = 'hsl(var(--border))';
      document.body.append(neutralProbe);
      const neutralColor = getComputedStyle(neutralProbe).color;
      neutralProbe.remove();
      return {
        content: divider.content,
        backgroundColor: divider.backgroundColor,
        neutralColor,
        gridBorderTopWidth: getComputedStyle(grid).borderTopWidth,
        gridBorderTopColor: getComputedStyle(grid).borderTopColor,
        gridBorderBottomWidth: getComputedStyle(grid).borderBottomWidth,
        secondSectionBorderLeftWidth: getComputedStyle(secondSection).borderLeftWidth,
        secondSectionBorderLeftColor: getComputedStyle(secondSection).borderLeftColor,
        rowBorderTopWidths: rows.map((row) => getComputedStyle(row).borderTopWidth),
        lastRowBorderBottomWidth: getComputedStyle(rows.at(-1)!).borderBottomWidth,
        lastRowBottom: rows.at(-1)!.getBoundingClientRect().bottom,
        compositionPaddingBottom: getComputedStyle(composition).paddingBottom,
        compositionBottom: composition.getBoundingClientRect().bottom,
        gridTop: grid.getBoundingClientRect().top,
        gridBottom: grid.getBoundingClientRect().bottom,
        detailsBottom: grid.parentElement!.getBoundingClientRect().bottom,
      };
    }),
    composition.evaluate((section) => {
      const row = section.querySelector('.composition-row')!.getBoundingClientRect();
      return {
        rowLeft: row.left,
      };
    }),
    details.evaluate((element) => {
      const inputKey = element.querySelector('.composition-key[data-metric="input"]')!;
      const inputRow = inputKey.closest('.token-composition-row')!;
      const inputLabel = inputRow.querySelector('.composition-metric > span:last-child')!;
      return {
        inputLabelLeft: inputLabel.getBoundingClientRect().left,
        rows: Array.from(element.querySelectorAll('.message-composition-row')).map((row) => {
          const label = row.querySelector('.message-composition-label')!;
          const value = row.querySelector('.composition-value')!;
          const context = row.querySelector('.composition-context')!;
          return {
            labelLeft: label.getBoundingClientRect().left,
            value: value.getBoundingClientRect().toJSON(),
            valueFontWeight: getComputedStyle(value).fontWeight,
            contextText: context.textContent?.trim(),
          };
        }),
      };
    }),
    details.locator('.breakdown-section').evaluateAll((sections) =>
      sections.map((section) => {
        const selection = section.querySelector('.navigator-selection')!;
        return {
          section: section.getBoundingClientRect().toJSON(),
          selection: selection.getBoundingClientRect().toJSON(),
          title: selection.firstElementChild!.getBoundingClientRect().toJSON(),
          bar: section.querySelector('.breakdown-stack')!.getBoundingClientRect().toJSON(),
          percentage: selection.lastElementChild!.getBoundingClientRect().toJSON(),
          titleFlexGrow: getComputedStyle(selection.firstElementChild!).flexGrow,
          titleMinWidth: getComputedStyle(selection.firstElementChild!).minWidth,
          percentFlexShrink: getComputedStyle(selection.lastElementChild!).flexShrink,
          percentTextAlign: getComputedStyle(selection.lastElementChild!).textAlign,
          percentColor: getComputedStyle(selection.lastElementChild!).color,
          percentFontWeight: getComputedStyle(selection.lastElementChild!).fontWeight,
        };
      }),
    ),
    compositionStrip.evaluate((strip) => {
      const box = strip.getBoundingClientRect();
      const segments = Array.from(
        strip.querySelectorAll<HTMLElement>('.composition-strip-segment'),
      );
      return {
        box: box.toJSON(),
        borderRadius: getComputedStyle(strip).borderRadius,
        overflowX: getComputedStyle(strip).overflowX,
        summaryGap:
          box.top -
          strip.parentElement!.querySelector('.token-summary')!.getBoundingClientRect().bottom,
        rowsGap:
          strip.parentElement!.querySelector('.composition-row')!.getBoundingClientRect().top -
          box.bottom,
        gaps: segments.slice(1).map((segment, index) => {
          const previous = segments[index].getBoundingClientRect();
          return segment.getBoundingClientRect().left - previous.right;
        }),
        segments: segments.map((segment) => ({
          metric: segment.dataset.metric,
          box: segment.getBoundingClientRect().toJSON(),
          color: getComputedStyle(segment).backgroundColor,
        })),
      };
    }),
    details.evaluate((element) => {
      const compositionSection = element.querySelector('section[aria-labelledby$="-composition"]')!;
      const navigator = element.querySelector('.breakdown-grid')!;
      const lastRow = element.querySelector('.composition-row:last-child')!;
      return {
        compositionBeforeNavigator: Boolean(
          compositionSection.compareDocumentPosition(navigator) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        navigatorIsLastChild: element.lastElementChild === navigator,
        navigatorBelowRows:
          navigator.getBoundingClientRect().top >= lastRow.getBoundingClientRect().bottom,
      };
    }),
    details.evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>('*'))
        .filter(
          (candidate) =>
            !candidate.closest('.sr-only') &&
            Array.from(candidate.childNodes).some(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            ) &&
            getComputedStyle(candidate).display !== 'none',
        )
        .map((candidate) => ({
          text: candidate.textContent?.trim(),
          weight: getComputedStyle(candidate).fontWeight,
        })),
    ),
    details.evaluate((element) => {
      const style = (selector: string) => {
        const computed = getComputedStyle(element.querySelector(selector)!);
        return {
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          textTransform: computed.textTransform,
          letterSpacing: computed.letterSpacing,
          color: computed.color,
          textAlign: computed.textAlign,
        };
      };
      return {
        navigatorLabel: style('.navigator-selection > :first-child'),
        navigatorShare: style('.navigator-selection > :last-child'),
        summaryLabel: style('.token-summary > :first-child'),
        summaryTotal: style('.token-summary > :last-child'),
        metricLabel: style('.composition-metric'),
        metricValue: style('.composition-value'),
        metricShare: style('.composition-context'),
      };
    }),
  ]);

  expect(detailsBox).not.toBeNull();
  expect(detailsBox!.width).toBeCloseTo(452, 0);
  expect(detailsBox!.x).toBeCloseTo(disclosureBox!.x, 0);
  expect(detailsBox!.y).toBeCloseTo(disclosureBox!.y + disclosureBox!.height + 8, 0);
  expect(detailsBox!.width).toBeGreaterThan(disclosureBox!.width * 8);
  expect(openSidebarBox).toEqual(sidebarBox);
  expect(openContentBox).toEqual(contentBox);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(pageDimensions.scrollWidth).toBeLessThanOrEqual(pageDimensions.clientWidth);
  expect(agentBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(Math.abs(agentBox!.y - modelBox!.y)).toBeLessThanOrEqual(1);
  expect(agentBox!.width).toBeCloseTo(modelBox!.width, 0);
  expect(detailsBox!.height).toBeGreaterThanOrEqual(220);
  expect(detailsBox!.height).toBeLessThanOrEqual(400);
  expect(agentBox!.height).toBeGreaterThanOrEqual(40);
  expect(modelBox!.height).toBeGreaterThanOrEqual(40);
  expect(breakdownDivider.content).toBe('none');
  expect(breakdownDivider.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(breakdownDivider).toMatchObject({
    gridBorderTopWidth: '1px',
    gridBorderBottomWidth: '0px',
    secondSectionBorderLeftWidth: '1px',
    rowBorderTopWidths: ['0px', '0px', '0px', '0px', '0px', '0px'],
    lastRowBorderBottomWidth: '0px',
    compositionPaddingBottom: '12px',
  });
  expect([
    breakdownDivider.gridBorderTopColor,
    breakdownDivider.secondSectionBorderLeftColor,
  ]).toEqual(Array(2).fill(breakdownDivider.neutralColor));
  expect(
    Math.abs(breakdownDivider.compositionBottom - breakdownDivider.gridTop),
  ).toBeLessThanOrEqual(0.01);
  expect(breakdownDivider.gridTop - breakdownDivider.lastRowBottom).toBeCloseTo(12, 2);
  expect(
    Math.abs(breakdownDivider.gridBottom - breakdownDivider.detailsBottom),
  ).toBeLessThanOrEqual(1);
  expect(contentOrder).toEqual({
    compositionBeforeNavigator: true,
    navigatorIsLastChild: true,
    navigatorBelowRows: true,
  });
  expect(
    Math.abs(breakdownAlignment[0].selection.left - compositionAlignment.rowLeft),
  ).toBeLessThanOrEqual(1);
  expect(
    breakdownAlignment.every(
      ({
        section,
        selection,
        title,
        bar,
        percentage,
        titleFlexGrow,
        titleMinWidth,
        percentFlexShrink,
        percentTextAlign,
        percentFontWeight,
      }) =>
        Math.abs(bar.left - selection.left) <= 1 &&
        bar.top >= selection.top + selection.height + 5 &&
        Math.abs(section.bottom - bar.bottom - 16) <= 0.01 &&
        bar.right <= section.right + 1 &&
        Math.abs(percentage.left - title.right - 6) <= 0.01 &&
        Math.abs(percentage.right - bar.right) <= 1 &&
        titleFlexGrow === '1' &&
        titleMinWidth === '0px' &&
        percentFlexShrink === '0' &&
        percentTextAlign === 'right' &&
        percentFontWeight === '400',
    ),
  ).toBe(true);
  expect(breakdownAlignment[0].percentColor).toBe(breakdownAlignment[1].percentColor);
  expect(breakdownAlignment[1].selection.left).toBeCloseTo(
    detailsBox!.x + detailsBox!.width / 2 + 17,
    0,
  );
  expect(
    navigatorStacks.every(
      ({
        box,
        segmentCount,
        controls,
        segmentWidth,
        gaps,
        overflowX,
        borderRadius,
        firstRadius,
        lastRadius,
        lastRight,
      }) =>
        box.height === 6 &&
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
        Math.abs(segmentWidth - (box.width - (segmentCount - 1))) <= 0.04 &&
        gaps.every((gap) => Math.abs(gap - 1) <= 0.01) &&
        overflowX === 'hidden' &&
        borderRadius === '2px' &&
        firstRadius === '2px' &&
        lastRadius === '2px' &&
        Math.abs(lastRight - (box.x + box.width)) <= 0.04,
    ),
  ).toBe(true);
  expect(compositionBar.box.height).toBe(6);
  expect(compositionBar.borderRadius).toBe('2px');
  expect(compositionBar.overflowX).toBe('hidden');
  expect(compositionBar.summaryGap).toBeCloseTo(8, 2);
  expect(compositionBar.rowsGap).toBeCloseTo(20, 2);
  expect(compositionBar.gaps.every((gap) => Math.abs(gap - 1) <= 0.02)).toBe(true);
  expect(compositionBar.segments.map(({ metric }) => metric)).toEqual([
    'cached',
    'output',
    'input',
  ]);
  expect(new Set(compositionBar.segments.map(({ color }) => color)).size).toBe(3);
  const compositionUsableWidth = compositionBar.box.width - compositionBar.gaps.length;
  expect(compositionBar.segments[0].box.width / compositionUsableWidth).toBeCloseTo(550 / 750, 2);
  expect(compositionBar.segments[1].box.width / compositionUsableWidth).toBeCloseTo(150 / 750, 2);
  expect(compositionBar.segments[2].box.width / compositionUsableWidth).toBeCloseTo(50 / 750, 2);
  expect(
    compositionBar.segments.every((segment, index, segments) =>
      index === 0
        ? Math.abs(segment.box.x - compositionBar.box.x) <= 0.01
        : Math.abs(
            segment.box.x - (segments[index - 1].box.x + segments[index - 1].box.width + 1),
          ) <= 0.01,
    ),
  ).toBe(true);
  expect(
    Math.abs(
      compositionBar.segments.at(-1)!.box.x +
        compositionBar.segments.at(-1)!.box.width -
        (compositionBar.box.x + compositionBar.box.width),
    ),
  ).toBeLessThanOrEqual(1);
  expect(visibleTextWeights.length).toBeGreaterThan(0);
  expect(new Set(visibleTextWeights.map(({ weight }) => weight))).toEqual(new Set(['400', '500']));
  expect(visibleTextWeights.filter(({ weight }) => weight === '500')).toHaveLength(2);
  expect(typeHierarchy).toMatchObject({
    navigatorLabel: { fontSize: '14px', fontWeight: '500' },
    navigatorShare: { fontSize: '13px', fontWeight: '400', textAlign: 'right' },
    summaryLabel: { fontSize: '13px', fontWeight: '400', textTransform: 'none' },
    summaryTotal: { fontSize: '14px', fontWeight: '400', textAlign: 'right' },
    metricLabel: { fontSize: '14px', fontWeight: '400' },
    metricValue: { fontSize: '14px', fontWeight: '400', textAlign: 'right' },
    metricShare: { fontSize: '13px', fontWeight: '400', textAlign: 'right' },
  });
  expect(typeHierarchy.summaryLabel.letterSpacing).toBe('normal');
  expect(typeHierarchy.summaryLabel.color).toBe(typeHierarchy.metricShare.color);
  expect(typeHierarchy.navigatorShare.color).toBe(typeHierarchy.metricShare.color);
  expect(typeHierarchy.metricValue.color).not.toBe(typeHierarchy.metricShare.color);
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
      stackOutlineColor: getComputedStyle(stack).outlineColor,
      neutralFocusColor: (() => {
        const probe = document.createElement('span');
        probe.style.color = 'hsl(var(--foreground))';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
      appRingColor: (() => {
        const probe = document.createElement('span');
        probe.style.color = 'hsl(var(--ring))';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
    };
  });
  expect(focusedBarStyle).toMatchObject({
    buttonBoxShadow: 'none',
    stackOutlineStyle: 'solid',
    stackOutlineWidth: '2px',
  });
  expect(focusedBarStyle.stackOutlineColor).toBe(focusedBarStyle.neutralFocusColor);
  expect(focusedBarStyle.stackOutlineColor).not.toBe(focusedBarStyle.appRingColor);
  expect(
    desktopRows.every(
      ({
        isZero,
        row,
        metric,
        metricFontSize,
        metricColor,
        markerColor,
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
        (isZero
          ? metricColor === contextColor &&
            markerColor === contextColor &&
            valueColor === contextColor
          : valueColor !== contextColor) &&
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
  expect(messageAlignment.rows).toHaveLength(2);
  expect(
    messageAlignment.rows.every(
      ({ labelLeft, valueFontWeight, contextText }) =>
        Math.abs(labelLeft - messageAlignment.inputLabelLeft) <= 0.01 &&
        valueFontWeight === '400' &&
        contextText === '',
    ),
  ).toBe(true);
  expect(
    messageAlignment.rows.every(
      ({ value }) => Math.abs(value.right - desktopRows[0].value.right) <= 0.01,
    ),
  ).toBe(true);
  const intrinsicNavigatorGeometry = await modelSection
    .locator('.navigator-selection')
    .evaluate((selection) => {
      const clone = selection.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed';
      clone.style.visibility = 'hidden';
      clone.style.width = `${selection.getBoundingClientRect().width}px`;
      document.body.append(clone);
      const title = clone.firstElementChild as HTMLElement;
      const percentage = clone.lastElementChild as HTMLElement;
      title.textContent = 'Acme code model with an intentionally long display name';
      const value = percentage.querySelector('.animated-number-value')!;
      const measure = (text: string) => {
        value.textContent = text;
        const titleBox = title.getBoundingClientRect();
        const percentageBox = percentage.getBoundingClientRect();
        return {
          titleWidth: titleBox.width,
          percentageWidth: percentageBox.width,
          gap: percentageBox.left - titleBox.right,
          selectionWidth: clone.getBoundingClientRect().width,
          truncated: title.scrollWidth > title.clientWidth,
        };
      };
      const zero = measure('0%');
      const hundred = measure('100%');
      const styles = {
        titleFlexGrow: getComputedStyle(title).flexGrow,
        titleMinWidth: getComputedStyle(title).minWidth,
        percentageFlexShrink: getComputedStyle(percentage).flexShrink,
      };
      clone.remove();
      return { zero, hundred, styles };
    });
  expect(intrinsicNavigatorGeometry.hundred.percentageWidth).toBeGreaterThan(
    intrinsicNavigatorGeometry.zero.percentageWidth,
  );
  expect(intrinsicNavigatorGeometry.zero.gap).toBeCloseTo(6, 2);
  expect(intrinsicNavigatorGeometry.hundred.gap).toBeCloseTo(6, 2);
  expect(
    intrinsicNavigatorGeometry.zero.titleWidth - intrinsicNavigatorGeometry.hundred.titleWidth,
  ).toBeCloseTo(
    intrinsicNavigatorGeometry.hundred.percentageWidth -
      intrinsicNavigatorGeometry.zero.percentageWidth,
    2,
  );
  expect(intrinsicNavigatorGeometry.hundred.truncated).toBe(true);
  expect(
    intrinsicNavigatorGeometry.hundred.titleWidth +
      intrinsicNavigatorGeometry.hundred.percentageWidth +
      intrinsicNavigatorGeometry.hundred.gap,
  ).toBeCloseTo(intrinsicNavigatorGeometry.hundred.selectionWidth, 2);
  expect(intrinsicNavigatorGeometry).toMatchObject({
    styles: { titleFlexGrow: '1', titleMinWidth: '0px', percentageFlexShrink: '0' },
  });
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
      const processedValue = element.querySelector('span[aria-hidden="true"]')!;
      return {
        processedFontSize: getComputedStyle(processedValue).fontSize,
        processedText: processedValue.textContent?.trim(),
      };
    }),
  ]);
  expect(wideSidebarRegion!.width).toBeCloseTo(452, 0);
  expect(wideDetails!.width).toBeCloseTo(452, 0);
  expect(wideSummaryMetrics).toEqual({ processedFontSize: '12px', processedText: '1K' });

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

test('portals the complete overlay beyond transformed overflow containment on both sidebar sides', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 304, placement: 'top', side: 'left' },
  });
  const disclosure = component.getByTestId('token-usage-disclosure');

  for (const testCase of [
    { side: 'left' as const, viewportWidth: 1100, viewportHeight: 720 },
    { side: 'right' as const, viewportWidth: 1100, viewportHeight: 720 },
    { side: 'left' as const, viewportWidth: 280, viewportHeight: 520 },
    { side: 'right' as const, viewportWidth: 248, viewportHeight: 480 },
  ]) {
    await page.setViewportSize({
      width: testCase.viewportWidth,
      height: testCase.viewportHeight,
    });
    await component.update({
      props: { theme: 'light', width: 304, placement: 'top', side: testCase.side },
    });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await disclosure.click();

    const details = page.getByTestId('token-usage-details');
    await expect(details).toBeVisible();
    const [detailsBox, sidebarBox, portalParent] = await Promise.all([
      details.boundingBox(),
      component.getByTestId('workspace-sidebar').boundingBox(),
      details.evaluate((element) => element.parentElement?.tagName),
    ]);

    expect(portalParent).toBe('BODY');
    expect(detailsBox!.x).toBeGreaterThanOrEqual(8);
    expect(detailsBox!.y).toBeGreaterThanOrEqual(8);
    expect(detailsBox!.x + detailsBox!.width).toBeLessThanOrEqual(testCase.viewportWidth - 8);
    expect(detailsBox!.y + detailsBox!.height).toBeLessThanOrEqual(testCase.viewportHeight - 8);

    if (testCase.viewportWidth === 1100) {
      if (testCase.side === 'left') {
        expect(detailsBox!.x + detailsBox!.width).toBeGreaterThan(
          sidebarBox!.x + sidebarBox!.width,
        );
      } else {
        expect(detailsBox!.x).toBeLessThan(sidebarBox!.x);
      }
    }

    await disclosure.click();
    await expect(details).toHaveCount(0);
  }
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
  let details = page.getByTestId('token-usage-details');
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
  details = page.getByTestId('token-usage-details');
  await disclosure.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(disclosure).toBeFocused();

  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 0 }));
  await component.update({ props: { placement: 'bottom', side: 'left' } });
  await page.setViewportSize({ width: 700, height: 360 });
  await disclosure.click();
  details = page.getByTestId('token-usage-details');
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
  const agentSection = page.getByTestId('token-usage-by-agent');
  const modelSection = page.getByTestId('token-usage-by-model');
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
  expect(summaryBox280!.width).toBeLessThan(64);
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
  expect(summaryBox248!.width).toBeLessThan(64);
  expect(compactBox248!.width).toBeCloseTo(232, 0);
  expect(compactBox248!.x).toBeCloseTo(8, 0);
  expect(compactBox248!.x + compactBox248!.width).toBeCloseTo(240, 0);
  expect(pageDimensions248.scrollWidth).toBeLessThanOrEqual(pageDimensions248.clientWidth);
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(248, 0);
});
