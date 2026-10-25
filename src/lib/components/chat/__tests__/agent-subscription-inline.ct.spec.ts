import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, expectAnimationsToSettle, test } from '../../../../test/ct-test';
import AgentSubscriptionInlineHost from './AgentSubscriptionInlineHost.svelte';

const toolKinds = ['file', 'terminal', 'tool'] as const;

const delegatedTaskSets = [
  [{ id: 'pending', title: 'Pending row task', status: 'pending' }],
  [{ id: 'running', title: 'Running row task', status: 'running' }],
  [{ id: 'completed', title: 'Completed row task', status: 'completed' }],
  [
    { id: 'mixed-pending', title: 'Mixed pending task', status: 'pending' },
    { id: 'mixed-running', title: 'Mixed running task', status: 'running' },
    { id: 'mixed-completed', title: 'Mixed completed task', status: 'completed' },
  ],
  Array.from({ length: 7 }, (_, index) => ({
    id: `overflow-${index}`,
    title: `Overflow row task ${index + 1}`,
    status: index === 6 ? ('completed' as const) : ('pending' as const),
  })),
] as const;
const delegatedTaskLabels = [
  'Task progress: 0 of 1 completed',
  'Task progress: 0 of 1 completed',
  'Task progress: 1 of 1 completed',
  'Task progress: 1 of 3 completed',
  'Task progress: 1 of 7 completed',
] as const;

test.beforeEach(async ({ page }) => {
  // Load the bundled face before the avatar stack caches canvas text measurements.
  const fontsLoaded = await page.evaluate(async () => {
    const faces = await Promise.all(
      ['400 15px "Inter Variable"', '500 12px "Inter Variable"'].map((font) =>
        document.fonts.load(font),
      ),
    );
    return faces.every(
      (loaded) => loaded.length > 0 && loaded.every((face) => face.status === 'loaded'),
    );
  });
  expect(fontsLoaded).toBe(true);
});

test.afterEach(async ({ page }) => {
  await page.locator('#root').evaluate(async (root) => {
    if (root.childElementCount > 0) await window.playwrightUnmount(root);
  });
});

test('keeps one checklist control per delegated row across themes, narrow width, and motion settings', async ({
  mount,
  page,
}) => {
  const taskSets = delegatedTaskSets.map((tasks) => [...tasks]);
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { agentCount: taskSets.length, taskSets, width: 240 },
  });

  await expect.poll(() => page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      for (const zoom of [1, 2]) {
        await page.emulateMedia({ reducedMotion });
        await component.update({
          props: { agentCount: taskSets.length, taskSets, width: 240, theme, zoom },
        });
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(0, 0);
        const triggers = component.getByTestId('task-progress-trigger');
        await expect(triggers).toHaveCount(taskSets.length);
        await expect(component.getByTestId('task-progress-checklist-icon')).toHaveCount(
          taskSets.length,
        );
        await expect(component.getByTestId('task-progress-icon-stack')).toHaveCount(0);
        await expect(component.getByTestId('task-progress-status-icon')).toHaveCount(0);
        await expect(component.getByTestId('task-progress-overflow-indicator')).toHaveCount(0);
        for (let index = 0; index < taskSets.length; index += 1) {
          await expect(triggers.nth(index)).toHaveCSS('opacity', '0');
          await expect(triggers.nth(index)).toHaveAccessibleName(delegatedTaskLabels[index]);
          await expect(triggers.nth(index).locator('svg')).toHaveCount(1);
          await expect(triggers.nth(index)).toHaveText('');
        }
        await expect(triggers.first()).toHaveCSS(
          'transition-property',
          reducedMotion === 'reduce' ? 'none' : /opacity/,
        );
        await expect(component.getByTestId('agent-list-item').first()).toHaveCSS(
          'overflow',
          'hidden',
        );
      }
    }
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await component.update({
    props: { agentCount: taskSets.length, taskSets, width: 240, theme: 'light', zoom: 1 },
  });
  const triggers = component.getByTestId('task-progress-trigger');
  const firstGeometry = await triggers.first().boundingBox();
  await component.getByTestId('agent-list-item').first().hover();
  await expect(triggers.first()).toHaveCSS('opacity', '1');
  for (let index = 1; index < taskSets.length; index += 1) {
    await expect(triggers.nth(index)).toHaveCSS('opacity', '0');
  }
  expect(await triggers.first().boundingBox()).toEqual(firstGeometry);
  await page.mouse.move(0, 0);
  await expect(triggers.first()).toHaveCSS('opacity', '0');

  const firstRowButton = component.getByTestId('agent-list-item').first().locator('button').first();
  await firstRowButton.focus();
  await page.keyboard.press('Tab');
  await expect(triggers.first()).toBeFocused();
  await expect(triggers.first()).toHaveCSS('opacity', '1');
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toHaveCount(0);
  await component.getByTestId('agent-list-item').first().hover();
  await expect(page.getByRole('tooltip', { name: delegatedTaskLabels[0] })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toHaveCount(0);

  await triggers.first().click();
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toBeVisible();
  await expect(triggers.first()).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(0, 0);
  await expect(triggers.first()).toHaveCSS('opacity', '1');
  expect(await triggers.first().boundingBox()).toEqual(firstGeometry);
  await expect(triggers.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('tooltip', { name: delegatedTaskLabels[0] })).toHaveCount(0);

  await triggers.first().click();
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await expect(triggers.first()).toHaveCSS('opacity', '0');
  expect(await triggers.first().boundingBox()).toEqual(firstGeometry);

  await triggers.nth(1).click();
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toBeVisible();
  await expect(triggers.first()).toHaveAttribute('aria-expanded', 'false');
  await expect(triggers.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toHaveCount(0);
  await expect(triggers.nth(1)).toBeFocused();
  await expect(triggers.nth(1)).toHaveCSS('opacity', '1');
});

