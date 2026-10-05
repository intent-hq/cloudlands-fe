import type {
  AlertOptions,
  ConfirmOptions,
  ConfirmResult,
  PromptOptions,
  PromptResult,
} from './types';

interface RequestBase<T> {
  id: number;
  returnFocus: HTMLElement | null;
  resolve: (value: T) => void;
}

export type ConfirmRequest =
  | (RequestBase<ConfirmResult> & { kind: 'confirm'; options: ConfirmOptions })
  | (RequestBase<PromptResult> & { kind: 'prompt'; options: PromptOptions })
  | (RequestBase<void> & { kind: 'alert'; options: AlertOptions });

type Listener = (request: ConfirmRequest | null) => void;

let nextId = 1;
let active: ConfirmRequest | null = null;
const queue: ConfirmRequest[] = [];
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener(active);
}

function focusAtInvocation() {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
}

function enqueue<T>(
  request: Omit<RequestBase<T>, 'id' | 'returnFocus'> &
    (
      | { kind: 'confirm'; options: ConfirmOptions }
      | { kind: 'prompt'; options: PromptOptions }
      | { kind: 'alert'; options: AlertOptions }
    ),
) {
  queue.push({ ...request, id: nextId++, returnFocus: focusAtInvocation() } as ConfirmRequest);
  if (!active) {
    active = queue.shift() ?? null;
    notify();
  }
}

export function confirm(options: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', options, resolve }));
}

export function prompt(options: PromptOptions): Promise<PromptResult> {
  return new Promise((resolve) => enqueue({ kind: 'prompt', options, resolve }));
}

export function alert(options: AlertOptions | string): Promise<void> {
  const normalized = typeof options === 'string' ? { title: options } : options;
  return new Promise((resolve) => enqueue({ kind: 'alert', options: normalized, resolve }));
}

export function subscribeConfirmRequests(listener: Listener) {
  listeners.add(listener);
  listener(active);
  return () => listeners.delete(listener);
}

export function settleConfirmRequest(id: number, value: ConfirmResult | PromptResult | void) {
  if (!active || active.id !== id) return;
  const completed = active;
  active = queue.shift() ?? null;
  completed.resolve(value as never);
  completed.returnFocus?.focus();
  notify();
}

export function resetConfirmServiceForTests() {
  active = null;
  queue.length = 0;
  nextId = 1;
  notify();
}
