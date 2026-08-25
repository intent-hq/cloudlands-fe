import { expect, test } from '@playwright/experimental-ct-svelte';
import StreamingTypingOperationalGeometryHost from './StreamingTypingOperationalGeometryHost.svelte';

test.setTimeout(120_000);

test('matches adjacent tool-row geometry and keeps the explicit 8px top margin', async ({
  mount,
  page,
}) => {
  const component = await mount(StreamingTypingOperationalGeometryHost);

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [240, 720]) {
      for (const zoom of [1, 2]) {
        if (
          (theme === 'light' && (width !== 720 || zoom !== 1)) ||
          (theme === 'dark' && (width !== 240 || zoom !== 2))
        )
          continue;
        for (const mode of ['processing', 'streaming'] as const) {
          await component.update({ props: { theme, width, zoom, mode } });
          await page.waitForTimeout(220);

          const geometry = await component.evaluate((root) => {
            const measure = (
              row: Element,
              leadingSelector: string,
              summarySelector: string,
              iconSelector: string,
            ) => {
              const leading = row.querySelector(leadingSelector)!;
              const summary = row.querySelector<HTMLElement>(summarySelector)!;
              const icon = row.querySelector(iconSelector)!;
              const box = row.getBoundingClientRect();
              const leadingBox = leading.getBoundingClientRect();
              const summaryBox = summary.getBoundingClientRect();
              const iconBox = icon.getBoundingClientRect();
              const style = getComputedStyle(row);
              const summaryStyle = getComputedStyle(summary);
              const baselineProbe = document.createElement('span');
              baselineProbe.style.cssText =
                'display:inline-block;width:0;height:0;margin:0;padding:0;vertical-align:baseline';
              summary.append(baselineProbe);
              const baseline = baselineProbe.getBoundingClientRect().bottom - box.top;
              baselineProbe.remove();
              return {
                left: box.left,
                right: box.right,
                height: box.height,
                leadingWidth: leadingBox.width,
                leadingCenterX: (leadingBox.left + leadingBox.right) / 2,
                leadingCenterY: (leadingBox.top + leadingBox.bottom) / 2 - box.top,
                iconCenterX: (iconBox.left + iconBox.right) / 2,
                iconCenterY: (iconBox.top + iconBox.bottom) / 2 - box.top,
                labelStart: summaryBox.left,
                baseline,
                marginTop: style.marginTop,
                paddingInline: [style.paddingLeft, style.paddingRight],
                columnGap: style.columnGap,
                summary: [
                  summaryStyle.minWidth,
                  summaryStyle.overflow,
                  summaryStyle.textOverflow,
                  summaryStyle.whiteSpace,
                ],
              };
            };

            const beforeContainer = root.querySelector('[data-testid="streaming-tool-before"]')!;
            const beforeRow = beforeContainer.querySelector('[data-operational-disclosure-row]')!;
            const thinkingRow = root.querySelector('[data-streaming-typing-row]')!;
            const afterContainer = root.querySelector('[data-testid="streaming-tool-after"]')!;
            const afterRow = afterContainer.querySelector('[data-operational-disclosure-row]')!;
            return {
              before: measure(
                beforeRow,
                '[data-operational-leading]',
                '[data-operational-summary]',
                '[data-testid="fixture-tool-icon"]',
              ),
              thinking: measure(
                thinkingRow,
                '[data-operational-leading]',
                '[data-operational-summary]',
                '.legacy-spinner-track',
              ),
              after: measure(
                afterRow,
                '[data-operational-leading]',
                '[data-operational-summary]',
                '[data-testid="fixture-tool-icon"]',
              ),
              topGap:
                thinkingRow.getBoundingClientRect().top -
                beforeContainer.getBoundingClientRect().bottom,
              bottomGap:
                afterContainer.getBoundingClientRect().top -
                thinkingRow.getBoundingClientRect().bottom,
              text: thinkingRow.textContent,
              primaryColor: getComputedStyle(
                root.querySelector('[data-testid="streaming-status-thinking"]')!,
              ).color,
              secondaryColor: getComputedStyle(
                root.querySelector('[data-testid="streaming-status-lifecycle"]')!,
              ).color,
            };
          });

          expect(geometry.thinking.marginTop).toBe('8px');
          expect(geometry.topGap).toBeCloseTo(8 * zoom, 1);
          expect(geometry.bottomGap).toBeCloseTo(0, 1);
          expect(geometry.thinking.height).toBeCloseTo(28 * zoom, 1);
          expect(geometry.thinking.leadingWidth).toBeCloseTo(20 * zoom, 1);
          expect(geometry.thinking.labelStart - geometry.thinking.left).toBeCloseTo(36 * zoom, 1);
          expect(geometry.thinking.paddingInline).toEqual(['8px', '8px']);
          expect(geometry.thinking.columnGap).toBe('8px');
          expect(geometry.thinking.summary).toEqual(['0px', 'hidden', 'ellipsis', 'nowrap']);
          expect(geometry.text).toContain('Thinking');
          expect(geometry.text).toContain('Sent prompt…');
          expect(geometry.text).not.toContain('·');
          expect(geometry.primaryColor).not.toBe(geometry.secondaryColor);

          for (const tool of [geometry.before, geometry.after]) {
            for (const [thinking, adjacent] of [
              [geometry.thinking.left, tool.left],
              [geometry.thinking.right, tool.right],
              [geometry.thinking.height, tool.height],
              [geometry.thinking.leadingWidth, tool.leadingWidth],
              [geometry.thinking.leadingCenterX, tool.leadingCenterX],
              [geometry.thinking.leadingCenterY, tool.leadingCenterY],
              [geometry.thinking.iconCenterX, tool.iconCenterX],
              [geometry.thinking.iconCenterY, tool.iconCenterY],
              [geometry.thinking.labelStart, tool.labelStart],
              [geometry.thinking.baseline, tool.baseline],
            ]) {
              expect(Math.abs(thinking - adjacent)).toBeLessThanOrEqual(0.5);
            }
          }

          await expect(component.getByRole('status')).toHaveAccessibleName('Thinking');
          await expect(component.getByRole('status')).toHaveAttribute('aria-live', 'polite');
          await expect(component.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
        }
      }
    }
  }
});

