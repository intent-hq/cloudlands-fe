import type { Host } from './paragraph-browser';

/**
 * Default: synchronous observation only. preClearFlush changes scheduling at stop entry.
 * postReleaseNewerSelection installs a newer state at the actual deferred callback entry.
 */
export function installPointerProbe(
  el: Element,
  options:
    | boolean
    | {
        full: boolean;
        preClearFlush?: boolean;
        postReleaseNewerSelection?: boolean;
        deferAtStop?: boolean;
        deferredMutations?: boolean;
        settleDeferred?: boolean;
        nativeFinalizer?: boolean;
      },
) {
  const full = typeof options === 'boolean' ? options : options.full;
  const preClearFlush = typeof options === 'boolean' ? false : !!options.preClearFlush;
  const postReleaseNewerSelection =
    typeof options === 'boolean' ? false : !!options.postReleaseNewerSelection;
  const deferAtStop = typeof options === 'boolean' ? false : !!options.deferAtStop;
  const deferredMutations = typeof options === 'boolean' ? false : !!options.deferredMutations;
  const settleDeferred = typeof options === 'boolean' ? false : !!options.settleDeferred;
  const nativeFinalizer = typeof options === 'boolean' ? false : !!options.nativeFinalizer;
  const host = el as Host & {
    pointerProbe: {
      trace: unknown[];
      record: (kind: string, detail?: unknown) => void;
      pendingTimers: () => number[];
      cleanup: () => void;
    };
  };
  const editor = host.proof?.editor ?? host.native;
  type DOMState = {
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
    eq: (selection: Selection) => boolean;
  };
  type MouseState = { allowDefault: boolean; delayedSelectionSync: boolean; done: () => void };
  const view = editor.view as typeof editor.view & {
    input: { mouseDown: MouseState | null };
    domObserver: {
      currentSelection: DOMState;
      flushingSoon: number;
      queue: MutationRecord[];
      suppressingSelectionUpdates: boolean;
      pendingRecords: () => MutationRecord[];
      flush: () => void;
      flushSoon: () => void;
      forceFlush: () => void;
      setCurSelection: () => void;
    };
  };
  const plugin = view.state.plugins.find((p) =>
    (p as unknown as { key: string }).key.startsWith('selectingCells'),
  )!;
  const trace: unknown[] = [],
    ids = new WeakMap<object, number>();
  const pendingTimers = new Set<number>();
  let next = 0,
    active = true,
    newerSelectionInstalled = false;
  const id = (node: object | null) => {
    if (!node) return null;
    let n = ids.get(node);
    if (!n) ids.set(node, (n = ++next));
    return n;
  };
  const endpoint = (node: Node | null, offset: number) => ({
    id: id(node),
    name: node?.nodeName,
    offset,
    inside: !!node && view.dom.contains(node),
  });
  const history = () => {
    try {
      const historyPlugin = view.state.plugins.find((p) =>
        (p as unknown as { key: string }).key.startsWith('history$'),
      );
      const value = historyPlugin?.getState(view.state);
      return { done: value?.done?.eventCount, undone: value?.undone?.eventCount };
    } catch (error) {
      return { error: String(error) };
    }
  };
  const record = (kind: string, detail?: unknown) => {
    if (!active || editor.isDestroyed || trace.length >= 4096) return;
    const raw = window.getSelection(),
      observed = view.domObserver.currentSelection,
      mouse = view.input.mouseDown;
    const owner = plugin.getState(view.state);
    trace.push({
      sequence: trace.length,
      kind,
      at: performance.now(),
      detail,
      model: view.state.selection.toJSON(),
      pm: { anchor: view.state.selection.anchor, head: view.state.selection.head },
      owner: { defined: owner !== undefined, value: owner ?? null },
      destroyed: editor.isDestroyed,
      observer: {
        underlyingBuffer: 'unknown',
        docViewPresent: !!(view as unknown as { docView?: unknown }).docView,
        flushingSoon: view.domObserver.flushingSoon,
        queuedMutations: view.domObserver.queue.length,
        suppressingSelectionUpdates: view.domObserver.suppressingSelectionUpdates,
      },
      history: postReleaseNewerSelection || deferAtStop ? history() : undefined,
      documentId: id(view.state.doc),
      selectionId: id(view.state.selection),
      focused: view.hasFocus(),
      raw: raw && {
        anchor: endpoint(raw.anchorNode, raw.anchorOffset),
        head: endpoint(raw.focusNode, raw.focusOffset),
      },
      observed: {
        anchor: endpoint(observed.anchorNode, observed.anchorOffset),
        head: endpoint(observed.focusNode, observed.focusOffset),
        equalsRaw: !!raw && observed.eq(raw),
      },
      mouse: mouse && {
        id: id(mouse),
        allowDefault: mouse.allowDefault,
        delayedSelectionSync: mouse.delayedSelectionSync,
      },
    });
  };
  const cleanup: Array<() => void> = [];
  const restore = (object: object, key: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  };
  host.pointerProbe = {
    trace,
    record,
    pendingTimers: () => [...pendingTimers],
    cleanup: () => {
      record('cleanup');
      const errors: string[] = [];
      for (const fn of cleanup.reverse()) {
        try {
          fn();
        } catch (error) {
          errors.push(String(error));
        }
      }
      active = false;
      if (errors.length) throw new Error(errors.join('; '));
    },
  };
  if (!full) {
    record('installed-minimal');
    return;
  }
  const originalFlush = view.domObserver.flush;
  const originalFlushSoon = view.domObserver.flushSoon;
  const originalForceFlush = view.domObserver.forceFlush;
  const dispatch = view.dispatch,
    dispatchDescriptor = Object.getOwnPropertyDescriptor(view, 'dispatch');
  view.dispatch = function (tr) {
    const value = tr.getMeta(plugin),
      meta = { defined: value !== undefined, value: value ?? null };
    record('dispatch-entry', {
      cellMeta: meta,
      selection: tr.selection.toJSON(),
      docChanged: tr.docChanged,
    });
    try {
      return Reflect.apply(dispatch, this, [tr]);
    } finally {
      record('dispatch-exit', { cellMeta: meta });
    }
  };
  cleanup.push(() => restore(view, 'dispatch', dispatchDescriptor));
  for (const key of ['flush', 'setCurSelection'] as const) {
    const original = view.domObserver[key],
      descriptor = Object.getOwnPropertyDescriptor(view.domObserver, key);
    view.domObserver[key] = function () {
      record(key + '-entry', { observerThis: this === view.domObserver });
      try {
        return Reflect.apply(original, this, []);
      } finally {
        record(key + '-exit');
      }
    };
    cleanup.push(() => restore(view.domObserver, key, descriptor));
  }
  const pendingRecords = view.domObserver.pendingRecords,
    pendingDescriptor = Object.getOwnPropertyDescriptor(view.domObserver, 'pendingRecords');
  view.domObserver.pendingRecords = function () {
    const result = Reflect.apply(pendingRecords, this, []);
    record('pendingRecords-return', {
      count: result.length,
      ignoredRootAttributes: deferAtStop
        ? result.filter(
            (mutation) =>
              mutation.type === 'attributes' &&
              mutation.target === view.dom &&
              mutation.attributeName === 'data-pointer-deferred-observation',
          ).length
        : undefined,
    });
    return result;
  };
  cleanup.push(() => restore(view.domObserver, 'pendingRecords', pendingDescriptor));
  if (nativeFinalizer) {
    const descriptor = Object.getOwnPropertyDescriptor(view.domObserver, 'forceFlush');
    view.domObserver.forceFlush = function () {
      record('native-force-flush-entry', { observerThis: this === view.domObserver });
      try {
        return Reflect.apply(originalForceFlush, this, []);
      } finally {
        record('native-force-flush-exit');
      }
    };
    cleanup.push(() => restore(view.domObserver, 'forceFlush', descriptor));
  }
  if (deferAtStop) {
    const timerIds = new Map<number, number>();
    const originalClear = window.clearTimeout;
    const clearDescriptor = Object.getOwnPropertyDescriptor(window, 'clearTimeout');
    window.clearTimeout = function (handle?: Parameters<typeof originalClear>[0]) {
      const timer = typeof handle === 'number' ? timerIds.get(handle) : undefined;
      if (timer !== undefined) record('observer-timer-cancel-entry', { timer, handle });
      try {
        return Reflect.apply(originalClear, this, [handle]);
      } finally {
        if (timer !== undefined) {
          record('observer-timer-cancel-exit', { timer, handle });
          pendingTimers.delete(timer);
          if (typeof handle === 'number') timerIds.delete(handle);
        }
      }
    };
    cleanup.push(() => restore(window, 'clearTimeout', clearDescriptor));
    const descriptor = Object.getOwnPropertyDescriptor(view.domObserver, 'flushSoon');
    view.domObserver.flushSoon = function () {
      const before = this.flushingSoon;
      const timers = window as unknown as {
        setTimeout: (handler: TimerHandler, delay?: number, ...args: unknown[]) => number;
      };
      const original = timers.setTimeout;
      const timerDescriptor = Object.getOwnPropertyDescriptor(window, 'setTimeout');
      record('flushSoon-entry', { before, observerThis: this === view.domObserver });
      timers.setTimeout = function (handler, delay, ...args) {
        if (typeof handler !== 'function')
          return Reflect.apply(original, this, [handler, delay, ...args]);
        const timer = ++next;
        pendingTimers.add(timer);
        const handle: number = Reflect.apply(original, this, [
          function (this: Window, ...values: unknown[]) {
            record('observer-timer-entry', { timer, handle });
            try {
              return Reflect.apply(handler, this, values);
            } finally {
              record('observer-timer-exit', { timer, handle });
              pendingTimers.delete(timer);
              timerIds.delete(handle);
            }
          },
          delay,
          ...args,
        ]);
        timerIds.set(handle, timer);
        record('observer-timer-schedule', { timer, handle, delay, source: String(handler) });
        return handle;
      };
      try {
        return Reflect.apply(originalFlushSoon, this, []);
      } finally {
        restore(window, 'setTimeout', timerDescriptor);
        record('flushSoon-exit', {
          before,
          after: this.flushingSoon,
          classification: before > -1 ? 'existing-pending' : 'newly-scheduled',
        });
      }
    };
    cleanup.push(() => restore(view.domObserver, 'flushSoon', descriptor));
  }
  const root = view.root,
    add = root.addEventListener,
    remove = root.removeEventListener;
  const addDescriptor = Object.getOwnPropertyDescriptor(root, 'addEventListener'),
    removeDescriptor = Object.getOwnPropertyDescriptor(root, 'removeEventListener');
  const registry = new Map<
    string,
    { callback: EventListener; wrapped: EventListener; active: boolean }
  >();
  const capture = (options?: boolean | EventListenerOptions) =>
    typeof options === 'boolean' ? options : !!options?.capture;
  root.addEventListener = function (
    this: Document | ShadowRoot,
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (typeof callback === 'function' && ['mouseup', 'dragstart', 'mousemove'].includes(type)) {
      const key = `${type}:${id(callback)}:${capture(options)}`;
      let entry = registry.get(key);
      if (!entry) {
        const wrapped: EventListener = function (this: EventTarget, event) {
          const detail = {
            type: event.type,
            id: id(callback),
            name: callback.name,
            eventPhase: event.eventPhase,
            buttons: (event as MouseEvent).buttons,
            trusted: event.isTrusted,
          };
          record('root-listener-entry', detail);
          const isStop = [...registry].some(
            ([key, registered]) => key.startsWith('dragstart:') && registered.callback === callback,
          );
          if ((preClearFlush || nativeFinalizer) && isStop) {
            const mouse = event as MouseEvent;
            const eligible =
              event.type === 'mouseup' &&
              mouse.button === 0 &&
              !editor.isDestroyed &&
              view.hasFocus() &&
              plugin.getState(view.state) != null &&
              '$anchorCell' in view.state.selection;
            record('pre-clear-flush-decision', {
              eligible,
              type: event.type,
              button: mouse.button,
            });
            if (eligible) {
              try {
                if (deferAtStop) {
                  record('diagnostic-deferred-setup-entry', { deferredMutations });
                  if (deferredMutations) {
                    const name = 'data-pointer-deferred-observation';
                    const previous = view.dom.getAttribute(name);
                    view.dom.setAttribute(name, 'diagnostic');
                    if (previous === null) view.dom.removeAttribute(name);
                    else view.dom.setAttribute(name, previous);
                  }
                  view.domObserver.flushSoon();
                  record('diagnostic-deferred-setup-exit', { deferredMutations });
                }
                if (!nativeFinalizer) {
                  record('pre-clear-flush-entry');
                  try {
                    if (settleDeferred && view.domObserver.flushingSoon > -1) {
                      record('native-force-flush-entry');
                      try {
                        Reflect.apply(originalForceFlush, view.domObserver, []);
                      } finally {
                        record('native-force-flush-exit');
                      }
                    } else Reflect.apply(originalFlush, view.domObserver, []);
                  } catch (error) {
                    record('pre-clear-flush-error', { error: String(error) });
                  } finally {
                    record('pre-clear-flush-exit');
                  }
                }
              } catch (error) {
                record('pre-clear-setup-error', { error: String(error) });
              }
            }
          }
          try {
            return Reflect.apply(callback, this, [event]);
          } finally {
            record('root-listener-exit', detail);
          }
        };
        entry = { callback, wrapped, active: false };
        registry.set(key, entry);
      }
      record('root-listener-add', {
        type,
        id: id(callback),
        capture: capture(options),
        source: String(callback),
        duplicate: entry.active,
      });
      entry.active = true;
      return Reflect.apply(add, this, [type, entry.wrapped, options]);
    }
    return Reflect.apply(add, this, [type, callback, options]);
  } as typeof add;
  root.removeEventListener = function (
    this: Document | ShadowRoot,
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    const entry =
      typeof callback === 'function'
        ? registry.get(`${type}:${id(callback)}:${capture(options)}`)
        : undefined;
    if (entry) {
      record('root-listener-remove', { type, id: id(callback), capture: capture(options) });
      entry.active = false;
    }
    return Reflect.apply(remove, this, [type, entry?.wrapped ?? callback, options]);
  } as typeof remove;
  cleanup.push(() => {
    const remaining = [...registry].filter(([, value]) => value.active).map(([key]) => key);
    record('gesture-listener-cleanup', { remaining });
    restore(root, 'addEventListener', addDescriptor);
    restore(root, 'removeEventListener', removeDescriptor);
    if (remaining.length)
      throw new Error('Diagnostic gesture listeners remain: ' + remaining.join(','));
  });
  const seen = new WeakSet<MouseState>();
  const mouseDown = () => {
    record('view-bubble-mousedown');
    const mouse = view.input.mouseDown;
    if (!mouse || seen.has(mouse)) return;
    seen.add(mouse);
    const done = mouse.done,
      descriptor = Object.getOwnPropertyDescriptor(mouse, 'done');
    mouse.done = function () {
      record('mouseDown.done-entry');
      const timers = window as unknown as {
        setTimeout: (handler: TimerHandler, delay?: number, ...args: unknown[]) => number;
      };
      const original = timers.setTimeout,
        timerDescriptor = Object.getOwnPropertyDescriptor(window, 'setTimeout');
      timers.setTimeout = function (handler, delay, ...args) {
        if (typeof handler !== 'function')
          return Reflect.apply(original, this, [handler, delay, ...args]);
        const timer = ++next;
        pendingTimers.add(timer);
        record('done-timer-schedule', { timer, delay, source: String(handler) });
        return Reflect.apply(original, this, [
          function (this: Window, ...values: unknown[]) {
            record('done-timer-entry', { timer });
            try {
              if (
                postReleaseNewerSelection &&
                !newerSelectionInstalled &&
                String(handler).includes('selectionToDOM')
              ) {
                newerSelectionInstalled = true;
                record('post-release-newer-selection-entry', { timer, history: history() });
                try {
                  editor.commands.setTextSelection(1);
                } catch (error) {
                  record('post-release-newer-selection-error', { timer, error: String(error) });
                } finally {
                  record('post-release-newer-selection-exit', { timer, history: history() });
                }
              }
              record('done-handler-entry', { timer });
              return Reflect.apply(handler, this, values);
            } finally {
              record('done-handler-exit', { timer });
              record('done-timer-exit', { timer });
              pendingTimers.delete(timer);
            }
          },
          delay,
          ...args,
        ]);
      };
      try {
        return Reflect.apply(done, this, []);
      } finally {
        restore(window, 'setTimeout', timerDescriptor);
        record('mouseDown.done-exit');
      }
    };
    cleanup.push(() => restore(mouse, 'done', descriptor));
  };
  view.dom.addEventListener('mousedown', mouseDown);
  cleanup.push(() => view.dom.removeEventListener('mousedown', mouseDown));
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'selectionchange']) {
    const handler = (event: Event) =>
      record('root-capture-' + type, {
        eventPhase: event.eventPhase,
        buttons: (event as MouseEvent).buttons,
        trusted: event.isTrusted,
      });
    Reflect.apply(add, root, [type, handler, true]);
    cleanup.push(() => Reflect.apply(remove, root, [type, handler, true]));
  }
  record('installed-full');
}
