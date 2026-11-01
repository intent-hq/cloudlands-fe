import { getContext, setContext } from 'svelte';

/** Optional host ownership for detached surfaces; ordinary windows omit it. */
export interface OwnedPopupContext {
  target: () => HTMLElement | undefined;
  active: () => boolean;
  register: (element: HTMLElement, close?: () => void) => () => void;
}

const OWNED_POPUP_CONTEXT = Symbol('owned-popup-context');
const OWNED_POPUP_CLOSE = Symbol('owned-popup-close');

export function setOwnedPopupContext(context: OwnedPopupContext): void {
  setContext(OWNED_POPUP_CONTEXT, context);
}

export function getOwnedPopupContext(): OwnedPopupContext | undefined {
  return getContext<OwnedPopupContext | undefined>(OWNED_POPUP_CONTEXT);
}

export function setOwnedPopupClose(close: () => void): void {
  setContext(OWNED_POPUP_CLOSE, close);
}

export function getOwnedPopupClose(): (() => void) | undefined {
  return getContext<(() => void) | undefined>(OWNED_POPUP_CLOSE);
}

/** Capture context during component initialization, then attach to actual content only. */
export function createOwnedPopupRegistration(close?: () => void) {
  const owner = getOwnedPopupContext();
  const dismiss = close ?? getOwnedPopupClose();
  return (element: HTMLElement) => ({ destroy: owner?.register(element, dismiss) });
}
