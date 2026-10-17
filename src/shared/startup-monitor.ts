import {
  parseStartupSnapshot,
  startupFromError,
  type StartupState,
  type StartupSnapshot,
} from './startup-status';

/** One bounded poll at a time, owned by one physical connection. */
export class StartupMonitor {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  state: StartupState | null = null;

  constructor(private readonly changed: () => void) {}

  stop(clear = false): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (clear) this.state = null;
    else if (this.state) this.state = { snapshot: this.state.snapshot, available: false };
  }

  start(error: unknown, request: () => Promise<unknown>, reconnect: () => void): void {
    this.stop(true);
    const generation = this.generation;
    const publish = (snapshot: StartupSnapshot | null, available: boolean) => {
      this.state = { snapshot, available };
      this.changed();
    };
    const schedule = (snapshot: StartupSnapshot | null) => {
      if (snapshot?.phase === 'failed') return;
      if (snapshot?.phase === 'ready') {
        reconnect();
        return;
      }
      this.timer = setTimeout(() => {
        void poll();
      }, snapshot?.retryAfterMs ?? 1000);
    };
    const poll = async () => {
      try {
        const result = await request();
        if (generation !== this.generation) return;
        const snapshot = parseStartupSnapshot(result);
        publish(snapshot, snapshot !== null);
        schedule(snapshot);
      } catch {
        if (generation !== this.generation) return;
        publish(this.state?.snapshot ?? null, false);
        schedule(null);
      }
    };
    const snapshot = startupFromError(error);
    publish(snapshot, snapshot !== null);
    schedule(snapshot);
  }
}