test('keeps delegated checklist controls visible for non-hover primary input', async ({
  mount,
  page,
}) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await expect
    .poll(() => page.evaluate(() => matchMedia('(hover: none), (pointer: coarse)').matches))
    .toBe(true);

  const component = await mount(AgentSubscriptionInlineHost, {
    props: { agentCount: 2, taskSets: delegatedTaskSets.slice(0, 2).map((tasks) => [...tasks]) },
  });
  await page.mouse.move(0, 0);
  await expect(component.getByTestId('task-progress-trigger').first()).toHaveCSS('opacity', '1');
  await client.detach();
});

test('isolates outside-dismissed task help between delegated row controls', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: {
      agentCount: 2,
      taskSets: [delegatedTaskSets[0], delegatedTaskSets[2]].map((tasks) => [...tasks]),
      showOutsideTarget: true,
    },
  });
  const rows = component.getByTestId('agent-list-item');
  const triggers = component.getByTestId('task-progress-trigger');
  const firstTooltip = page.getByRole('tooltip', { name: delegatedTaskLabels[0] });
  const secondTooltip = page.getByRole('tooltip', { name: delegatedTaskLabels[2] });

  await rows.first().hover();
  await triggers.first().hover();
  await expect(firstTooltip).toBeVisible();
  await triggers.first().click();
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).toBeVisible();
  await component.getByTestId('outside-target').click();
  await expect(page.getByRole('dialog', { name: 'Agent tasks' })).not.toBeVisible();

  await triggers.first().hover();
  await page.waitForTimeout(350);
  await expect(firstTooltip).not.toBeVisible();
  await triggers.nth(1).focus();
  await expect(secondTooltip).toBeVisible();

  await page.mouse.move(0, 0);
  await triggers.first().hover();
  await expect(firstTooltip).toBeVisible();
});

