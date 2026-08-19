import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldBlurActiveElement } from '../panel-content-focus';

/**
 * Regression tests for intent-hq/monorepo#2895: since focusPanel emits a
 * panel-reveal request on every focus (#1373), the reveal path's
 * dispatchFocusPanelContent blurred document.activeElement for non-focusable
 * tab types (browser, terminal, diff, ...) even when that element was the
 * one the user had just focused inside the revealed panel — clicking into a
 * browser webview or the URL bar blurred itself 100 ms later, making typing
 * impossible.
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

  it('blurs focus that lives outside any panel', () => {
    buildPanels();
    const outside = document.getElementById('outside') as HTMLInputElement;
    outside.focus();

    expect(shouldBlurActiveElement(document.activeElement, 'panel-a')).toBe(true);
  });

  it('treats document.body as outside any panel (harmless no-op blur)', () => {
    buildPanels();
    expect(shouldBlurActiveElement(document.body, 'panel-a')).toBe(true);
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

describe('PanelLayout reveal blur contract (#2895)', () => {
  const layout = readFileSync(resolve(__dirname, '../PanelLayout.svelte'), 'utf8');

  it('routes every dispatchFocusPanelContent blur through shouldBlurActiveElement', () => {
    const start = layout.indexOf('function dispatchFocusPanelContent');
    const end = layout.indexOf('function focusCycledPanel');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = layout.slice(start, end);
    const blurCount = fn.split('document.activeElement.blur()').length - 1;
    const guardedCount = fn.split(
      'shouldBlurActiveElement(document.activeElement, panelId, targetLayoutId)',
    ).length - 1;
    expect(blurCount).toBeGreaterThan(0);
    expect(guardedCount).toBe(blurCount);
    expect(fn).not.toContain('document.activeElement instanceof HTMLElement');
  });
});
