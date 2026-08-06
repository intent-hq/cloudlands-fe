/**
 * Regression tests: sidebar nav hover card dismissal.
 *
 * The hover card must always be dismissible:
 * - a pointerdown outside both the card and the nav rail closes it (unpinned
 *   expanded cards included — the "stays until clicked elsewhere" contract);
 * - clicks inside the card or on the nav rail, or while a sidebar context menu
 *   is open, do not dismiss;
 * - a pinned+expanded card stays open on outside click (pin means pin);
 * - `isCardPinned` only wedges an EXPANDED card open — a transient
 *   (non-expanded) card still closes on mouse-leave even when pinned.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setHoveredItem,
  setExpandedItem,
  setCardPinned,
  incrementContextMenuOpen,
  decrementContextMenuOpen,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { selectActiveCard } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import SidebarNavHoverCardHarness from './mocks/SidebarNavHoverCardHarness.svelte';

vi.mock('$lib/components/layout/sidebar-nav/cards/NewWorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/ActiveWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));

function activeCard() {
  return selectActiveCard.select(appStore.state);
}

async function renderCard(setup: () => void): Promise<HTMLElement> {
  render(SidebarNavHoverCardHarness, { props: { setup } });
  return await waitFor(() => {
    const el = document.querySelector<HTMLElement>('.sidebar-hover-card');
    expect(el).not.toBeNull();
    return el!;
  });
}

describe('sidebar nav hover card dismissal', () => {
  // The renderer store is a shared singleton, so reset hover/pin/menu state
  // between tests (even when an assertion fails mid-test).
  afterEach(() => {
    appStore.dispatch(setHoveredItem(null));
    appStore.dispatch(setExpandedItem(null));
    appStore.dispatch(setCardPinned(false));
    while (appStore.state.sidebarNav.contextMenuOpenCount > 0) {
      appStore.dispatch(decrementContextMenuOpen());
    }
  });

  it('closes on pointerdown outside the card and nav rail', async () => {
    await renderCard(() => appStore.dispatch(setHoveredItem('active')));

    await fireEvent.pointerDown(screen.getByTestId('outside-button'));

    expect(activeCard()).toBeNull();
  });

  it('closes an unpinned expanded card on outside pointerdown', async () => {
    await renderCard(() => {
      appStore.dispatch(setHoveredItem('active'));
      appStore.dispatch(setExpandedItem('active'));
    });

    await fireEvent.pointerDown(screen.getByTestId('outside-button'));

    expect(activeCard()).toBeNull();
  });

  it('keeps a pinned+expanded card open on outside pointerdown (pin means pin)', async () => {
    await renderCard(() => {
      appStore.dispatch(setHoveredItem('active'));
      appStore.dispatch(setExpandedItem('active'));
      appStore.dispatch(setCardPinned(true));
    });

    await fireEvent.pointerDown(screen.getByTestId('outside-button'));

    expect(activeCard()).toBe('active');
    expect(appStore.state.sidebarNav.isCardPinned).toBe(true);
  });

  it('does not close when the pointerdown lands inside the card', async () => {
    await renderCard(() => appStore.dispatch(setHoveredItem('active')));

    await fireEvent.pointerDown(screen.getByTestId('mock-card-content'));

    expect(activeCard()).toBe('active');
  });

  it('does not close when the pointerdown lands on the nav rail', async () => {
    await renderCard(() => appStore.dispatch(setHoveredItem('active')));

    await fireEvent.pointerDown(screen.getByTestId('nav-button'));

    expect(activeCard()).toBe('active');
  });

  it('does not close when the pointerdown lands in portaled overlay UI (.portal-container)', async () => {
    // Card-owned controls can portal their content to document.body (e.g. the
    // expanded ChiefCard thread Dropdown with portal={true} renders options in
    // a Portal, which tags its container with .portal-container). Those clicks
    // must not dismiss the card before the control's own handler runs.
    await renderCard(() => appStore.dispatch(setHoveredItem('active')));

    const portal = document.createElement('div');
    portal.className = 'portal-container';
    const option = document.createElement('button');
    portal.appendChild(option);
    document.body.appendChild(portal);
    try {
      await fireEvent.pointerDown(option);

      expect(activeCard()).toBe('active');
    } finally {
      portal.remove();
    }
  });

  it('does not close on outside pointerdown while a sidebar context menu is open', async () => {
    await renderCard(() => {
      appStore.dispatch(setHoveredItem('active'));
      appStore.dispatch(incrementContextMenuOpen());
    });

    await fireEvent.pointerDown(screen.getByTestId('outside-button'));

    expect(activeCard()).toBe('active');
  });

  it('non-expanded hover card closes on mouse-leave even when isCardPinned is true', async () => {
    const card = await renderCard(() => {
      appStore.dispatch(setHoveredItem('active'));
      appStore.dispatch(setCardPinned(true));
    });

    await fireEvent.mouseLeave(card);

    // handleCardMouseLeave closes after a 200ms grace timeout
    await waitFor(() => expect(activeCard()).toBeNull(), { timeout: 2000 });
  });

  it('expanded pinned card does not close on mouse-leave (pin semantics preserved)', async () => {
    const card = await renderCard(() => {
      appStore.dispatch(setHoveredItem('active'));
      appStore.dispatch(setExpandedItem('active'));
      appStore.dispatch(setCardPinned(true));
    });

    await fireEvent.mouseLeave(card);
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(activeCard()).toBe('active');
  });

  it('outside-pointerdown close does not steal focus from the clicked control', async () => {
    const nav = document.createElement('button');
    document.body.appendChild(nav);
    try {
      // Focus an element before the card opens so it is captured as previouslyFocused
      nav.focus();

      await renderCard(() => appStore.dispatch(setHoveredItem('active')));

      const outside = screen.getByTestId('outside-button');
      await fireEvent.pointerDown(outside);
      // Browser default action focuses the pointer target after pointerdown handlers
      outside.focus();
      // Let the focus-management effect for the close run
      await waitFor(() => expect(activeCard()).toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.activeElement).toBe(outside);
    } finally {
      nav.remove();
    }
  });

  it('Escape close still restores focus to the previously focused element', async () => {
    const previous = document.createElement('button');
    document.body.appendChild(previous);
    try {
      previous.focus();

      const card = await renderCard(() => appStore.dispatch(setHoveredItem('active')));

      await fireEvent.keyDown(card, { key: 'Escape' });
      await waitFor(() => expect(activeCard()).toBeNull());

      await waitFor(() => expect(document.activeElement).toBe(previous));
    } finally {
      previous.remove();
    }
  });
});
