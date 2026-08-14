// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import TooltipHarness from './TooltipHarness.svelte';
import { tooltipFixtures } from './tooltip.fixtures';
import * as tooltipApi from './index';

const originalResizeObserver = window.ResizeObserver;

beforeEach(() => {
  window.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  window.ResizeObserver = originalResizeObserver;
});

describe('Tooltip', () => {
  it('opens from keyboard focus, uses a portal, and dismisses with Escape without moving focus', async () => {
    const { container } = render(TooltipHarness);
    const trigger = screen.getByRole('button', { name: 'Show keyboard help' });
    trigger.focus();
    await fireEvent.focus(trigger);
    const tooltip = await screen.findByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toContain('Press Command K');
    expect(container.contains(tooltip)).toBe(false);
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.className).toContain('motion-reduce:animate-none');
    expect(tooltip.className).toContain('z-(--layer-tooltip)');
    expect(tooltip.className).toContain('rounded-md');
    expect(tooltip.className).toContain('border-border');
    expect(tooltip.className).toContain('bg-popover');
    expect(tooltip.className).toContain('text-popover-foreground');
    expect(tooltip.className).toContain('shadow-(--elevation-overlay)');
    expect(tooltip.className).toContain('type-body');
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('honors controlled open state and publishes the configured delay on its trigger', async () => {
    render(TooltipHarness, { props: { open: true, delayDuration: 120 } });
    const trigger = screen.getByRole('button', { name: 'Show keyboard help' });
    expect(trigger.getAttribute('data-delay-duration')).toBe('120');
    expect(await screen.findByRole('tooltip', { hidden: true })).not.toBeNull();
    expect(screen.getByLabelText('Tooltip open state').textContent).toBe('true');
  });

  it('uses each wrapped button as the only interactive trigger and preserves keyboard dismissal', async () => {
    render(TooltipHarness);
    const simpleCase = screen.getByTestId('wrapped-tooltip');
    const simpleTrigger = screen.getByRole('button', { name: 'Show wrapped help' });
    expect(simpleCase.querySelectorAll('button')).toHaveLength(1);
    expect(simpleTrigger.hasAttribute('data-tooltip-trigger')).toBe(true);
    expect(simpleTrigger.className).toContain('focus-visible:ring-2');

    simpleTrigger.focus();
    await fireEvent.focus(simpleTrigger);
    const tooltip = await screen.findByRole('tooltip', {
      name: 'Wrapped button help',
      hidden: true,
    });
    await waitFor(() => expect(simpleTrigger.getAttribute('aria-describedby')).toBe(tooltip.id));
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Wrapped button help')).toBeNull());
    expect(document.activeElement).toBe(simpleTrigger);

    const richCase = screen.getByTestId('rich-tooltip');
    const richTrigger = screen.getByRole('button', { name: 'Show rich help' });
    expect(richCase.querySelectorAll('button')).toHaveLength(1);
    richTrigger.focus();
    await fireEvent.focus(richTrigger);
    const richTooltip = await screen.findByRole('tooltip', {
      name: 'Rich button help',
      hidden: true,
    });
    await waitFor(() => expect(richTrigger.getAttribute('aria-describedby')).toBe(richTooltip.id));
  });

  it('does not add an interactive role or tab stop inside menu content (monorepo#2320)', async () => {
    render(TooltipHarness);
    const menuCase = screen.getByTestId('menu-tooltip');
    const span = menuCase.querySelector<HTMLElement>('[data-tooltip-trigger]');
    expect(span).not.toBeNull();
    // No nested role=button inside role=menuitem, and no unreachable tab stop.
    await waitFor(() => expect(span!.getAttribute('role')).toBeNull());
    expect(span!.hasAttribute('tabindex')).toBe(false);

    // The tooltip itself still opens on hover.
    await fireEvent.pointerMove(span!, { pointerType: 'mouse' });
    expect(
      await screen.findByRole('tooltip', { name: 'Menu status help', hidden: true }),
    ).not.toBeNull();
  });

  it('keeps passive trigger content keyboard focusable and interactive triggers hoverable', async () => {
    render(TooltipHarness);
    const passiveTrigger = screen.getByRole('button', { name: 'Passive status' });
    passiveTrigger.focus();
    await fireEvent.focus(passiveTrigger);
    expect(
      await screen.findByRole('tooltip', { name: 'Passive status help', hidden: true }),
    ).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });

    const wrappedTrigger = screen.getByRole('button', { name: 'Show wrapped help' });
    await fireEvent.pointerMove(wrappedTrigger, { pointerType: 'mouse' });
    expect(
      await screen.findByRole('tooltip', { name: 'Wrapped button help', hidden: true }),
    ).not.toBeNull();
  });

  it('publishes parseable metadata and the complete production public barrel', () => {
    expect(() => parseUiComponentMetadata(tooltipApi.tooltipMetadata)).not.toThrow();
    expect(tooltipFixtures[0].states).toEqual(
      expect.arrayContaining([
        'open',
        'hover-delay',
        'keyboard-focus',
        'escape-dismiss',
        'portal',
        'reduced-motion',
      ]),
    );
    expect(Object.keys(tooltipApi).sort()).toEqual([...tooltipApi.tooltipMetadata.exports].sort());
  });
});
