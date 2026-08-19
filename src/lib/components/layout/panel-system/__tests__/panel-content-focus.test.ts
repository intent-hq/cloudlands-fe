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
    <div data-panel-id="panel-a">
      <input id="url-bar" type="text" />
      <div id="webview-host" tabindex="0"></div>
    </div>
    <div data-panel-id="panel-b">
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

  it('never blurs when nothing focusable is active', () => {
    buildPanels();
    expect(shouldBlurActiveElement(document.body, 'panel-a')).toBe(true);
    expect(shouldBlurActiveElement(null, 'panel-a')).toBe(false);
  });
});

describe('PanelLayout reveal blur contract (#2895)', () => {
  const layout = readFileSync(resolve(__dirname, '../PanelLayout.svelte'), 'utf8');

  it('routes every dispatchFocusPanelContent blur through shouldBlurActiveElement', () => {
    const fn = layout.slice(
      layout.indexOf('function dispatchFocusPanelContent'),
      layout.indexOf('function focusCycledPanel'),
    );
    expect(fn).toContain('shouldBlurActiveElement(document.activeElement, panelId)');
    expect(fn).not.toContain('document.activeElement instanceof HTMLElement');
  });
});
