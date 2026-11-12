/**
 * @vitest-environment jsdom
 *
 * Right-click on the dock opens its native menu, except where the user expects
 * the normal edit menu: text inputs, textareas, editable content, and anything
 * inside the open conversation body.
 */
import { describe, expect, it } from 'vitest';
import { wantsDockContextMenu } from './dock-context-target';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('wantsDockContextMenu', () => {
  it('opens the dock menu on ordinary dock surfaces', () => {
    const root = mount(
      `<section data-dock-surface><button data-dock-entry="w1">W</button></section>`,
    );
    expect(wantsDockContextMenu(root.querySelector('section'))).toBe(true);
    expect(wantsDockContextMenu(root.querySelector('button'))).toBe(true);
  });

  it('keeps the edit menu in inputs, textareas and editable content', () => {
    const root = mount(`
      <input id="i" />
      <textarea id="t"></textarea>
      <div contenteditable="true"><span id="ce">x</span></div>
      <div contenteditable=""><span id="ce-empty">x</span></div>`);
    for (const id of ['i', 't', 'ce', 'ce-empty'])
      expect(wantsDockContextMenu(root.querySelector(`#${id}`)), id).toBe(false);
  });

  it('keeps the edit menu anywhere inside the open conversation', () => {
    const root = mount(
      `<div data-testid="dock-conversation-surface"><header data-dock-chrome><span id="header">Device</span><input id="header-input" /></header><p><b id="inner">reply</b></p></div>`,
    );
    expect(wantsDockContextMenu(root.querySelector('#inner'))).toBe(false);
    expect(wantsDockContextMenu(root.querySelector('#header'))).toBe(true);
    expect(wantsDockContextMenu(root.querySelector('#header-input'))).toBe(false);
  });

  it('ignores non-element targets', () => {
    expect(wantsDockContextMenu(null)).toBe(false);
    expect(wantsDockContextMenu(document.createTextNode('x'))).toBe(false);
  });
});
