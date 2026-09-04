import { afterEach, describe, expect, it, vi } from 'vitest';
import { elementPickerScript } from './element-picker-script';

describe('elementPickerScript', () => {
  afterEach(() => {
    (window as any).__intentElementPickerCleanup?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('parses as JavaScript without template injection errors', () => {
    expect(() => new Function(elementPickerScript)).not.toThrow();
  });

  it('highlights and reports a clicked element, then cleans up', () => {
    document.body.innerHTML = '<button id="save" data-source="src/save.ts:7">Save changes</button>';
    const button = document.querySelector('button')!;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    new Function(elementPickerScript)();

    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(document.querySelector('[data-intent-element-picker-overlay]')).toBeTruthy();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const message = String(log.mock.calls[0]?.[0]);
    const payload = JSON.parse(message.replace('__INTENT_ELEMENT_PICKED__:', ''));
    expect(payload).toMatchObject({
      selector: '#save',
      tagName: 'button',
      textSnippet: 'Save changes',
      sourceRef: 'src/save.ts:7',
      rect: { x: 10, y: 20, width: 100, height: 40 },
    });
    expect(document.querySelector('[data-intent-element-picker-overlay]')).toBeNull();
  });

  it('reports cancellation and removes the overlay on Escape', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    new Function(elementPickerScript)();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(log).toHaveBeenCalledWith('__INTENT_ELEMENT_PICK_CANCELLED__');
    expect(document.querySelector('[data-intent-element-picker-overlay]')).toBeNull();
  });
});
