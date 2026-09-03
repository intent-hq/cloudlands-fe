import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatEventGeometryHost from './ChatEventGeometryHost.svelte';

function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const channels = value
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('measures the production finished-card turn gap across all required states', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatEventGeometryHost, { props: { panelId: 'geometry' } });
  const summary = component.getByTestId('event-wakeup-summary');
  let measuredStates = 0;
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [360, 960]) {
      for (const zoom of [1, 2]) {
        for (const finishedVariant of ['agent:idle', 'agent:reportToParent'] as const) {
          for (const labelLength of ['short', 'long'] as const) {
            await component.update({
              props: {
                panelId: 'geometry',
                theme,
                width,
                zoom,
                finishedVariant,
                labelLength,
              },
            });
            const summaryLength = (await summary.textContent())!.length;
            if (labelLength === 'long') expect(summaryLength).toBeGreaterThan(50);
            else expect(summaryLength).toBeLessThan(50);
            for (const expanded of [false, true]) {
              if ((await summary.getAttribute('aria-expanded')) !== String(expanded)) {
                await summary.click();
                await page.waitForTimeout(180);
              }
              await expect(component.getByTestId('event-wakeup-card')).toBeVisible();
              await expect(component.getByTestId('following-transcript-row')).toBeVisible();
              const measurement = await component.evaluate((root) => {
                const card = root
                  .querySelector('[data-testid="event-wakeup-card"]')!
                  .getBoundingClientRect();
                const nextRow = root
                  .querySelector('[data-testid="following-transcript-row"]')!
                  .getBoundingClientRect();
                const sent = getComputedStyle(root.querySelector('[data-testid="sent-card"]')!);
                const finished = getComputedStyle(
                  root.querySelector('[data-testid="event-wakeup-header"]')!,
                );
                const surface = getComputedStyle(
                  root.querySelector('[data-testid="event-wakeup-card"]')!,
                );
                return {
                  cardTop: card.top,
                  cardBottom: card.bottom,
                  predecessorBottom: root
                    .querySelector('[data-testid="event-predecessor"]')!
                    .getBoundingClientRect().bottom,
                  nextRowTop: nextRow.top,
                  sentInset: [sent.paddingInlineStart, sent.paddingBlockStart],
                  finishedInset: [finished.paddingInlineStart, finished.paddingBlockStart],
                  finishedHeight: root
                    .querySelector('[data-testid="event-wakeup-header"]')!
                    .getBoundingClientRect().height,
                  surfaceInset: [surface.paddingInlineStart, surface.paddingBlockStart],
                };
              });
              expect(measurement.finishedInset).toEqual(measurement.sentInset);
              expect(measurement.finishedHeight).toBeCloseTo(36 * zoom, 1);
              expect(measurement.surfaceInset).toEqual(['0px', '0px']);
              const topGap = measurement.cardTop - measurement.predecessorBottom;
              const bottomGap = measurement.nextRowTop - measurement.cardBottom;
              expect(topGap).toBeCloseTo(32 * zoom, 1);
              expect(bottomGap).toBeCloseTo(32 * zoom, 1);
              expect(topGap).toBeCloseTo(bottomGap, 1);
              measuredStates += 1;
            }
          }
        }
      }
    }
  }
  expect(measuredStates).toBe(64);
});

