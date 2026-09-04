import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

// The zoom-200% cells here leave a heavy document behind, and the next spec's
// first mount() on the reused per-worker page intermittently failed with
// "Execution context was destroyed" on the merge queue (intent-hq/intent#4373).
// Run this spec in its own worker without context reuse so its teardown never
// races another spec's mount. Playwright-internal option, not in the public
// types; ct-core pins it to 'when-possible' in its fixtures.
// @ts-expect-error -- _optionContextReuseMode is a boxed internal option
test.use({ _optionContextReuseMode: 'none' });

// Isolation guard for the private option above: if a Playwright upgrade renames or
// drops `_optionContextReuseMode`, `test.use` silently becomes a no-op and per-worker
// reuse (and the intent-hq/intent#4373 flake) come back with nothing failing loudly.
// Under reuse every test in this worker mounts into the same browser context; with
// isolation each test gets a new one. A page-side marker cannot tell the two apart
// (the reuse reset navigates to about:blank and clears origin storage), so compare
// the CDP browserContextId instead.
const browserContextIdsSeenInWorker = new Set<string>();
test.beforeEach(async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    const browserContextId = targetInfo.browserContextId ?? '';
    expect(browserContextId, 'Target.getTargetInfo reports a browserContextId').not.toBe('');
    expect(
      browserContextIdsSeenInWorker.has(browserContextId),
      `browser context ${browserContextId} was already used by an earlier test in this worker: ` +
        "test.use({ _optionContextReuseMode: 'none' }) is no longer disabling context reuse " +
        '(intent-hq/intent#4373)',
    ).toBe(false);
    browserContextIdsSeenInWorker.add(browserContextId);
  } finally {
    await session.detach();
  }
});

for (const zoom of [1, 2]) {
  test(`aligns terminal status columns with tool rows at ${zoom * 100}%`, async ({ mount }) => {
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: { terminalStatusOnly: true, width: 320, zoom },
    });

    for (const [messageId, statusTestId] of [
      ['assistant-stopped', 'stopped-indicator'],
      ['assistant-abnormal-finish', 'finish-reason-notice'],
    ] as const) {
      const message = component.locator(`[data-message-id="${messageId}"]`);
      const reference = message.locator('[data-tool-use-id]').first();
      const status = message.getByTestId(statusTestId);
      const geometry = await message.evaluate(
        (node, ids) => {
          const measure = (element: Element) => {
            const row = element.querySelector('[data-operational-disclosure-row]')!;
            const leading = element.querySelector('[data-operational-leading]')!;
            const summary = element.querySelector('[data-operational-summary]')!;
            const rowBox = row.getBoundingClientRect();
            const leadingBox = leading.getBoundingClientRect();
            return {
              rowEdges: [rowBox.left, rowBox.right],
              leadingCenter: (leadingBox.left + leadingBox.right) / 2,
              summaryStart: summary.getBoundingClientRect().left,
            };
          };
          return {
            reference: measure(node.querySelector(`[data-tool-use-id="${ids.reference}"]`)!),
            status: measure(node.querySelector(`[data-testid="${ids.status}"]`)!),
          };
        },
        {
          reference: await reference.getAttribute('data-tool-use-id'),
          status: statusTestId,
        },
      );

      expect(geometry.status.rowEdges).toEqual(geometry.reference.rowEdges);
      expect(geometry.status.leadingCenter).toBeCloseTo(geometry.reference.leadingCenter, 1);
      expect(geometry.status.summaryStart).toBeCloseTo(geometry.reference.summaryStart, 1);
      await expect(status).toHaveCSS('margin-top', '20px');
    }
  });
}

