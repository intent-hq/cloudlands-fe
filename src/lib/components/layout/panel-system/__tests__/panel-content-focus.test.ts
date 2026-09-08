import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldBlurActiveElement, shouldRedirectFocusToPanelContent } from '../panel-content-focus';

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

function dispatchFocusPanelContentSource(): string {
  const layout = readFileSync(resolve(__dirname, '../PanelLayout.svelte'), 'utf8');
  const start = layout.indexOf('function dispatchFocusPanelContent');
  const end = layout.indexOf('function focusCycledPanel');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return layout.slice(start, end);
}

describe('PanelLayout reveal blur contract (#2895)', () => {
  it('routes every dispatchFocusPanelContent blur through shouldBlurActiveElement', () => {
    const fn = dispatchFocusPanelContentSource();
    const blurCount = fn.split('document.activeElement.blur()').length - 1;
    const guardedCount =
      fn.split('shouldBlurActiveElement(document.activeElement, panelId, targetLayoutId)').length -
      1;
    expect(blurCount).toBeGreaterThan(0);
    expect(guardedCount).toBe(blurCount);
    expect(fn).not.toContain('document.activeElement instanceof HTMLElement');
  });
});

describe('PanelLayout focusable reveal dispatch contract (#2947)', () => {
  it('gates the panel:focus-content dispatch on focus living outside the target panel', () => {
    const fn = dispatchFocusPanelContentSource();
    const gateIndex = fn.indexOf(
      'shouldRedirectFocusToPanelContent(document.activeElement, panelId, targetLayoutId)',
    );
    const dispatchIndex = fn.indexOf("dispatchWindowEvent('panel:focus-content'");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(gateIndex);
  });

  it('applies the stale-callback focused-panel guard before both branches', () => {
    const fn = dispatchFocusPanelContentSource();
    const guardIndex = fn.indexOf(
      'selectFocusedPanelId.select(appStore.state, targetLayoutId) !== panelId',
    );
    const branchIndex = fn.indexOf('if (focusableTypes.includes(activeTab.type))');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(branchIndex).toBeGreaterThan(guardIndex);
  });
});