test('matches sent-message disclosures to real finished event rows', async ({ mount, page }) => {
  const component = await mount(ChatEventGeometryHost, { props: { panelId: 'parity' } });
  const senderButton = component.getByTestId('agent-message-attribution');
  const agentToggle = component.getByTestId('agent-message-disclosure-toggle');
  const eventToggle = component.getByTestId('event-wakeup-summary');
  let measuredStates = 0;

  await expect(senderButton).toBeVisible();
  await expect(agentToggle).toHaveAttribute('aria-expanded', 'false');
  await senderButton.click();
  await expect(agentToggle).toHaveAttribute('aria-expanded', 'false');

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [360, 960]) {
      for (const zoom of [1, 2]) {
        for (const labelLength of ['short', 'long'] as const) {
          await component.update({
            props: { panelId: 'parity', theme, width, zoom, labelLength },
          });
          for (const toggle of [agentToggle, eventToggle]) {
            if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
          }
          await page.waitForTimeout(180);

          const collapsed = await component.evaluate((root) => {
            const element = (testId: string) =>
              root.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
            const rect = (node: Element) => {
              const value = node.getBoundingClientRect();
              return { top: value.top, right: value.right, bottom: value.bottom, left: value.left };
            };
            const style = (node: Element, properties: string[]) => {
              const computed = getComputedStyle(node);
              return Object.fromEntries(
                properties.map((property) => [property, computed.getPropertyValue(property)]),
              );
            };
            const surfaceProperties = [
              'border-top-width',
              'border-top-color',
              'border-radius',
              'background-color',
              'box-shadow',
            ];
            const rowProperties = [
              'height',
              'padding-inline-start',
              'padding-inline-end',
              'padding-block-start',
              'padding-block-end',
              'font-family',
              'font-size',
              'line-height',
              'font-weight',
              'color',
              'align-items',
              'justify-content',
              'overflow-x',
              'overflow-y',
            ];
            const agentCard = element('user-message-surface');
            const eventCard = element('event-wakeup-card');
            const agentRow = element('agent-message-disclosure-header');
            const eventRow = element('event-wakeup-header');
            const agentIcon = element('agent-message-avatar-column');
            const agentName = element('agent-message-actor-name');
            const agentActor = element('agent-message-attribution');
            const agentAction = element('agent-message-disclosure-toggle');
            const eventIcon = element('event-wakeup-leading-column');
            const eventSummary = element('event-wakeup-summary');
            const eventName = element('event-wakeup-agent-name');
            const eventStatus = element('event-wakeup-status');
            const agentChevron = element('agent-message-chevron-column');
            const eventChevron = element('event-wakeup-chevron-column');
            const preview = element('agent-message-preview');
            const senderName = element('agent-message-attribution').querySelector(
              'span.truncate[title]',
            )!;
            return {
              agentSurface: style(agentCard, surfaceProperties),
              eventSurface: style(eventCard, surfaceProperties),
              agentRow: style(agentRow, rowProperties),
              eventRow: style(eventRow, rowProperties),
              agentRowGap: getComputedStyle(agentRow).gap,
              eventRowGap: getComputedStyle(eventRow).gap,
              agentCardRect: rect(agentCard),
              eventCardRect: rect(eventCard),
              agentRowRect: rect(agentRow),
              eventRowRect: rect(eventRow),
              agentIconRect: rect(agentIcon),
              agentNameRect: rect(agentName),
              agentActorRect: rect(agentActor),
              agentActionRect: rect(agentAction),
              eventIconRect: rect(eventIcon),
              eventSummaryRect: rect(eventSummary),
              eventNameRect: rect(eventName),
              eventStatusRect: rect(eventStatus),
              agentChevronRect: rect(agentChevron),
              eventChevronRect: rect(eventChevron),
              ellipsisStyles: [preview, senderName].map((node) => {
                const computed = getComputedStyle(node);
                return {
                  hasTruncateClass: node.classList.contains('truncate'),
                  overflowX: computed.overflowX,
                  textOverflow: computed.textOverflow,
                  whiteSpace: computed.whiteSpace,
                };
              }),
            };
          });

          expect(collapsed.agentSurface).toEqual(collapsed.eventSurface);
          expect(collapsed.agentRow).toEqual(collapsed.eventRow);
          expect(collapsed.agentRowGap).toBe('8px');
          expect(collapsed.eventRowGap).toBe('8px');
          expect(collapsed.agentRow['justify-content']).toBe('flex-start');
          expect(collapsed.agentNameRect.left - collapsed.agentIconRect.right).toBeCloseTo(
            8 * zoom,
            1,
          );
          expect(collapsed.agentActionRect.left - collapsed.agentActorRect.right).toBeCloseTo(
            8 * zoom,
            1,
          );
          expect(collapsed.eventSummaryRect.left - collapsed.eventIconRect.right).toBeCloseTo(
            8 * zoom,
            1,
          );
          expect(collapsed.eventStatusRect.left - collapsed.eventNameRect.right).toBeCloseTo(
            4 * zoom,
            1,
          );
          expect(collapsed.agentIconRect.left - collapsed.agentRowRect.left).toBeCloseTo(
            12 * zoom,
            1,
          );
          expect(collapsed.agentRowRect.bottom - collapsed.agentRowRect.top).toBeCloseTo(
            36 * zoom,
            1,
          );
          expect(collapsed.agentRowRect.bottom - collapsed.agentRowRect.top).toBeCloseTo(
            collapsed.eventRowRect.bottom - collapsed.eventRowRect.top,
            1,
          );
          expect(collapsed.agentCardRect.bottom - collapsed.agentCardRect.top).toBeCloseTo(
            collapsed.eventCardRect.bottom - collapsed.eventCardRect.top,
            1,
          );
          expect(
            (collapsed.agentIconRect.top + collapsed.agentIconRect.bottom) / 2 -
              (collapsed.agentRowRect.top + collapsed.agentRowRect.bottom) / 2,
          ).toBeCloseTo(0, 1);
          expect(
            (collapsed.eventIconRect.top + collapsed.eventIconRect.bottom) / 2 -
              (collapsed.eventRowRect.top + collapsed.eventRowRect.bottom) / 2,
          ).toBeCloseTo(0, 1);
          expect(collapsed.agentChevronRect.right - collapsed.agentChevronRect.left).toBeCloseTo(
            collapsed.eventChevronRect.right - collapsed.eventChevronRect.left,
            1,
          );
          expect(collapsed.agentChevronRect.bottom - collapsed.agentChevronRect.top).toBeCloseTo(
            collapsed.eventChevronRect.bottom - collapsed.eventChevronRect.top,
            1,
          );
          if (labelLength === 'long') {
            for (const ellipsisStyle of collapsed.ellipsisStyles) {
              expect(ellipsisStyle).toEqual({
                hasTruncateClass: true,
                overflowX: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              });
            }
          }

          const interactionStyle = async (state: 'hover' | 'focus', target: typeof agentToggle) => {
            if (state === 'hover') await target.hover();
            else await target.focus();
            return target.evaluate((node) => {
              const computed = getComputedStyle(node);
              return {
                backgroundColor: computed.backgroundColor,
                color: computed.color,
                boxShadow: computed.boxShadow,
                outline: `${computed.outlineWidth} ${computed.outlineStyle} ${computed.outlineColor}`,
              };
            });
          };
          for (const state of ['hover', 'focus'] as const) {
            expect(await interactionStyle(state, agentToggle)).toEqual(
              await interactionStyle(state, eventToggle),
            );
          }
          await senderButton.focus();
          await expect(senderButton).toBeFocused();
          await agentToggle.focus();
          await expect(agentToggle).toBeFocused();

          await agentToggle.click();
          await eventToggle.click();
          await page.waitForTimeout(180);
          const expanded = await component.evaluate((root) => {
            const body = (testId: string) =>
              root.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
            const measure = (node: HTMLElement, card: HTMLElement) => {
              const computed = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              const cardRect = card.getBoundingClientRect();
              return {
                borderTop: `${computed.borderTopWidth} ${computed.borderTopStyle} ${computed.borderTopColor}`,
                padding: [
                  computed.paddingInlineStart,
                  computed.paddingInlineEnd,
                  computed.paddingBlockStart,
                  computed.paddingBlockEnd,
                ],
                inlineInsets: [rect.left - cardRect.left, cardRect.right - rect.right],
              };
            };
            return {
              agent: measure(body('agent-message-expanded-body'), body('user-message-surface')),
              event: measure(body('event-wakeup-details'), body('event-wakeup-card')),
            };
          });
          expect(expanded.agent.borderTop).toBe(expanded.event.borderTop);
          expect(expanded.agent.padding.slice(1)).toEqual(expanded.event.padding.slice(1));
          expect(expanded.agent.inlineInsets[1]).toBeCloseTo(expanded.event.inlineInsets[1], 1);
          measuredStates += 1;
        }
      }
    }
  }
  expect(measuredStates).toBe(16);
});

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2] as const) {
    for (const chiefVariant of [false, true]) {
      test(`uses canonical sidebar user-message colors in ${theme} at ${zoom * 100}% (chiefVariant=${chiefVariant})`, async ({
        mount,
      }) => {
        const component = await mount(ChatEventGeometryHost, {
          props: { panelId: `colors-${theme}-${zoom}-${chiefVariant}`, theme, zoom, chiefVariant },
        });
        await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
        await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();

        const styles = await component.evaluate((root) => {
          const style = (selector: string, pseudo?: string) =>
            getComputedStyle(root.querySelector(selector) as Element, pseudo);
          const resolveToken = (token: string, property: 'backgroundColor' | 'color') => {
            const probe = document.createElement('span');
            probe.style[property] = `hsl(${getComputedStyle(root).getPropertyValue(token)})`;
            root.append(probe);
            const value = getComputedStyle(probe)[property];
            probe.remove();
            return value;
          };
          return {
            surface: resolveToken('--sidebar', 'backgroundColor'),
            surfaceForeground: resolveToken('--secondary-foreground', 'color'),
            ordinaryBackground: style('[data-testid="sent-card"]').backgroundColor,
            ordinaryBorderWidth: style('[data-testid="sent-card"]').borderTopWidth,
            pinnedBackground: style('[data-testid="pinned-user-prompt"]').backgroundColor,
            pinnedBorderWidth: style('[data-testid="pinned-user-prompt"]').borderTopWidth,
            attributedBackground: style(
              '[data-testid="attributed-message-lane"] [data-testid="user-message-surface"]',
            ).backgroundColor,
            eventBackground: style('[data-testid="event-wakeup-card"]').backgroundColor,
            ordinaryText: style('[data-testid="ordinary-user-text"]').color,
            pinnedText: style('[data-testid="pinned-user-prompt-text"]').color,
            linkText: style('[data-testid="ordinary-user-link"]').color,
            codeText: style('[data-testid="ordinary-user-code"]').color,
            codeBackground: style('[data-testid="ordinary-user-code"]').backgroundColor,
            selectionBackground: style('[data-testid="pinned-user-prompt-text"]', '::selection')
              .backgroundColor,
            selectionText: style('[data-testid="pinned-user-prompt-text"]', '::selection').color,
          };
        });

        expect(styles.ordinaryBackground).toBe(styles.surface);
        expect(styles.pinnedBackground).toBe(styles.surface);
        expect(styles.attributedBackground).not.toBe(styles.surface);
        expect(styles.eventBackground).not.toBe(styles.surface);
        expect(styles.ordinaryBorderWidth).toBe('0px');
        expect(styles.pinnedBorderWidth).toBe('0px');
        expect(styles.ordinaryText).toBe(styles.surfaceForeground);
        expect(styles.pinnedText).toBe(styles.surfaceForeground);
        expect(styles.linkText).toBe(styles.surfaceForeground);
        expect(styles.codeText).toBe(styles.surfaceForeground);
        expect(styles.codeBackground).toBe('rgba(0, 0, 0, 0)');
        expect(contrastRatio(styles.pinnedText, styles.pinnedBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrastRatio(styles.linkText, styles.ordinaryBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrastRatio(styles.codeText, styles.ordinaryBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(styles.selectionText, styles.selectionBackground),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
}

for (const chiefVariant of [false, true]) {
  test(`aligns the pinned bubble with in-conversation bubbles across the scrollbar gutter (chiefVariant=${chiefVariant})`, async ({
    mount,
  }) => {
    const component = await mount(ChatEventGeometryHost, {
      props: { panelId: `align-${chiefVariant}`, chiefVariant },
    });
    await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
    await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();

    const geometry = await component.evaluate((root) => {
      const rect = (selector: string) => {
        const { left, right, width } = root.querySelector(selector)!.getBoundingClientRect();
        return { left, right, width };
      };
      const scroll = root.querySelector('[data-testid="sticky-scroll"]') as HTMLElement;
      const overlay = root.querySelector(
        '[data-testid="pinned-prompt-overlay-host"]',
      ) as HTMLElement;
      return {
        gutter: Number.parseFloat(getComputedStyle(overlay).paddingInlineEnd),
        nativeGutter: scroll.offsetWidth - scroll.clientWidth,
        lane: rect('[data-testid="pinned-prompt-overlay-lane"]'),
        column: rect('[data-testid="conversation-column"]'),
        pinned: rect('[data-testid="pinned-user-prompt"]'),
        bubble: rect('[data-testid="in-conversation-user-bubble"]'),
      };
    });

    expect(geometry.gutter).toBeGreaterThan(0);
    expect(geometry.lane.left).toBeCloseTo(geometry.column.left, 1);
    expect(geometry.lane.width).toBeCloseTo(geometry.column.width, 1);
    expect(geometry.pinned.left).toBeCloseTo(geometry.bubble.left, 1);
    expect(geometry.pinned.right).toBeCloseTo(geometry.bubble.right, 1);
  });
}

test('tracks sticky entry, streaming, pagination, and per-panel ownership', async ({
  mount,
  page,
}) => {
  const first = await mount(ChatEventGeometryHost, { props: { panelId: 'first' } });
  await first.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
  await expect(first.getByTestId('pinned-user-prompt')).toBeVisible();

  await first.locator('[data-pinnable-user-prompt]').evaluate((node) => {
    const source = node as HTMLElement & { __pinnedPromptMessage?: unknown };
    source.__pinnedPromptMessage = {
      id: 'first-prompt',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Streaming update' }],
    };
    source.textContent = 'Streaming update';
  });
  await expect(first.getByTestId('pinned-user-prompt')).toContainText('Streaming update');
  await first.getByTestId('sticky-scroll').evaluate((node) => {
    const spacer = document.createElement('div');
    spacer.style.height = '120px';
    node.prepend(spacer);
    node.scrollTo(0, 450);
  });
  await expect(first.getByTestId('pinned-user-prompt')).toBeVisible();

  await mount(ChatEventGeometryHost, { props: { panelId: 'second' } });
  const firstPanel = page.locator('[data-panel="first"]');
  const secondPanel = page.locator('[data-panel="second"]');
  await expect(firstPanel.getByTestId('pinned-user-prompt')).toBeVisible();
  await expect(secondPanel.getByTestId('pinned-user-prompt')).toHaveCount(0);

  await firstPanel.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 0));
  await expect(firstPanel.getByTestId('pinned-user-prompt')).toHaveCount(0);
});

test('uses a deterministic non-animated sticky surface with reduced motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatEventGeometryHost, { props: { panelId: 'reduced' } });
  await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
  const prompt = component.getByTestId('pinned-user-prompt');
  await expect(prompt).toBeVisible();
  expect(
    await prompt.evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration)),
  ).toBeLessThanOrEqual(0.001);
});
