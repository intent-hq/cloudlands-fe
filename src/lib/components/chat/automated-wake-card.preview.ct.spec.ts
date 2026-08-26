import { expect, test } from '@playwright/experimental-ct-svelte';
import AutomatedWakeCardPreview from './automated-wake-card.preview.svelte';
import type { AutomatedWakePresentation } from './automated-wake-presentation';

function hookPresentation(displayName: string): AutomatedWakePresentation {
  return {
    kind: 'hook',
    attribution: {
      hookId: 'preview-hook',
      displayName,
      rawName: displayName,
      reason: 'dispatched',
      hookStillActive: false,
    },
    bodyText: 'The preview hook woke the agent.',
    queueInfo: null,
    state: 'retired',
  };
}

test('wraps long wake labels while fixed controls stay contained', async ({ mount }) => {
  const component = await mount(AutomatedWakeCardPreview, {
    props: { presentation: hookPresentation('Open workspace tab preview') },
  });
  await component.evaluate((node) => ((node as HTMLElement).style.width = '240px'));

  const longGeometry = await component.evaluate((root) => {
    const element = (testId: string) =>
      root.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    const header = element('automated-wake-header');
    const primary = element('automated-wake-primary-label');
    const status = element('wake-status');
    const toggle = element('automated-wake-toggle');
    const icon = header.querySelector('svg') as SVGElement;
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
    const labelStyle = (node: Element) => {
      const value = getComputedStyle(node);
      return { whiteSpace: value.whiteSpace, textOverflow: value.textOverflow };
    };
    return {
      header: rect(header),
      icon: rect(icon),
      primary: rect(primary),
      status: rect(status),
      toggle: rect(toggle),
      primaryStyle: labelStyle(primary),
      statusStyle: labelStyle(status),
    };
  });

  expect(longGeometry.header.height).toBeGreaterThan(36);
  expect(longGeometry.primary.height).toBeGreaterThan(20);
  expect(longGeometry.primaryStyle.whiteSpace).toBe('normal');
  expect(longGeometry.primaryStyle.textOverflow).not.toBe('ellipsis');
  expect(longGeometry.statusStyle.whiteSpace).toBe('normal');
  expect(longGeometry.statusStyle.textOverflow).not.toBe('ellipsis');
  expect(longGeometry.toggle.width).toBeCloseTo(24, 1);
  expect(longGeometry.toggle.height).toBeCloseTo(24, 1);
  expect(longGeometry.icon.left).toBeGreaterThanOrEqual(longGeometry.header.left);
  expect(longGeometry.toggle.right).toBeLessThanOrEqual(longGeometry.header.right);
  expect(longGeometry.primary.right).toBeLessThanOrEqual(longGeometry.toggle.left);
  expect(longGeometry.status.right).toBeLessThanOrEqual(longGeometry.toggle.left);

  await component.update({
    props: { presentation: hookPresentation('CI watch') },
  });
  await component.evaluate((node) => ((node as HTMLElement).style.width = '560px'));
  await expect(component.getByTestId('automated-wake-header')).toHaveCSS('height', '36px');

  await component.getByTestId('automated-wake-header').click();
  await expect(component.getByText('The preview hook woke the agent.')).toBeVisible();
  await expect(component.getByTestId('automated-wake-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