async function measure(component: Locator, page: Page) {
  await expect(component.getByTestId('agent-card-preview')).toBeVisible();
  await expect(
    component.getByTestId('agent-card-trailing-slot').locator('[data-slot="tooltip-trigger"]'),
  ).toHaveCount(1);
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="agent-preview-tool-text"]');
    return !text || (text.textContent?.trim().length ?? 0) > 0;
  });
  return component.evaluate((root) => {
    const element = (testId: string) =>
      root.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    const preview = element('agent-card-preview');
    const toolText = root.querySelector(
      '[data-testid="agent-preview-tool-text"]',
    ) as HTMLElement | null;
    const name = element('agent-card-name');
    const timestamp = element('agent-card-trailing-slot').querySelector(
      '[data-slot="tooltip-trigger"]',
    ) as HTMLElement;
    const row = element('agent-list-item').querySelector('button') as HTMLElement;
    const header = element('one-shot-summary-toggle');
    const rows = Array.from(root.querySelectorAll('[data-testid="agent-list-item"] button'));
    const rect = (node: Element) => {
      const value = node.getBoundingClientRect();
      return {
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        left: value.left,
        width: value.width,
        height: value.height,
      };
    };
    const textStyle = (node: Element) => {
      const style = getComputedStyle(node);
      return { color: style.color, opacity: style.opacity, fontWeight: style.fontWeight };
    };
    const geometryStyle = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        paddingInlineStart: style.paddingInlineStart,
        paddingInlineEnd: style.paddingInlineEnd,
        paddingBlockStart: style.paddingBlockStart,
        paddingBlockEnd: style.paddingBlockEnd,
        minHeight: style.minHeight,
      };
    };
    return {
      nameStyle: textStyle(name),
      previewStyle: textStyle(toolText ?? preview),
      timestampStyle: textStyle(timestamp),
      rowGeometry: geometryStyle(row),
      headerGeometry: geometryStyle(header),
      rowHeights: rows.map((current) => rect(current).height),
      headerHeight: rect(header).height,
      nameRect: rect(name),
      previewRect: rect(preview),
      toolTextRect: toolText ? rect(toolText) : null,
      timestampRect: rect(timestamp),
      trailingStyle: {
        width: getComputedStyle(element('agent-card-trailing-slot')).width,
        flexShrink: getComputedStyle(element('agent-card-trailing-slot')).flexShrink,
      },
      timestampTextAlign: getComputedStyle(timestamp).textAlign,
      timestampNumeric: getComputedStyle(timestamp).fontVariantNumeric,
      previewOverflow: {
        clientWidth: (toolText ?? preview).clientWidth,
        scrollWidth: (toolText ?? preview).scrollWidth,
        overflowX: getComputedStyle(toolText ?? preview).overflowX,
        whiteSpace: getComputedStyle(toolText ?? preview).whiteSpace,
        textOverflow: getComputedStyle(toolText ?? preview).textOverflow,
      },
      cleanText: (toolText ?? preview).textContent?.trim() ?? '',
      cleanTitle: (toolText ?? preview).getAttribute('title') ?? '',
      interactiveCount: preview.querySelectorAll('a, button, input, [tabindex]').length,
      peekIconCount: preview.querySelectorAll('svg, .agent-preview-tool-icon').length,
      peekAriaLabelCount: preview.querySelectorAll('[aria-label]').length,
      rowOverflow: row.scrollWidth - row.clientWidth,
    };
  });
}

