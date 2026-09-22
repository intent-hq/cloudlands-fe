/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldBlurActiveElement, shouldRedirectFocusToPanelContent } from '../panel-content-focus';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  focusPanel,
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/PanelFocusRoutingPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

/**
 * Regression tests for intent-hq/monorepo#2895: since focusPanel emits a
 * panel-reveal request on every focus (#1373), the reveal path's
 * dispatchFocusPanelContent blurred document.activeElement for non-focusable
 * tab types (browser, terminal, diff, ...) even when that element was the
 * one the user had just focused inside the revealed panel — clicking into a
 * browser webview or the URL bar blurred itself 100 ms later, making typing
 * impossible.
 *
 * And for intent-hq/monorepo#2947: the same reveal path's focusable-type
 * branch (agent/note/file) unconditionally dispatched `panel:focus-content`,
 * stealing focus the user had just placed inside the revealed panel but
 * outside the prompt — e.g. the header rename input (EditableName), which
 * closed on blur before the user could type.
 *
 * And for intent-hq/monorepo#3053: focus with no `[data-panel-id]` ancestor
 * at all (a dialog portal / modal overlay, e.g. the New Space modal editor)
 * was treated as "outside the target panel" and blurred/redirected — the
 * dialog focus trap then re-focused it with the caret at the start, so
 * typing was interrupted 100 ms after every focusPanel dispatch. Focus that
 * is not panel-owned is never stale panel focus and must not be touched.
 */

function buildPanels(): { panelA: HTMLElement; panelB: HTMLElement } {
  document.body.innerHTML = `
    <div data-panel-id="panel-a" data-layout-id="layout-1">
      <input id="url-bar" type="text" />
      <div id="webview-host" tabindex="0"></div>
    </div>
    <div data-panel-id="panel-b" data-layout-id="layout-1">
      <textarea id="chat-input"></textarea>
    </div>
    <div id="dialog-portal" role="dialog" aria-modal="true">
      <div id="modal-editor" contenteditable="true" tabindex="0"></div>
    </div>
    <input id="outside" type="text" />
  `;
  return {
    panelA: document.querySelector('[data-panel-id="panel-a"]') as HTMLElement,
    panelB: document.querySelector('[data-panel-id="panel-b"]') as HTMLElement,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldBlurActiveElement', () => {
  it('keeps focus on an element inside the target panel (webview host)', () => {
    buildPanels();
    const webviewHost = document.getElementById('webview-host') as HTMLElement;
    webviewHost.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a')).toBe(false);
  });

  it('keeps focus on the URL bar of the target panel', () => {
    buildPanels();
    const urlBar = document.getElementById('url-bar') as HTMLInputElement;
    urlBar.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a')).toBe(false);
  });

  it('blurs stale focus that lives in a different panel', () => {
    buildPanels();
    const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
    chatInput.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a')).toBe(true);
  });

  it('keeps focus on an element hosted in a dialog portal / overlay (#3053)', () => {
    buildPanels();
    const modalEditor = document.getElementById('modal-editor') as HTMLElement;
    modalEditor.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a')).toBe(false);
  });

  it('keeps focus on an element with no panel ancestor (#3053)', () => {
    buildPanels();
    const outside = document.getElementById('outside') as HTMLInputElement;
    outside.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a')).toBe(false);
  });

  it('does not blur document.body (no panel ancestor)', () => {
    buildPanels();
    expect(shouldBlurActiveElement(document.body, 'panel-a')).toBe(false);
  });

  it('returns false when activeElement is null', () => {
    expect(shouldBlurActiveElement(null, 'panel-a')).toBe(false);
  });

  it('scopes ownership by layout id when provided', () => {
    buildPanels();
    const urlBar = document.getElementById('url-bar') as HTMLInputElement;
    urlBar.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a', 'layout-1')).toBe(false);
    // Colliding panel id from a different layout is still outside
    expect(shouldBlurActiveElement(document.activeElement, 'panel-a', 'layout-2')).toBe(true);
  });
});

describe('shouldRedirectFocusToPanelContent', () => {
  it('does not redirect when focus is inside the target panel (e.g. header rename input)', () => {
    buildPanels();
    const urlBar = document.getElementById('url-bar') as HTMLInputElement;
    urlBar.focus();

    expect(shouldRedirectFocusToPanelContent(document.activeElement, 'panel-a')).toBe(false);
  });

  it('redirects when focus lives in a different panel', () => {
    buildPanels();
    const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
    chatInput.focus();

    expect(shouldRedirectFocusToPanelContent(document.activeElement, 'panel-a')).toBe(true);
  });

  it('does not redirect focus hosted in a dialog portal / overlay (#3053)', () => {
    buildPanels();
    const modalEditor = document.getElementById('modal-editor') as HTMLElement;
    modalEditor.focus();

    expect(shouldRedirectFocusToPanelContent(document.activeElement, 'panel-a')).toBe(false);
  });

  it('does not redirect focus on an element with no panel ancestor (#3053)', () => {
    buildPanels();
    const outside = document.getElementById('outside') as HTMLInputElement;
    outside.focus();

    expect(shouldRedirectFocusToPanelContent(document.activeElement, 'panel-a')).toBe(false);
  });

  it('redirects when focus is on document.body', () => {
    buildPanels();
    expect(shouldRedirectFocusToPanelContent(document.body, 'panel-a')).toBe(true);
  });

  it('redirects when activeElement is null', () => {
    expect(shouldRedirectFocusToPanelContent(null, 'panel-a')).toBe(true);
  });

  it('scopes ownership by layout id when provided', () => {
    buildPanels();
    const urlBar = document.getElementById('url-bar') as HTMLInputElement;
    urlBar.focus();

    expect(shouldRedirectFocusToPanelContent(document.activeElement, 'panel-a', 'layout-1')).toBe(
      false,
    );
    // Colliding panel id from a different layout is still outside
    expect(shouldRedirectFocusToPanelContent(document.activeElement, 'panel-a', 'layout-2')).toBe(
      true,
    );
  });
});

