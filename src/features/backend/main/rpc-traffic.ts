/** Main-process observation seam. Never sent to the renderer: payloads are unbounded. */
export type RpcTrafficMessage =
  | {
      type: 'request';
      key: string;
      direction: 'outbound' | 'inbound';
      requestId: number | string;
      method: string;
      payload: unknown;
    }
  | {
      type: 'response';
      key: string;
      status: 'success' | 'error' | 'timeout' | 'send-error';
      payload: unknown;
    }
  | { type: 'notification'; method: string; payload: unknown }
  | { type: 'disconnected' };

export type RpcTrafficEvent = RpcTrafficMessage & { connectionGeneration: number };

export type RpcTrafficObserver = (event: RpcTrafficEvent) => void | Promise<void>;
export interface RpcTrafficSource {
  /** Detach on console close/crash. Observers must never affect transport behavior. */
  observeTraffic(observer: RpcTrafficObserver): () => void;
}
