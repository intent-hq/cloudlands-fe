import { createBackendInteractiveTerminalsClient } from './backend-interactive-terminals-client';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from './backend-transport';

/** Source compatibility binding; all wire behavior is shared with explicit hosts. */
export class LiveTerminalsClient {
  private client = createBackendInteractiveTerminalsClient({
    backendRequest: (...args) => backendRequest(...args),
    backendSubscribe: (...args) => backendSubscribe(...args),
    backendUnsubscribe: (...args) => backendUnsubscribe(...args),
    onBackendNotification: (...args) => onBackendNotification(...args),
    onBackendReconnected: (...args) => onBackendReconnected(...args),
  });
  list: typeof this.client.list = (...args) => this.client.list(...args);
  create: typeof this.client.create = (...args) => this.client.create(...args);
  write: typeof this.client.write = (...args) => this.client.write(...args);
  resize: typeof this.client.resize = (...args) => this.client.resize(...args);
  kill: typeof this.client.kill = (...args) => this.client.kill(...args);
  getBuffer: typeof this.client.getBuffer = (...args) => this.client.getBuffer(...args);
  output: typeof this.client.output = (...args) => this.client.output(...args);
  subscribeEvents: typeof this.client.subscribeEvents = (...args) =>
    this.client.subscribeEvents(...args);
  subscribe: typeof this.client.subscribe = (...args) => this.client.subscribe(...args);
}