/**
 * The PanelLayout side of the same contract: focusing the next column with the
 * keyboard routes through dispatchFocusPanelContent, whose deferred callback
 * must apply the ownership predicates above to the live document focus.
 */
describe('PanelLayout focus routing after a column focus', () => {
  const STORE_CONTEXT = 'redux-store-context';
  const LAYOUT_ID = 'panel-content-focus-layout';
  let storeContext: ReduxStoreContext | undefined;

  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    storeContext = initAppStore(appStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    storeContext?.dispose();
    storeContext = undefined;
    vi.unstubAllGlobals();
  });

  async function mountColumns(targetTabType: PanelTabType) {
    appStore.dispatch(
      initializeLayout(LAYOUT_ID, {
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [50, 50],
          children: [
            { type: 'panel', panelId: 'origin' },
            { type: 'panel', panelId: 'target' },
          ],
        },
        panels: {
          origin: {
            id: 'origin',
            tabs: [{ id: 'origin-tab', type: 'note', title: 'Origin', closable: true }],
            activeTabId: 'origin-tab',
          },
          target: {
            id: 'target',
            tabs: [{ id: 'target-tab', type: targetTabType, title: 'Target', closable: true }],
            activeTabId: 'target-tab',
          },
        },
        focusedPanelId: 'origin',
        canvasWidth: 800,
      }),
    );
    appStore.dispatch(setRestoreStatus(LAYOUT_ID, 'restored'));
    const { container } = render(PanelLayout, {
      props: {
        workspaceId: LAYOUT_ID,
        layoutId: LAYOUT_ID,
        contained: true,
        canvasSizing: 'content',
      },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    const control = (panelId: string) =>
      container.querySelector<HTMLInputElement>(`[data-panel-focus-control="${panelId}"]`)!;
    await waitFor(() => expect(control('target')).toBeTruthy());
    const focusContentEvents: unknown[] = [];
    const record = (event: Event) => focusContentEvents.push((event as CustomEvent).detail);
    window.addEventListener('panel:focus-content', record);
    vi.useFakeTimers();
    return {
      control,
      focusContentEvents,
      focusNextColumn() {
        const isMac = navigator.platform.toUpperCase().includes('MAC');
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: ']',
            shiftKey: true,
            metaKey: isMac,
            ctrlKey: !isMac,
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(appStore.state.panelLayout.byWorkspaceId[LAYOUT_ID]?.focusedPanelId).toBe('target');
      },
      settle() {
        vi.advanceTimersByTime(100);
      },
      dispose() {
        window.removeEventListener('panel:focus-content', record);
      },
    };
  }

  it('redirects stale focus from another column into focusable content (#2947)', async () => {
    const layout = await mountColumns('note');
    layout.control('origin').focus();

    layout.focusNextColumn();
    layout.settle();

    expect(layout.focusContentEvents).toEqual([
      expect.objectContaining({
        panelId: 'target',
        tabId: 'target-tab',
        tabType: 'note',
        workspaceId: LAYOUT_ID,
      }),
    ]);
    layout.dispose();
  });

  it('does not steal focus the user already placed inside the target column (#2947)', async () => {
    const layout = await mountColumns('note');
    layout.focusNextColumn();
    layout.control('target').focus();

    layout.settle();

    expect(layout.focusContentEvents).toEqual([]);
    expect(document.activeElement).toBe(layout.control('target'));
    layout.dispose();
  });

  it('blurs stale focus from another column for non-focusable content (#2895)', async () => {
    const layout = await mountColumns('browser');
    layout.control('origin').focus();

    layout.focusNextColumn();
    layout.settle();

    expect(document.activeElement).toBe(document.body);
    expect(layout.focusContentEvents).toEqual([]);
    layout.dispose();
  });

  it('keeps focus the user placed inside a non-focusable target column (#2895)', async () => {
    const layout = await mountColumns('browser');
    layout.focusNextColumn();
    layout.control('target').focus();

    layout.settle();

    expect(document.activeElement).toBe(layout.control('target'));
    layout.dispose();
  });

  it('drops a queued callback once focus moved on to another panel', async () => {
    const layout = await mountColumns('browser');
    layout.control('origin').focus();
    layout.focusNextColumn();

    appStore.dispatch(focusPanel(LAYOUT_ID, 'origin'));
    layout.settle();

    expect(document.activeElement).toBe(layout.control('origin'));
    expect(layout.focusContentEvents).toEqual([]);
    layout.dispose();
  });
});
