import { isCustomViewThemeInit, parseCustomViewThemeUpdate } from './protocol.js';
import type { CustomViewThemeSnapshot } from './protocol.js';

export { CUSTOM_VIEW_THEME_TOKENS } from './tokens.js';
export type { CustomViewTokenName } from './tokens.js';
export {
  isCustomViewThemeInit,
  isCustomViewThemeReady,
  parseCustomViewThemeUpdate,
} from './protocol.js';
export type {
  CustomViewThemeInit,
  CustomViewThemeReady,
  CustomViewThemeSnapshot,
  CustomViewThemeUpdate,
} from './protocol.js';

export interface CustomViewThemeOptions {
  /** Exact host origin. Web previews must supply their HTTP(S) origin explicitly. */
  parentOrigin?: string;
  /** Apply tokens and color-scheme to document.documentElement. Defaults to true. */
  applyCss?: boolean;
}

export interface CustomViewTheme {
  /** Null until the host supplies a valid snapshot. Snapshots are deeply frozen. */
  getSnapshot(): CustomViewThemeSnapshot | null;
  /** Immediately delivers the current snapshot, if any; returns an unsubscribe function. */
  subscribe(listener: (snapshot: CustomViewThemeSnapshot) => void): () => void;
  /** Idempotently stops updates and restores styles still owned by this instance. */
  dispose(): void;
}

interface StyleValue {
  value: string;
  priority: string;
}

interface OwnedStyle {
  previous: StyleValue;
  applied: StyleValue;
}

function validateParentOrigin(origin: string): string {
  // WHATWG URL reports a null origin for app:, even though Electron registers it
  // as a standard scheme and emits this exact origin in MessageEvent.
  if (origin === 'app://workspaces') return origin;
  try {
    const url = new URL(origin);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin) {
      return origin;
    }
  } catch {
    // Fall through to the same error for malformed URLs and non-exact origins.
  }
  throw new TypeError('parentOrigin must be app://workspaces or an exact HTTP(S) origin');
}

/** Connect once per custom-view document; call dispose when its owner unmounts. */
export function createCustomViewTheme(options: CustomViewThemeOptions = {}): CustomViewTheme {
  const parentOrigin = validateParentOrigin(options.parentOrigin ?? 'app://workspaces');
  const viewWindow = typeof window === 'undefined' ? null : window;
  const parentWindow = viewWindow?.parent;
  const embedded = Boolean(parentWindow && parentWindow !== viewWindow);
  const style = options.applyCss !== false ? viewWindow?.document.documentElement.style : undefined;
  const ownedStyles = new Map<string, OwnedStyle>();
  const listeners = new Set<(snapshot: CustomViewThemeSnapshot) => void>();
  let snapshot: CustomViewThemeSnapshot | null = null;
  let disposed = false;

  function readStyle(name: string): StyleValue {
    return {
      value: style?.getPropertyValue(name) ?? '',
      priority: style?.getPropertyPriority(name) ?? '',
    };
  }

  function stillOwned(name: string, owned: OwnedStyle): boolean {
    const current = readStyle(name);
    return current.value === owned.applied.value && current.priority === owned.applied.priority;
  }

  function restoreStyle(name: string, owned: OwnedStyle): void {
    if (!style || !stillOwned(name, owned)) return;
    if (owned.previous.value) {
      style.setProperty(name, owned.previous.value, owned.previous.priority);
    } else {
      style.removeProperty(name);
    }
  }

  function applySnapshot(next: CustomViewThemeSnapshot): void {
    if (!style) return;
    const properties: Record<string, string> = { ...next.cssVariables, 'color-scheme': next.mode };
    for (const [name, owned] of ownedStyles) {
      if (!Object.hasOwn(properties, name)) {
        restoreStyle(name, owned);
        ownedStyles.delete(name);
      }
    }
    for (const [name, value] of Object.entries(properties)) {
      const owned = ownedStyles.get(name);
      const previous = owned && stillOwned(name, owned) ? owned.previous : readStyle(name);
      style.setProperty(name, value);
      ownedStyles.set(name, { previous, applied: readStyle(name) });
    }
  }

  function notify(listener: (theme: CustomViewThemeSnapshot) => void): void {
    if (!snapshot || disposed) return;
    try {
      listener(snapshot);
    } catch (error) {
      // A view's subscriber must not prevent CSS updates or other subscribers.
      console.error('Custom view theme subscriber failed', error);
    }
  }

  function sendReady(): void {
    if (embedded && !disposed) {
      parentWindow?.postMessage({ type: 'intent:theme:ready', version: 1 }, parentOrigin);
    }
  }

  function onMessage(event: MessageEvent<unknown>): void {
    if (disposed || !embedded || event.source !== parentWindow || event.origin !== parentOrigin) {
      return;
    }
    if (isCustomViewThemeInit(event.data)) {
      sendReady();
      return;
    }
    const next = parseCustomViewThemeUpdate(event.data);
    if (!next) return;
    snapshot = next;
    applySnapshot(next);
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) notify(listener);
    }
  }

  viewWindow?.addEventListener('message', onMessage);
  sendReady();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      notify(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      viewWindow?.removeEventListener('message', onMessage);
      listeners.clear();
      for (const [name, owned] of ownedStyles) restoreStyle(name, owned);
      ownedStyles.clear();
    },
  };
}
