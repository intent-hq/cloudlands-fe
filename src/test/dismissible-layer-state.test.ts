// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DISMISSIBLE_LAYER_ARMED, readDismissibleLayerState } from './dismissible-layer-state';

type Layer = { opts: { ref: { current: Element | null } } };
type LayerGlobals = {
  bitsEscapeLayers?: Map<Layer, unknown>;
  bitsDismissableLayers?: Map<Layer, unknown>;
};
const scope = globalThis as LayerGlobals;

function layer(element: Element | null): Layer {
  return { opts: { ref: { current: element } } };
}

/** Mount a layer element the way bits-ui does: escape now, dismissible once armed. */
function openLayer(element: Element, { armed }: { armed: boolean }) {
  scope.bitsEscapeLayers!.set(layer(element), 'close');
  if (armed) scope.bitsDismissableLayers!.set(layer(element), 'close');
}

function element(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as HTMLElement;
}

describe('readDismissibleLayerState', () => {
  afterEach(() => {
    delete scope.bitsEscapeLayers;
    delete scope.bitsDismissableLayers;
    document.body.replaceChildren();
  });

  function withRegistries() {
    scope.bitsEscapeLayers = new Map();
    scope.bitsDismissableLayers = new Map();
  }

  it('is armed for the registered layer element itself', () => {
    withRegistries();
    const content = element('<div data-select-content><div role="listbox"></div></div>');
    openLayer(content, { armed: true });
    expect(readDismissibleLayerState(content)).toBe(DISMISSIBLE_LAYER_ARMED);
  });

  it('is armed for a descendant of the registered layer element', () => {
    withRegistries();
    const content = element(
      '<div data-combobox-content><div role="listbox"><div role="option">Ada</div></div></div>',
    );
    openLayer(content, { armed: true });
    expect(readDismissibleLayerState(content.querySelector('[role="listbox"]')!)).toBe(
      DISMISSIBLE_LAYER_ARMED,
    );
    expect(readDismissibleLayerState(content.querySelector('[role="option"]')!)).toBe(
      DISMISSIBLE_LAYER_ARMED,
    );
  });

  it('waits while the layer around the target has not armed yet', () => {
    withRegistries();
    const content = element('<div data-menu-content><button>Item</button></div>');
    openLayer(content, { armed: false });
    expect(readDismissibleLayerState(content.querySelector('button')!)).toMatch(
      /^the bits-ui layer <div data-menu-content=""> around <button> has not registered/,
    );
  });

  it('waits for a nested inner layer even when the outer layer is armed', () => {
    withRegistries();
    const outer = element(
      '<div data-dialog-content><div data-popover-content><button>Inner</button></div></div>',
    );
    const inner = outer.querySelector('[data-popover-content]')!;
    openLayer(outer, { armed: true });
    openLayer(inner, { armed: false });
    const button = inner.querySelector('button')!;
    expect(readDismissibleLayerState(button)).toMatch(/data-popover-content.*has not registered/);
    expect(readDismissibleLayerState(outer)).toBe(DISMISSIBLE_LAYER_ARMED);

    scope.bitsDismissableLayers!.set(layer(inner), 'close');
    expect(readDismissibleLayerState(button)).toBe(DISMISSIBLE_LAYER_ARMED);
  });

  it('ignores layers whose element has unmounted', () => {
    withRegistries();
    const content = element('<div data-popover-content><span>Body</span></div>');
    scope.bitsEscapeLayers!.set(layer(null), 'close');
    scope.bitsDismissableLayers!.set(layer(null), 'close');
    openLayer(content, { armed: true });
    expect(readDismissibleLayerState(content.querySelector('span')!)).toBe(DISMISSIBLE_LAYER_ARMED);
  });

  it('says no bits-ui layer contains a custom popup', () => {
    withRegistries();
    const bits = element('<div data-popover-content></div>');
    openLayer(bits, { armed: true });
    const custom = element('<div role="listbox" data-dropdown-panel></div>');
    const state = readDismissibleLayerState(custom);
    expect(state).toMatch(/^no bits-ui layer contains <div role="listbox" data-dropdown-panel="">/);
    expect(state).toContain('ui/dropdown are not bits-ui layers');
  });

  it('says no bits-ui layer contains the target when bits-ui never created one', () => {
    const custom = element('<ul role="listbox"></ul>');
    expect(readDismissibleLayerState(custom)).toMatch(
      /^no bits-ui layer contains <ul role="listbox"> \(no bits-ui layer has been created/,
    );
  });

  it('throws when bits-ui keeps only one of its layer registries', () => {
    scope.bitsDismissableLayers = new Map();
    expect(() => readDismissibleLayerState(element('<div></div>'))).toThrow(
      /globalThis\.bitsEscapeLayers is missing .* bits-ui changed how it tracks layers/,
    );
    delete scope.bitsDismissableLayers;
    scope.bitsEscapeLayers = new Map();
    expect(() => readDismissibleLayerState(element('<div></div>'))).toThrow(
      /globalThis\.bitsDismissableLayers is missing/,
    );
  });

  it('shortens a long opening tag in the message', () => {
    withRegistries();
    const custom = element(`<div class="${'x'.repeat(300)}"></div>`);
    const state = readDismissibleLayerState(custom);
    expect(state).toMatch(/^no bits-ui layer contains <div class="x+\.\.\. \(/);
  });

  it('runs from its own source text, as Playwright evaluates it in the page', () => {
    withRegistries();
    const content = element('<div data-select-content><div role="listbox"></div></div>');
    openLayer(content, { armed: true });
    const serialized = new Function(`return (${readDismissibleLayerState.toString()})`)() as (
      target: Element,
    ) => string;
    expect(serialized(content.querySelector('[role="listbox"]')!)).toBe(DISMISSIBLE_LAYER_ARMED);
  });
});