for (const zoom of [1, 2]) {
  test(`optically centers the reasoning-group glyph at ${zoom * 100}%`, async ({ mount }) => {
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: { terminalStatusOnly: true, width: 320, zoom },
    });
    const group = component
      .locator('[data-message-id="assistant-abnormal-finish"]')
      .getByTestId('response-group');
    const trigger = group.getByTestId('response-group-disclosure');

    for (let state = 0; state < 2; state += 1) {
      const centers = await group.evaluate((node) => {
        const row = node.querySelector('[data-operational-disclosure-row]')!;
        const leading = node.querySelector('[data-operational-leading]')!;
        const label = node.querySelector('[data-testid="response-group-name"]')!;
        const svg = node.querySelector<SVGSVGElement>('[data-response-group-disclosure-icon] svg')!;
        const path = svg.querySelector<SVGGraphicsElement>('path')!;
        const pathBox = path.getBBox();
        const pathCenter = new DOMPoint(
          pathBox.x + pathBox.width / 2,
          pathBox.y + pathBox.height / 2,
        ).matrixTransform(path.getScreenCTM()!);
        const labelStyle = getComputedStyle(label);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        context.font = `${labelStyle.fontStyle} ${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`;
        const textMetrics = context.measureText(label.textContent ?? '');
        const baselineProbe = document.createElement('span');
        baselineProbe.style.cssText =
          'display:inline-block;width:0;height:0;margin:0;padding:0;vertical-align:baseline';
        label.append(baselineProbe);
        const baseline = baselineProbe.getBoundingClientRect().bottom;
        baselineProbe.remove();
        const scale = svg.getBoundingClientRect().width / 16;
        const rowBox = row.getBoundingClientRect();
        const leadingBox = leading.getBoundingClientRect();
        return {
          pathCenter: pathCenter.y,
          labelCenter:
            baseline -
            ((textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent) * scale) /
              2,
          rowCenter: (rowBox.top + rowBox.bottom) / 2,
          leadingCenter: (leadingBox.top + leadingBox.bottom) / 2,
        };
      });

      // Font ink bounds vary slightly across platforms; keep the glyph optically
      // within two CSS pixels of the visible label while its slot stays exact.
      expect(Math.abs(centers.pathCenter - centers.labelCenter)).toBeLessThanOrEqual(2 * zoom);
      expect(centers.leadingCenter).toBeCloseTo(centers.rowCenter, 1);
      await trigger.click();
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    for (const width of [320, 720]) {
      if (
        (theme === 'light' && (width !== 720 || zoom !== 1)) ||
        (theme === 'dark' && (width !== 320 || zoom !== 2))
      )
        continue;
      test(`keeps real ChatPanel operational seams exact in ${theme} at ${zoom * 100}% and ${width}px`, async ({
        mount,
      }) => {
        const component = await mount(ChatPanelOperationalGeometryHost, {
          props: { theme, zoom, width },
        });
        // The fixture session streams, so followBottom re-pins the transcript
        // to the exact bottom on every mutation/resize settle frame. Playwright
        // scrolls targets into view without wheel events, so follow never
        // unlocks and the re-pin races (and under CI load starves) clicks on
        // rows above the fold. A real user scrolls up first, which drops
        // follow — emulate that before each interaction pass.
        const unlockFollow = () =>
          component
            .getByTestId('chat-transcript-scroll-viewport')
            .evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 })));
        for (const messageId of ['assistant-finished', 'assistant-streaming']) {
          await unlockFollow();
          const message = component.locator(`[data-message-id="${messageId}"]`);
          await message.getByTestId('response-group-disclosure').click();
          const rows = message.locator('[data-chat-operational-row]');
          await expect(rows).toHaveCount(messageId === 'assistant-streaming' ? 21 : 20);
          const groupContent = message.locator('[data-operational-expanded-content]').first();
          await groupContent.evaluate(async (element) => {
            await Promise.all(
              element
                .getAnimations({ subtree: true })
                .map((animation) => animation.finished.catch(() => {})),
            );
          });
          const geometry = await rows.evaluateAll((elements) =>
            elements.map((element) => {
              const row = element.querySelector('[data-operational-disclosure-row]')!;
              const box = row.getBoundingClientRect();
              const leading = element.querySelector('[data-operational-leading]')!;
              const icon = leading.querySelector('svg')!;
              const summary = element.querySelector<HTMLElement>('[data-operational-summary]')!;
              const wrapper = element.closest('[data-message-content-block]')!;
              const style = getComputedStyle(element);
              const wrapperStyle = getComputedStyle(wrapper);
              const cardBox = element.getBoundingClientRect();
              const leadingBox = leading.getBoundingClientRect();
              const iconBox = icon.getBoundingClientRect();
              const summaryBox = summary.getBoundingClientRect();
              const summaryStyle = getComputedStyle(summary);
              const baselineProbe = document.createElement('span');
              baselineProbe.style.cssText =
                'display:inline-block;width:0;height:0;margin:0;padding:0;vertical-align:baseline';
              summary.append(baselineProbe);
              const baseline = baselineProbe.getBoundingClientRect().bottom - box.top;
              baselineProbe.remove();
              const kind = icon.matches('[data-icon="brain"]')
                ? 'thinking'
                : element.getAttribute('data-testid') === 'response-group'
                  ? 'response-group'
                  : element.getAttribute('data-testid') === 'context-engine-tool-call'
                    ? 'context'
                    : 'tool';
              return {
                kind,
                nested: wrapper.hasAttribute('data-response-group-child'),
                top: box.top,
                bottom: box.bottom,
                height: row.getBoundingClientRect().height,
                cardEdges: [cardBox.left, cardBox.right],
                rowEdges: [box.left, box.right],
                rowCenter: (box.top + box.bottom) / 2,
                leading: leadingBox.width,
                leadingCenter: [
                  (leadingBox.left + leadingBox.right) / 2,
                  (leadingBox.top + leadingBox.bottom) / 2,
                ],
                icon: [iconBox.width, iconBox.height],
                iconCenter: [
                  (iconBox.left + iconBox.right) / 2,
                  (iconBox.top + iconBox.bottom) / 2,
                ],
                labelStart: summaryBox.left,
                baseline,
                insets: [
                  iconBox.left - box.left,
                  iconBox.top - box.top,
                  box.bottom - iconBox.bottom,
                ],
                summary: [
                  summaryStyle.minWidth,
                  summaryStyle.overflow,
                  summaryStyle.textOverflow,
                  summaryStyle.whiteSpace,
                ],
                summaryClipped: summary.scrollWidth > summary.clientWidth,
                margins: [
                  style.marginTop,
                  style.marginBottom,
                  wrapperStyle.marginTop,
                  wrapperStyle.marginBottom,
                ],
              };
            }),
          );
          for (const row of geometry) {
            expect(row.height).toBeCloseTo(28 * zoom, 1);
            expect(row.leading).toBeCloseTo(20 * zoom, 1);
            expect(row.icon).toEqual([16 * zoom, 16 * zoom]);
            expect(row.cardEdges).toEqual(row.rowEdges);
            expect(row.leadingCenter[1]).toBeCloseTo(row.rowCenter, 1);
            expect(row.iconCenter[1]).toBeCloseTo(row.rowCenter, 1);
            expect(row.labelStart - row.rowEdges[0]).toBeCloseTo(36 * zoom, 1);
            expect(row.insets[2] - row.insets[1]).toBeCloseTo(0, 1);
            expect(row.summary).toEqual(['0px', 'hidden', 'ellipsis', 'nowrap']);
            expect(row.margins).toEqual([
              '0px',
              row.kind === 'response-group' ? '12px' : '0px',
              '0px',
              '0px',
            ]);
          }
          if (width === 320) expect(geometry.some((row) => row.summaryClipped)).toBe(true);
          const pairOrders = new Set<string>();
          for (let index = 1; index < geometry.length; index += 1) {
            const previous = geometry[index - 1];
            const current = geometry[index];
            if (previous.kind !== 'thinking' && current.kind !== 'thinking') continue;
            if (previous.kind === 'thinking' && current.kind === 'thinking') continue;
            pairOrders.add(`${previous.kind}>${current.kind}`);
            const pairs = [[previous.baseline, current.baseline]];
            if (previous.nested === current.nested) {
              pairs.push(
                [previous.cardEdges[0], current.cardEdges[0]],
                [previous.cardEdges[1], current.cardEdges[1]],
                [previous.iconCenter[0], current.iconCenter[0]],
                [previous.labelStart, current.labelStart],
              );
            }
            for (const [before, after] of pairs) {
              expect(Math.abs(before - after)).toBeLessThanOrEqual(0.5);
            }
          }
          expect(pairOrders).toEqual(
            new Set([
              'thinking>tool',
              'tool>thinking',
              'thinking>context',
              'context>thinking',
              'thinking>response-group',
              'response-group>thinking',
            ]),
          );
          await expect(message.locator('[data-operational-stack]')).toHaveCSS('row-gap', '0px');

          if (messageId === 'assistant-streaming') {
            const streamingRow = message.getByTestId('reasoning-tool-call').last();
            await expect(streamingRow.locator('[data-operational-leading]')).toHaveClass(
              /animate-pulse/,
            );
            await expect(streamingRow.locator('[data-operational-expanded-content]')).toBeVisible();
          }

          const groupedIconCenter = await message
            .locator(
              `[data-tool-use-id="${messageId === 'assistant-finished' ? 'finished' : 'streaming'}-grouped-tool"]`,
            )
            .locator('[data-operational-leading]')
            .evaluate((element) => {
              const box = element.getBoundingClientRect();
              return (box.left + box.right) / 2;
            });
          const nestedProseStart = await message
            .locator('[data-response-group-child][data-message-content-block="text"] p')
            .first()
            .evaluate((element) => element.getBoundingClientRect().x);
          expect(groupedIconCenter).toBeCloseTo(nestedProseStart + 8 * zoom, 1);
          await expect(message.locator('[data-operational-expanded-guide]')).toHaveCount(1);

          if (messageId === 'assistant-finished') {
            // Measure relative to the message container: expanding can toggle
            // the transcript scrollbar, which shifts absolute coordinates.
            const staticRow = message.getByTestId('reasoning-tool-call').first();
            const measureRow = () =>
              staticRow.evaluate((element) => {
                const row = element.querySelector('[data-operational-disclosure-row]')!;
                const box = row.getBoundingClientRect();
                const host = element.closest('[data-message-id]')!.getBoundingClientRect();
                return [box.left - host.left, box.right - host.left, box.height];
              });
            const beforeExpansion = await measureRow();
            await staticRow.getByTestId('reasoning-disclosure').click();
            await expect(staticRow.locator('[data-operational-expanded-content]')).toBeVisible();
            const afterExpansion = await measureRow();
            expect(afterExpansion).toEqual(beforeExpansion);
          }
        }

        const finished = component.locator('[data-message-id="assistant-finished"]');
        await expect(
          finished.locator('[data-conversation-layer="tool-activity"] [data-operational-chevron]'),
        ).toHaveCount(0);
        const empty = finished.locator('[data-tool-use-id="finished-empty"]');
        await expect(empty.locator('button')).toHaveCount(0);
        await expect(empty.locator('[data-operational-trailing]')).toHaveCount(0);

        for (const [id, inputCount, outputCount] of [
          ['finished-input-only', 1, 0],
          ['finished-output-only', 0, 1],
          ['finished-both', 1, 1],
          ['finished-error', 1, 1],
          ['finished-long', 1, 1],
        ] as const) {
          const tool = finished.locator(`[data-tool-use-id="${id}"]`);
          const disclosure = tool.getByTestId('tool-call-disclosure');
          await disclosure.focus();
          await expect(disclosure).toBeFocused();
          await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
          await disclosure.press('Enter');
          await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
          const inline = tool.locator('[data-tool-details-inline]');
          await expect(inline).toBeVisible();
          await expect(inline.locator('details, summary')).toHaveCount(0);
          await expect(inline.getByText('Technical details', { exact: true })).toHaveCount(0);
          await expect(inline.locator('[data-tool-detail-section="input"]')).toHaveCount(
            inputCount,
          );
          await expect(inline.locator('[data-tool-detail-section="output"]')).toHaveCount(
            outputCount,
          );
          await expect
            .poll(() =>
              tool.evaluate((element) => {
                const row = element.querySelector('[data-operational-disclosure-row]')!;
                const details = element.querySelector('[data-tool-details-inline]')!;
                return details.getBoundingClientRect().top - row.getBoundingClientRect().bottom;
              }),
            )
            .toBeCloseTo(4 * zoom, 1);
          const alignment = await tool.evaluate((element) => {
            const row = element.querySelector('[data-operational-disclosure-row]')!;
            const summary = element.querySelector('[data-operational-summary]')!;
            const details = element.querySelector('[data-tool-details-inline]')!;
            const style = getComputedStyle(details);
            return {
              gap: details.getBoundingClientRect().top - row.getBoundingClientRect().bottom,
              summaryX: summary.getBoundingClientRect().x,
              detailsX: details.getBoundingClientRect().x,
              border: [
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
              ],
              radius: style.borderRadius,
              background: style.backgroundColor,
            };
          });
          expect(alignment.gap).toBeCloseTo(4 * zoom, 1);
          expect(alignment.detailsX).toBeCloseTo(alignment.summaryX, 1);
          expect(alignment.border).toEqual(['0px', '0px', '0px', '0px']);
          expect(alignment.radius).toBe('0px');
          expect(alignment.background).toBe('rgba(0, 0, 0, 0)');
        }

        const longPayload = finished.locator('[data-tool-use-id="finished-long"] pre').last();
        const longStyle = await longPayload.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            whiteSpace: style.whiteSpace,
            overflowY: style.overflowY,
            maxHeight: style.maxHeight,
          };
        });
        expect(longStyle.whiteSpace).toBe('pre-wrap');
        expect(longStyle.overflowY).toBe('auto');
        expect(Number.parseFloat(longStyle.maxHeight)).toBeGreaterThan(0);
      });
    }
  }
}