test('preserves the square animation and disables it for reduced motion', async ({
  mount,
  page,
}) => {
  const component = await mount(StreamingTypingOperationalGeometryHost);
  const square = component.locator('.legacy-spinner-square-0');
  const motion = await square.evaluate((node) => {
    const animation = node.getAnimations()[0];
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 0;
    const startTransform = getComputedStyle(node).transform;
    animation.currentTime = 480;
    const middleTransform = getComputedStyle(node).transform;
    return { startTransform, middleTransform };
  });

  expect(motion).not.toBeNull();
  expect(motion?.startTransform).not.toBe(motion?.middleTransform);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(square).toHaveCSS('animation-name', 'none');
  await expect(square).toHaveCSS('transform', 'none');
  await expect(component.locator('.legacy-spinner-square')).toHaveCount(3);
  for (const staticSquare of await component.locator('.legacy-spinner-square').all()) {
    const box = await staticSquare.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }
});

test('updates localized phases, omits missing detail, and truncates without overflow', async ({
  mount,
}) => {
  const component = await mount(StreamingTypingOperationalGeometryHost, {
    props: {
      mode: 'processing',
      phaseMessage: 'Solicitud enviada al modelo…',
      width: 160,
      zoom: 2,
    },
  });

  await expect(component.getByTestId('streaming-status-thinking')).toHaveText('Thinking');
  const lifecycle = component.getByTestId('streaming-status-lifecycle');
  await expect(lifecycle).toHaveText('Solicitud enviada al modelo…');
  await expect(lifecycle).toHaveAttribute('title', 'Solicitud enviada al modelo…');

  const truncation = await lifecycle.evaluate((node) => {
    const style = getComputedStyle(node);
    const row = node.closest('[data-streaming-typing-row]')!;
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      clipped: node.scrollWidth > node.clientWidth,
      rowContained: row.scrollWidth <= row.clientWidth,
    };
  });
  expect(truncation).toEqual({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    clipped: true,
    rowContained: true,
  });

  await component.update({
    props: {
      mode: 'streaming',
      phaseMessage: 'Transmitiendo respuesta…',
      width: 160,
      zoom: 2,
    },
  });
  await expect(component.getByTestId('streaming-status-lifecycle')).toHaveText(
    'Transmitiendo respuesta…',
  );

  await component.update({
    props: { mode: 'streaming', phaseMessage: null, width: 160, zoom: 2 },
  });
  await expect(component.getByTestId('streaming-status-lifecycle')).toHaveCount(0);
  await expect(component.getByRole('status')).toHaveAccessibleName('Thinking');
});
