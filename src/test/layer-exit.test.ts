import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LayerExitHarness from './__tests__/LayerExitHarness.svelte';
import {
  closingLayers,
  layerContaining,
  pressOutsideLayer,
  waitForClosingLayers,
  waitForDismissibleLayerArmed,
  waitForLayerExit,
} from './layer-exit';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('unit-test getClientRects shim (src/test-setup.ts)', () => {
  it('reports one box for a rendered element, matching getBoundingClientRect', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const rects = element.getClientRects();
    expect(rects).toHaveLength(1);
    expect(rects.item(0)).toEqual(element.getBoundingClientRect());
    expect(rects.item(1)).toBeNull();
  });

  it('reports no boxes for detached, hidden or display: none elements', () => {
    expect(document.createElement('div').getClientRects()).toHaveLength(0);

    const hidden = document.createElement('section');
    hidden.hidden = true;
    const insideHidden = document.createElement('span');
    hidden.append(insideHidden);

    const undisplayed = document.createElement('section');
    undisplayed.style.display = 'none';
    const insideUndisplayed = document.createElement('span');
    undisplayed.append(insideUndisplayed);

    document.body.append(hidden, undisplayed);
    expect(insideHidden.getClientRects()).toHaveLength(0);
    expect(insideUndisplayed.getClientRects()).toHaveLength(0);
  });

  it('can still be overridden by a test', () => {
    const element = document.createElement('div');
    document.body.append(element);
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([] as never);
    expect(element.getClientRects()).toHaveLength(0);
  });

  it('keeps a positioned menu visible to role queries', async () => {
    render(LayerExitHarness, { props: { menuOpen: true } });
    const menu = await screen.findByRole('menu', { hidden: true });
    const wrapper = layerContaining(menu);
    // Wait until the floating layer has either positioned the menu or hidden it. Without
    // the shim, jsdom's empty getClientRects made bits-ui treat the trigger as detached
    // and hide the menu (cloudlands-fe#3889).
    await waitFor(() => {
      const style = wrapper.getAttribute('style') ?? '';
      expect(style.includes('visibility: hidden') || !style.includes('-200%')).toBe(true);
    });
    expect(wrapper.getAttribute('style')).not.toContain('visibility: hidden');
    expect(screen.getByRole('menu')).toBe(menu);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
  });
});

describe('waitForLayerExit', () => {
  it('waits for a closing menu that stays mounted while it plays its exit', async () => {
    render(LayerExitHarness, { props: { menuOpen: true } });
    const item = await screen.findByRole('menuitem', { name: 'Rename' });
    const menu = screen.getByRole('menu');

    await fireEvent.click(item);
    // The exit has not finished yet: the content is still on the page, marked closed.
    expect(menu.isConnected).toBe(true);
    expect(menu.getAttribute('data-state')).toBe('closed');
    expect(closingLayers()).toContain(menu);

    await waitForLayerExit(item);
    expect(menu.isConnected).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(closingLayers()).toEqual([]);
  });

  it('names the layer that did not leave', async () => {
    render(LayerExitHarness, { props: { menuOpen: true } });
    const menu = await screen.findByRole('menu');
    await expect(waitForLayerExit(menu, { timeout: 50 })).rejects.toThrow(
      /Expected the closing layer to leave the page: <div .*data-bits-floating-content-wrapper/,
    );
  });
});

describe('layerContaining', () => {
  it('finds the floating wrapper, then a layer role, then falls back to the target', async () => {
    render(LayerExitHarness, { props: { menuOpen: true } });
    const menu = await screen.findByRole('menu');
    expect(layerContaining(menu).hasAttribute('data-bits-floating-content-wrapper')).toBe(true);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    expect(layerContaining(button)).toBe(dialog);

    const popup = document.createElement('div');
    document.body.append(popup);
    expect(layerContaining(popup)).toBe(popup);
  });
});

describe('waitForClosingLayers', () => {
  it('waits for every closing layer and ignores open ones', async () => {
    const { rerender } = render(LayerExitHarness, {
      props: { tooltipOpen: true, menuOpen: true },
    });
    const tooltip = await screen.findByRole('tooltip', { name: 'Browse user messages' });
    const menu = await screen.findByRole('menu');

    await rerender({ tooltipOpen: true, menuOpen: false });
    expect(closingLayers()).toEqual([menu]);

    await waitForClosingLayers();
    expect(menu.isConnected).toBe(false);
    expect(tooltip.isConnected).toBe(true);
  });
});

describe('scrollIntoView default (src/test-setup.ts)', () => {
  it('is a no-op that tests can still spy on', () => {
    const element = document.createElement('div');
    document.body.append(element);
    expect(() => element.scrollIntoView({ block: 'nearest' })).not.toThrow();
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    element.scrollIntoView();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('pressOutsideLayer', () => {
  it('dismisses an open menu with a press outside it', async () => {
    render(LayerExitHarness, { props: { menuOpen: true } });
    const menu = await screen.findByRole('menu');
    await pressOutsideLayer(menu);
    await waitForLayerExit(menu);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('waitForDismissibleLayerArmed', () => {
  it('reports when the target is not inside a bits-ui layer', async () => {
    render(LayerExitHarness, { props: { menuOpen: true } });
    await screen.findByRole('menu');
    await expect(
      waitForDismissibleLayerArmed(screen.getByRole('button', { name: 'Tooltip trigger' }), {
        timeout: 50,
      }),
    ).rejects.toThrow(/no bits-ui layer contains/);
  });
});
