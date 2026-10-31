import { fireEvent, waitFor, type waitForOptions } from '@testing-library/svelte';
import { DISMISSIBLE_LAYER_ARMED, readDismissibleLayerState } from './dismissible-layer-state';

/**
 * Unit-test (jsdom) waits for a closing menu, popover, select, tooltip or dialog to leave
 * the page. For Playwright CT use `src/test/dismissible-layer.ts` and `ct-test.ts` instead.
 *
 * bits-ui keeps closing content mounted until its exit animations finish, which takes at
 * least one animation frame now that src/test-setup.ts provides `getAnimations`
 * (cloudlands-fe#3889). So right after a click, Escape or `open = false`, the old content
 * is still in the DOM with `data-state="closed"`: a synchronous "is it gone?" check
 * fails, and a query for the next menu's items can find the old ones. Wait for the exit
 * with these helpers instead of writing a `waitFor` per test.
 */

const FLOATING_WRAPPER = '[data-bits-floating-content-wrapper]';
const LAYER_ROLES = ['menu', 'listbox', 'dialog', 'alertdialog', 'tooltip'];
const LAYER_CONTENT = LAYER_ROLES.map((role) => `[role="${role}"]`).join(', ');

/**
 * The layer that `target` belongs to: the bits-ui floating wrapper around it (menus,
 * submenus, popovers, selects, comboboxes, tooltips), else the nearest element with a
 * menu, listbox, dialog, alertdialog or tooltip role, else `target` itself (a custom
 * popup such as `ui/dropdown`, for which pass the popup's root element).
 */
export function layerContaining(target: Element): Element {
  return target.closest(FLOATING_WRAPPER) ?? target.closest(LAYER_CONTENT) ?? target;
}

function describe(element: Element): string {
  const attributes = [...element.attributes]
    .filter(({ name }) => name !== 'class' && name !== 'style')
    .map(({ name, value }) => (value === '' ? name : `${name}=${JSON.stringify(value)}`));
  const openTag = `<${[element.tagName.toLowerCase(), ...attributes].join(' ')}>`;
  return openTag.length > 160 ? `${openTag.slice(0, 157)}...` : openTag;
}

/**
 * Wait until the layer containing `target` has left the page.
 *
 * Capture `target` while the layer is open (the menu, or any item in it), then close it
 * and await this. Only that layer is awaited, so a submenu can close while its root
 * menu stays open:
 *
 * ```ts
 * const item = await screen.findByRole('menuitem', { name: 'Rename' });
 * await fireEvent.click(item);
 * await waitForLayerExit(item);
 * ```
 */
export async function waitForLayerExit(target: Element, options?: waitForOptions): Promise<void> {
  const layer = layerContaining(target);
  await waitFor(() => {
    if (layer.isConnected) {
      throw new Error(`Expected the closing layer to leave the page: ${describe(layer)}`);
    }
  }, options);
}

/** Layer contents that are still mounted only to play their exit. */
export function closingLayers(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll('[data-state="closed"]')].filter(
    (element) =>
      element.matches(LAYER_CONTENT) || element.parentElement?.matches(FLOATING_WRAPPER) === true,
  );
}

/**
 * Wait until no menu, popover, select, tooltip or dialog is still playing its exit.
 *
 * Use it when the test has no handle on the closing layer, for example in a helper that
 * opens a menu and must not pick up items from the previous, still-closing one. It
 * relies on bits-ui marking closing content `data-state="closed"`; open layers do not
 * delay it. Content that stays mounted while closed (`forceMount`) never leaves, so wait
 * for a specific layer with {@link waitForLayerExit} there.
 */
export async function waitForClosingLayers(options?: waitForOptions): Promise<void> {
  await waitFor(() => {
    const closing = closingLayers();
    if (closing.length > 0) {
      throw new Error(
        `Expected closing layers to leave the page: ${closing.map(describe).join(', ')}`,
      );
    }
  }, options);
}

/**
 * Wait until the bits-ui layer containing `target` listens for outside pointers. The unit
 * test counterpart of `expectDismissibleLayerArmed` (src/test/dismissible-layer.ts).
 *
 * bits-ui adds its outside-pointer listeners in an `afterSleep(1)` timer after the layer
 * mounts, so a `fireEvent.pointerDown(document.body)` sent right after opening is ignored
 * and the layer stays open. Call this before an outside pointer dismissal; Escape needs
 * no wait.
 */
export async function waitForDismissibleLayerArmed(
  target: Element,
  options?: waitForOptions,
): Promise<void> {
  await waitFor(() => {
    const state = readDismissibleLayerState(target);
    if (state !== DISMISSIBLE_LAYER_ARMED) throw new Error(state);
  }, options);
}

/**
 * Dismiss the bits-ui layer containing `target` with a mouse press outside it, as a user
 * clicking elsewhere on the page would. Waits for the layer to arm first
 * ({@link waitForDismissibleLayerArmed}), then presses and clicks `outside`
 * (default `document.body`). Follow it with {@link waitForLayerExit} to see the layer go.
 *
 * bits-ui also requires the press to land outside the layer's bounding box. jsdom has no
 * layout, so every box is 0x0 at (0, 0) and a press at the default (0, 0) counts as
 * inside: a bare `fireEvent.pointerDown(document.body)` never dismisses anything, and a
 * test that then checks "the menu is gone" can only pass if something else closed it.
 * This press lands at (1, 1).
 */
export async function pressOutsideLayer(
  target: Element,
  outside: Element = document.body,
): Promise<void> {
  await waitForDismissibleLayerArmed(target);
  const point = { clientX: 1, clientY: 1, button: 0, pointerType: 'mouse' };
  await fireEvent.pointerDown(outside, point);
  await fireEvent.pointerUp(outside, point);
  await fireEvent.click(outside, point);
}