test('cleans Markdown and keeps one true ellipsis region clear of the timestamp', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost);
  for (const previewKind of [...toolKinds, 'text'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { previewKind, width: 270, zoom } });
      if (previewKind === 'text') {
        await expect
          .poll(() =>
            component
              .getByTestId('agent-card-preview')
              .evaluate((node) => node.scrollWidth - node.clientWidth),
          )
          .toBeGreaterThan(0);
      }
      const value = await measure(component, page);
      expect(value.cleanText).not.toMatch(/[`*_\[\]]/);
      expect(value.cleanTitle).toBe(
        value.previewOverflow.scrollWidth > value.previewOverflow.clientWidth
          ? value.cleanText
          : '',
      );
      expect(value.interactiveCount).toBe(0);
      expect(value.previewOverflow.scrollWidth).toBeGreaterThanOrEqual(
        value.previewOverflow.clientWidth,
      );
      if (previewKind === 'text') {
        expect(value.previewOverflow.scrollWidth).toBeGreaterThan(
          value.previewOverflow.clientWidth,
        );
      }
      expect(value.previewOverflow.whiteSpace).toBe('nowrap');
      expect(value.previewOverflow.textOverflow).toBe('ellipsis');
      expect(value.previewRect.right).toBeLessThanOrEqual(value.timestampRect.left + 0.5);
      expect(value.rowOverflow).toBeLessThanOrEqual(0);
      expect(value.trailingStyle.flexShrink).toBe('0');
      expect(value.timestampNumeric).toContain('tabular-nums');
      expect(value.peekIconCount).toBe(0);
      expect(value.peekAriaLabelCount).toBe(0);
    }
  }
});

test('keeps keyed waiting and finished rows stable through add, remove, reorder, and interruption', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { agentCount: 7, finishedCount: 2 },
  });
  await component.getByTestId('agent-list-item').first().locator('button').focus();
  const focusedId = await page.evaluate(() =>
    document.activeElement?.closest('[data-agent-id]')?.getAttribute('data-agent-id'),
  );
  expect(focusedId).toBe('agent-subscription-inline-geometry');

  await component.update({ props: { agentCount: 7, finishedCount: 2, reverseAgents: true } });
  expect(
    await page.evaluate(() =>
      document.activeElement?.closest('[data-agent-id]')?.getAttribute('data-agent-id'),
    ),
  ).toBe(focusedId);

  await component.update({ props: { agentCount: 3, finishedCount: 0, reverseAgents: true } });
  await component.update({ props: { agentCount: 9, finishedCount: 0, reverseAgents: false } });
  await component.update({ props: { agentCount: 4, finishedCount: 0, reverseAgents: true } });
  await page.waitForTimeout(220);

  const rows = component.locator('[data-subscription-motion-row]');
  await expect(rows).toHaveCount(4);
  expect(
    await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-agent-id'))),
  ).toEqual([
    'agent-subscription-filler-3',
    'agent-subscription-filler-2',
    'agent-subscription-filler-1',
    'agent-subscription-inline-geometry',
  ]);
});

test('updates the finished cohort count and supports disclosure', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 7, finishedCount: 2, initiallyExpanded: true },
  });
  for (const finishedCount of [2, 5]) {
    await component.update({
      props: { mode: 'agents', agentCount: 7, finishedCount, initiallyExpanded: true },
    });
    const waitingSummary = component.getByTestId('one-shot-summary-toggle');
    if ((await waitingSummary.getAttribute('aria-expanded')) === 'false') {
      await waitingSummary.click();
    }
    const summary = component.getByTestId('finished-agent-summary');
    if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
    await expect(summary).toHaveText(`${finishedCount} agents finished`);
    await expect(
      summary.locator('time, [title], [data-finished-at], [role="tooltip"]'),
    ).toHaveCount(0);
    await expect(component.getByTestId('finished-agent-group')).not.toHaveAttribute(
      'data-finished-at',
    );

    await summary.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
  }
});

test('keeps completed avatars accessible and distinct from active agents', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 7, finishedCount: 2, initiallyExpanded: true },
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [270, 420]) {
      for (const zoom of [1, 2]) {
        await component.update({
          props: {
            mode: 'agents',
            agentCount: 7,
            finishedCount: 2,
            initiallyExpanded: true,
            theme,
            width,
            zoom,
          },
        });
        const waitingSummary = component.getByTestId('one-shot-summary-toggle');
        if ((await waitingSummary.getAttribute('aria-expanded')) === 'false') {
          await waitingSummary.click();
        }
        const summary = component.getByTestId('finished-agent-summary');
        if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();

        await summary.click();
        const completed = component
          .getByTestId('finished-agent-list')
          .locator('[data-agent-avatar-with-state]')
          .first();
        await expect(completed).toHaveAttribute('data-avatar-state', 'completed');
        await expect(completed.locator('[data-avatar-overlay], [data-icon]')).toHaveCount(0);
        // A completed avatar must not keep the active pulse: wait out any finite state
        // transition (an infinite pulse never settles and fails), then read settled colors.
        await expectAnimationsToSettle(completed, { subtree: false });
        const colors = await completed.evaluate((avatar) => {
          const parseRgb = (value: string) =>
            (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
          const luminance = ([red, green, blue]: [number, number, number]) => {
            const channel = (value: number) => {
              const normalized = value / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
          };
          const contrast = (first: string, second: string) => {
            const values = [luminance(parseRgb(first)), luminance(parseRgb(second))].sort(
              (left, right) => right - left,
            );
            return (values[0] + 0.05) / (values[1] + 0.05);
          };
          const chroma = (value: string) => {
            const channels = parseRgb(value);
            return Math.max(...channels) - Math.min(...channels);
          };
          const resolveBackground = (variable: string) => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = `hsl(var(${variable}))`;
            avatar.append(probe);
            const value = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return value;
          };
          const avatarStyle = getComputedStyle(avatar);
          const card = avatar.closest('[data-testid="agent-subscriptions-card"]') as HTMLElement;
          const icon = card.querySelector('[data-icon="circle-check"]') as SVGElement;
          const title = card.querySelector(
            '[data-testid="finished-agent-summary-title"]',
          ) as HTMLElement;
          const completedBackground = avatarStyle.backgroundColor;
          const completedForeground = avatarStyle.color;
          const avatarArt = avatar.querySelector('[data-agent-avatar]') as SVGElement;
          const avatarArtStyle = getComputedStyle(avatarArt);
          const parentStyle = getComputedStyle(avatar.parentElement!);
          const activeBackground = resolveBackground('--agent-avatar-surface-active');
          const waitingBackground = resolveBackground('--agent-avatar-surface-waiting');
          const cardBackground = getComputedStyle(card).backgroundColor;

          return {
            design: avatar.querySelector('[data-agent-avatar]')?.getAttribute('data-avatar-design'),
            completedBackground,
            completedForeground,
            avatarOpacity: avatarStyle.opacity,
            avatarArtColor: avatarArtStyle.color,
            avatarArtOpacity: avatarArtStyle.opacity,
            parentOpacity: parentStyle.opacity,
            parentColor: parentStyle.color,
            cardBackground,
            cardOpacity: getComputedStyle(card).opacity,
            activeBackground,
            waitingBackground,
            completedContrast: contrast(completedForeground, completedBackground),
            iconColor: getComputedStyle(icon).color,
            iconOpacity: getComputedStyle(icon).opacity,
            titleColor: getComputedStyle(title).color,
            titleOpacity: getComputedStyle(title).opacity,
            completedChroma: chroma(completedBackground),
            activeChroma: chroma(activeBackground),
            waitingChroma: chroma(waitingBackground),
          };
        });
        expect(colors.design).toBeTruthy();
        expect(colors.completedBackground).not.toBe(colors.activeBackground);
        expect(colors.completedBackground).not.toBe(colors.waitingBackground);
        expect(colors.avatarOpacity).toBe('1');
        expect(colors.avatarArtOpacity).toBe('1');
        expect(colors.parentOpacity).toBe('1');
        expect(colors.cardOpacity).toBe('1');
        expect(colors.avatarArtColor).toBe(colors.completedForeground);
        expect(colors.completedContrast, JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
        expect(colors.iconColor).toBe(colors.titleColor);
        expect(colors.iconOpacity).toBe(colors.titleOpacity);
        expect(colors.completedChroma).toBeLessThan(colors.activeChroma);
        expect(colors.completedChroma).toBeLessThan(colors.waitingChroma);
      }
    }
  }
});

test('renders exactly one promoted Waiting disclosure in agent-only mode', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, { props: { mode: 'agents' } });
  await expect(component.getByTestId('event-subscriptions-outer-header')).toHaveCount(0);
  await expect(component.getByTestId('event-subscriptions-summary')).toHaveCount(0);
  await expect(component.getByTestId('one-shot-summary-toggle')).toHaveCount(1);
  await expect(component.getByText('Waiting for 7 agents', { exact: true })).toHaveCount(1);
});

test('keeps the footer hidden while an empty agent lane is still loading', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { snapshotStatus: 'loading' },
  });

  await expect(component.getByTestId('subscription-utility-area')).toHaveAttribute(
    'data-has-subscriptions',
    'false',
  );
  await expect(component.getByTestId('subscription-utility-area')).toBeHidden();
  await expect(component.getByTestId('agent-subscriptions-snapshot-status')).toHaveCount(0);
});

test('keeps the agent lane visible while its snapshot is failed', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { snapshotStatus: 'failed' },
  });

  await expect(component.getByTestId('subscription-utility-area')).toBeVisible();
  await expect(component.getByTestId('event-subscriptions-agents')).toBeVisible();
  await expect(component.getByTestId('event-subscriptions-outer-header')).toHaveCount(0);
  await expect(component.getByTestId('background-hooks-snapshot-status')).toHaveCount(0);
  await expect(component.getByTestId('pr-monitors-snapshot-status')).toHaveCount(0);
  await expect(component.getByTestId('agent-subscriptions-snapshot-status')).toBeVisible();
  await expect(component.getByTestId('agent-subscriptions-snapshot-status')).toHaveAttribute(
    'data-snapshot-status',
    'failed',
  );
});

test('keeps the outer Subscribed header and a distinct cohort header in mixed mode', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, { props: { mode: 'mixed' } });
  await expect(component.getByTestId('event-subscriptions-outer-header')).toHaveCount(1);
  await expect(component.getByRole('button', { name: 'Subscribed to 8 events' })).toHaveCount(1);
  await expect(component.getByText('Waiting for 7 agents', { exact: true })).toHaveCount(1);
  await expect(component.getByTestId('mixed-subscription-preview')).toBeVisible();
});

test('caps one through eight participants at three and computes overflow from remaining agents', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 1, width: 600, initiallyExpanded: false },
  });
  const summary = component.getByTestId('one-shot-summary-toggle');

  for (let agentCount = 1; agentCount <= 8; agentCount += 1) {
    await component.update({
      props: { mode: 'agents', agentCount, width: 600, initiallyExpanded: false },
    });
    if (agentCount === 1) {
      await expect(component.getByTestId('agent-list-item')).toHaveCount(1);
      await expect(summary).toHaveCount(0);
      await expect(component.getByTestId('one-shot-header')).toHaveCount(0);
      continue;
    }
    if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
    const stack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
    const visibleCount = Math.min(agentCount, 3);
    await expect
      .poll(() => stack.locator('[data-agent-avatar-with-state]').count())
      .toBe(visibleCount);
    if (agentCount === visibleCount) {
      await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveCount(0);
    } else {
      await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText(
        `+${agentCount - visibleCount}`,
      );
    }
    await expect(stack.locator('[data-icon]')).toHaveCount(0);
  }

  for (const [agentCount, remaining] of [
    [9, 6],
    [12, 9],
  ] as const) {
    await component.update({
      props: { mode: 'agents', agentCount, width: 600, initiallyExpanded: false },
    });
    const stack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
    await expect.poll(() => stack.locator('[data-agent-avatar-with-state]').count()).toBe(3);
    await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText(`+${remaining}`);
  }

  await component.update({
    props: { mode: 'agents', agentCount: 6, width: 120, initiallyExpanded: false },
  });
  const narrowStack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
  /* The adaptive stack applies ResizeObserver widths one animation frame later
     (createDeferredWidthApplier), so after a width change the visible count
     settles asynchronously. Reading count() and the badge in separate calls
     can straddle that settling frame (#4019) — read both atomically in one
     evaluate and assert the pair is self-consistent. A leading double rAF
     lets any ResizeObserver delivery pending at entry fire (next frame) and
     its deferred width apply (the frame after) before the first read, and
     agreement across a second double rAF guards against a delivery arriving
     mid-check — so the poll observes the settled adaptive state rather than
     passing on the pre-measurement default frame. The exact settled count is
     not pinned because the stack's available width depends on surrounding
     header layout. */
  await expect
    .poll(() =>
      narrowStack.evaluate(async (stack) => {
        const read = () => {
          const badge =
            stack.querySelector('[data-agent-avatar-overflow]')?.textContent?.trim() ?? null;

          const visible = stack.querySelectorAll('[data-agent-avatar-with-state]').length;

          return { visible, badge };
        };
        const settleWindow = () =>
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await settleWindow();
        const first = read();
        await settleWindow();
        const second = read();
        return {
          settled: first.visible === second.visible && first.badge === second.badge,
          capped: second.visible < 6,
          consistent: second.badge === `+${6 - second.visible}`,
        };
      }),
    )
    .toEqual({ settled: true, capped: true, consistent: true });
});

test('toggles exactly once from every full-row disclosure region and not from agent rows', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 12, width: 600, initiallyExpanded: false },
  });
  const summary = component.getByTestId('one-shot-summary-toggle');
  const stack = summary.locator('[data-agent-avatar-stack]');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => stack.locator('[data-agent-avatar-stack-item]').count()).toBe(3);
  await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText('+9');

  const regions = [
    component.getByTestId('one-shot-leading-column'),
    component.getByTestId('one-shot-summary-title'),
    stack.locator('[data-agent-avatar-stack-item]').first(),
    stack.locator('[data-agent-avatar-overflow]'),
    component.getByTestId('one-shot-collapse-toggle'),
  ];
  for (const region of regions) {
    await region.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await summary.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
  }

  const stackBox = await stack.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(stackBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  await summary.click({
    position: {
      x: stackBox!.x - summaryBox!.x + 2,
      y: stackBox!.y - summaryBox!.y + stackBox!.height / 2,
    },
  });
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await component
    .getByTestId('agent-list-item')
    .first()
    .locator('button')
    .evaluate((row) => row.click());
  await expect(summary).toHaveAttribute('aria-expanded', 'true');

  await summary.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await summary.press(' ');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(summary).toBeFocused();
});

test('shows only participant agents in the mixed collapsed cohort stack', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'mixed', agentCount: 7, width: 600, initiallyExpanded: false },
  });
  const summary = component.getByTestId('event-subscriptions-summary');
  const stack = summary.locator('[data-agent-avatar-stack]');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => stack.locator('[data-agent-avatar-with-state]').count()).toBe(7);
  await expect(stack.locator('[data-agent-avatar-overflow], [data-icon]')).toHaveCount(0);
  await summary.press(' ');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(stack).toHaveCount(0);
  await expect(component.getByTestId('event-subscriptions-body')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  await component.getByTestId('one-shot-summary-toggle').press('Enter');
  await expect(component.getByTestId('one-shot-agent-list')).toBeVisible();
  await expect(component.getByTestId('mixed-subscription-preview')).toBeVisible();
});

const canonicalAgentStateCases = [
  ['responding', 'running'],
  ['live-payload-tool', 'running'],
  ['in-flight-tool', 'running'],
  ['blocked-tool', 'waiting'],
  ['active-peer-turn', 'running'],
  ['peer-wait', 'waiting'],
  ['stale-waiting', 'running'],
] as const;

for (const [agentStateScenario, expected] of canonicalAgentStateCases) {
  test(`keeps ${agentStateScenario} ${expected} in production subscription surfaces`, async ({
    mount,
  }) => {
    const component = await mount(AgentSubscriptionInlineHost, {
      props: {
        mode: 'mixed',
        agentCount: 1,
        initiallyExpanded: false,
        agentStateScenario,
      },
    });
    const outerSummary = component.getByTestId('event-subscriptions-summary');
    if ((await outerSummary.getAttribute('aria-expanded')) === 'false') await outerSummary.click();
    const waitingSummary = component.getByTestId('one-shot-summary-toggle');
    if ((await waitingSummary.getAttribute('aria-expanded')) === 'false')
      await waitingSummary.click();
    await expect(
      component
        .locator(
          '[data-testid="agent-list-item"][data-agent-id="agent-subscription-inline-geometry"]',
        )
        .locator('[data-agent-avatar-with-state]'),
      `${agentStateScenario} should render ${expected} in the expanded row`,
    ).toHaveAttribute('data-avatar-state', expected);

    await waitingSummary.click();
    await expect(
      waitingSummary
        .locator('[data-agent-avatar-stack-agent-id="agent-subscription-inline-geometry"]')
        .locator('[data-agent-avatar-with-state]'),
      `${agentStateScenario} should remain ${expected} in the nested collapsed stack`,
    ).toHaveAttribute('data-avatar-state', expected);
    await outerSummary.click();
    await expect(
      outerSummary
        .locator('[data-agent-avatar-stack-agent-id="agent-subscription-inline-geometry"]')
        .locator('[data-agent-avatar-with-state]'),
      `${agentStateScenario} should remain ${expected} in the collapsed stack`,
    ).toHaveAttribute('data-avatar-state', expected);
  });
}
