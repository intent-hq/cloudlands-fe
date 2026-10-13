import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/** Positive closure evidence, independent of facade teardown and logical retirement. */
export function createPhysicalSocketCloseSignal() {
  let closed = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void): () => void {
      if (closed) listener();
      else listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    closeObserved(): void {
      if (closed) return;
      closed = true;
      const current = [...listeners];
      listeners.clear();
      for (const listener of current) listener();
    },
  };
}
type CloseSource = Pick<ReturnType<typeof createPhysicalSocketCloseSignal>, 'subscribe'>;
const sources = new WeakMap<Duplex, CloseSource>();
const nativeObservers = new WeakMap<Duplex, () => void>();

export function bindPhysicalSocketCloseSource(socket: Duplex, source: CloseSource): void {
  sources.set(socket, source);
}

/** Unknown stream/facade close is not physical proof: preserve debt in that case. */
export function observePhysicalSocketClose(socket: Duplex, listener: () => void): () => void {
  let source = sources.get(socket);
  if (!source && socket instanceof Socket) {
    const signal = createPhysicalSocketCloseSignal();
    const onClose = () => {
      nativeObservers.delete(socket);
      signal.closeObserved();
    };
    nativeObservers.set(socket, onClose);
    socket.once('close', onClose);
    sources.set(socket, signal);
    source = signal;
  }
  return source?.subscribe(listener) ?? (() => {});
}

/** Preserve only an already-installed raw socket evidence listener after removeAllListeners. */
export function restorePhysicalSocketCloseObserver(socket: Duplex): void {
  const listener = nativeObservers.get(socket);
  if (listener && !socket.listeners('close').includes(listener)) socket.once('close', listener);
}
