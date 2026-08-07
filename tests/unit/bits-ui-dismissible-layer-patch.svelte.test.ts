/**
 * Regression test for intent-hq/monorepo#1605.
 *
 * bits-ui's DismissibleLayerState reads its callback prop boxes from deferred
 * callbacks (afterTick / debounce), so a box whose `.current` is transiently a
 * non-function crashed the renderer with "n.call is not a function". The local
 * patch (patches/bits-ui@2.18.1.patch) type-guards those reads.
 *
 * The failures surface asynchronously (afterTick microtask, debounce timer), so
 * they are captured via process-level handlers rather than `expect().toThrow()`.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// bits-ui's exports map has no deep specifier, so resolve the patched module
// through the package root and import it by absolute path.
const require = createRequire(import.meta.url);
const patchedModulePath = path.join(
  path.dirname(require.resolve('bits-ui')),
  'bits/utilities/dismissible-layer/use-dismissable-layer.svelte.js',
);

const box = <T>(value: T) => ({ current: value });

// Defaults to the transiently non-function boxes from the crash report; the
// positive-control test passes real callbacks instead.
const createLayer = async (
  ref: HTMLElement,
  callbacks: { onInteractOutside?: unknown; onFocusOutside?: unknown } = {},
) => {
  const { DismissibleLayerState } = await import(/* @vite-ignore */ patchedModulePath);

  const cleanup = $effect.root(() =>
    DismissibleLayerState.create({
      ref: box(ref),
      enabled: box(true),
      interactOutsideBehavior: box('close'),
      onInteractOutside: box((callbacks.onInteractOutside ?? {}) as () => void),
      onFocusOutside: box((callbacks.onFocusOutside ?? {}) as () => void),
      isValidEvent: box(() => true),
    } as never),
  );

  // The layer registers its document listeners after afterSleep(1).
  await new Promise((resolve) => setTimeout(resolve, 20));

  return cleanup;
};

describe('bits-ui DismissibleLayerState patch (monorepo#1605)', () => {
  let asyncErrors: unknown[];
  let onUnhandled: (reason: unknown) => void;
  let ref: HTMLElement;

  beforeEach(() => {
    asyncErrors = [];
    onUnhandled = (reason) => asyncErrors.push(reason);
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);

    ref = document.createElement('div');
    document.body.appendChild(ref);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    process.off('uncaughtException', onUnhandled);
    ref.remove();
  });

  it('does not throw when onFocusOutside.current is not a function', async () => {
    const cleanup = await createLayer(ref);

    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // afterTick defers the onFocusOutside read.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(asyncErrors).toEqual([]);

    cleanup();
  });

  it('does not throw when onInteractOutside.current is not a function', async () => {
    const cleanup = await createLayer(ref);

    document.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }),
    );

    // #handleInteractOutside is debounced by 10ms.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(asyncErrors).toEqual([]);

    cleanup();
  });

  // Positive control: proves the dispatched events actually reach the guarded
  // call sites, so the two no-throw assertions above cannot pass vacuously.
  it('still invokes the callbacks when they are functions', async () => {
    const onFocusOutside = vi.fn();
    const onInteractOutside = vi.fn();
    const cleanup = await createLayer(ref, { onFocusOutside, onInteractOutside });

    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onFocusOutside).toHaveBeenCalled();
    expect(onInteractOutside).toHaveBeenCalled();
    expect(asyncErrors).toEqual([]);

    cleanup();
  });

  it('keeps the guards on all three deferred call sites', () => {
    const source = readFileSync(patchedModulePath, 'utf8');

    // #handleFocus → onFocusOutside
    expect(source).toContain('typeof this.#onFocusOutside?.current !== "function"');
    // #handleDismiss (touch/click deferred path) and #handleInteractOutside direct path
    const interactGuards = source.match(
      /typeof this\.#interactOutsideProp\?\.current !== "function"/g,
    );
    expect(interactGuards).toHaveLength(2);
    // Pre-existing guard must be preserved.
    expect(source).toContain('typeof this.opts.isValidEvent?.current !== "function"');
  });
});
