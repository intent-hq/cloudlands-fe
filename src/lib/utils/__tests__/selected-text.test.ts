import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSelectedTextWithinSurface } from '../selected-text';

function mockSelection({
  anchorNode,
  focusNode,
  text,
  range,
  isCollapsed = false,
}: {
  anchorNode: Node;
  focusNode: Node;
  text: string;
  range?: Range;
  isCollapsed?: boolean;
}) {
  vi.spyOn(document, 'getSelection').mockReturnValue({
    isCollapsed,
    rangeCount: 1,
    anchorNode,
    focusNode,
    getRangeAt: () =>
      range ??
      ({
        startContainer: anchorNode,
        endContainer: focusNode,
      } as Range),
    toString: () => text,
  } as Selection);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('getSelectedTextWithinSurface', () => {
  it('returns normalized selected text fully contained by the surface', () => {
    const surface = document.createElement('div');
    const textNode = document.createTextNode('alpha beta');
    surface.append(textNode);
    document.body.append(surface);
    mockSelection({ anchorNode: textNode, focusNode: textNode, text: ' alpha\n\tbeta ' });

    expect(getSelectedTextWithinSurface(surface)).toBe('alpha beta');
  });

  it('rejects a cross-surface selection with one endpoint outside the surface', () => {
    const surface = document.createElement('div');
    const otherSurface = document.createElement('div');
    const surfaceText = document.createTextNode('inside');
    const otherText = document.createTextNode('outside');
    surface.append(surfaceText);
    otherSurface.append(otherText);
    document.body.append(surface, otherSurface);
    mockSelection({ anchorNode: surfaceText, focusNode: otherText, text: 'inside outside' });

    expect(getSelectedTextWithinSurface(surface)).toBeNull();
  });

  it('rejects selections with a range boundary outside the surface', () => {
    const surface = document.createElement('div');
    const otherSurface = document.createElement('div');
    const surfaceText = document.createTextNode('inside');
    const otherText = document.createTextNode('outside');
    surface.append(surfaceText);
    otherSurface.append(otherText);
    document.body.append(surface, otherSurface);
    mockSelection({
      anchorNode: surfaceText,
      focusNode: surfaceText,
      text: 'inside outside',
      range: { startContainer: surfaceText, endContainer: otherText } as Range,
    });

    expect(getSelectedTextWithinSurface(surface)).toBeNull();
  });

  it('uses an allowed shadow root selection when document selection is unavailable', () => {
    const surface = document.createElement('div');
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const shadowText = document.createTextNode('shadow text');
    shadowRoot.append(shadowText);
    surface.append(host);
    document.body.append(surface);
    vi.spyOn(document, 'getSelection').mockReturnValue(null);
    Object.defineProperty(shadowRoot, 'getSelection', {
      configurable: true,
      value: () =>
        ({
          isCollapsed: false,
          rangeCount: 1,
          anchorNode: shadowText,
          focusNode: shadowText,
          getRangeAt: () => ({ startContainer: shadowText, endContainer: shadowText }),
          toString: () => 'shadow text',
        }) as Selection,
    });

    expect(getSelectedTextWithinSurface(surface, { extraRoots: [shadowRoot] })).toBe('shadow text');
  });

  it('truncates selected text to maxLength after normalization', () => {
    const surface = document.createElement('div');
    const textNode = document.createTextNode('alphabet');
    surface.append(textNode);
    document.body.append(surface);
    mockSelection({ anchorNode: textNode, focusNode: textNode, text: ' alphabet ' });

    expect(getSelectedTextWithinSurface(surface, { maxLength: 1 })).toBe('a');
  });

  it('returns null for collapsed selections even with maxLength', () => {
    const surface = document.createElement('div');
    const textNode = document.createTextNode('alphabet');
    surface.append(textNode);
    document.body.append(surface);
    mockSelection({ anchorNode: textNode, focusNode: textNode, text: 'alphabet', isCollapsed: true });

    expect(getSelectedTextWithinSurface(surface, { maxLength: 1 })).toBeNull();
  });
});
