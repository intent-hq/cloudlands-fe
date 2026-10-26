/** What {@link readDismissibleLayerState} returns once the target's layer is armed. */
export const DISMISSIBLE_LAYER_ARMED = 'armed';

/**
 * Read, in the page, whether the bits-ui layer around `target` listens for
 * outside pointers yet. Returns {@link DISMISSIBLE_LAYER_ARMED} or a sentence
 * saying why not, which `expect.poll` prints when the wait times out.
 *
 * bits-ui pairs an EscapeLayer and a DismissibleLayer on every layer element
 * (dialog and alert dialog content, popper content for menus, popovers,
 * selects and comboboxes, navigation menu content), with the same `ref` and
 * `enabled`. The EscapeLayer joins `globalThis.bitsEscapeLayers` as soon as
 * the layer mounts; the DismissibleLayer joins
 * `globalThis.bitsDismissableLayers` only after its `afterSleep(1)` timer adds
 * the outside-pointer listeners. So the union of both maps lists every open
 * layer, armed or not, and the dismissible map lists the armed ones.
 *
 * `target` may be the layer element or anything inside it. The innermost
 * layer that contains it is the one that must be armed: checking "some armed
 * layer contains the target" would pass early when an armed outer layer
 * contains a nested inner layer that is not armed yet.
 *
 * Playwright serializes this function into the page with `toString()`, so it
 * must not reference anything outside its own body.
 */
export function readDismissibleLayerState(target: Element): string {
  type Layer = { opts: { ref: { current: Element | null } } };
  const scope = globalThis as {
    bitsEscapeLayers?: Map<Layer, unknown>;
    bitsDismissableLayers?: Map<Layer, unknown>;
  };
  const escapeLayers = scope.bitsEscapeLayers;
  const dismissableLayers = scope.bitsDismissableLayers;
  const describe = (element: Element) => {
    // class and style are long and say little about which popup this is.
    const attributes = [...element.attributes]
      .filter(({ name }) => name !== 'class' && name !== 'style')
      .map(({ name, value }) => (value === '' ? name : `${name}=${JSON.stringify(value)}`));
    const openTag = `<${[element.tagName.toLowerCase(), ...attributes].join(' ')}>`;
    return openTag.length > 160 ? `${openTag.slice(0, 157)}...` : openTag;
  };
  const notBitsLayer = (detail: string) =>
    `no bits-ui layer contains ${describe(target)} (${detail}). ` +
    'Point the wait at an element inside the open bits-ui menu, popover, select, combobox or ' +
    'dialog. Custom popups such as ui/dropdown are not bits-ui layers and need no wait: ' +
    'disable intent/no-unarmed-outside-click-in-ct on that click with the reason instead.';

  if (!escapeLayers && !dismissableLayers) {
    return notBitsLayer('no bits-ui layer has been created on this page');
  }
  if (!escapeLayers || !dismissableLayers) {
    throw new Error(
      `globalThis.${escapeLayers ? 'bitsDismissableLayers' : 'bitsEscapeLayers'} is missing while ` +
        `globalThis.${escapeLayers ? 'bitsEscapeLayers' : 'bitsDismissableLayers'} exists; ` +
        'bits-ui changed how it tracks layers (src/test/dismissible-layer-state.ts)',
    );
  }

  let innermost: Element | null = null;
  for (const layer of [...escapeLayers.keys(), ...dismissableLayers.keys()]) {
    const element = layer.opts.ref.current;
    if (!element || !element.contains(target)) continue;
    if (!innermost || innermost.contains(element)) innermost = element;
  }
  if (!innermost) return notBitsLayer('no open bits-ui layer element is it or contains it');

  for (const layer of dismissableLayers.keys()) {
    if (layer.opts.ref.current === innermost) return 'armed';
  }
  return (
    `the bits-ui layer ${describe(innermost)} around ${describe(target)} has not registered ` +
    'its outside-pointer listeners yet'
  );
}
