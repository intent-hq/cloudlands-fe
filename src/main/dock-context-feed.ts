import type { DockForegroundObservation } from '../shared/dock-context-links';

/** One native read at a time; hidden/retired documents cannot publish late samples. */
export function createDockContextFeed<Scope extends object>(deps: {
  scope(): Scope | null;
  visible(): boolean;
  read(): Promise<Omit<DockForegroundObservation, 'contextVersion' | 'sequence'>>;
  changed(observation: DockForegroundObservation): void;
  version(): string;
  intervalMs?: number;
}) {
  let stopped = true;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<DockForegroundObservation | null> | null = null;
  let owner: Scope | null = null;
  let current: DockForegroundObservation | null = null;
  /** Bumped by each explicit admission: a poll read started before it can never publish after it. */
  let admissions = 0;
  function reset(scope: Scope | null) {
    owner = scope;
    current = null;
  }
  /** Version and publish one sample exactly as a poll would; a self sample keeps the current. */
  function accept(value: Omit<DockForegroundObservation, 'contextVersion' | 'sequence'>) {
    // Focusing the dock must not replace the external context it is helping with.
    if (value.self) return current;
    const entry = current && current.identityKey === value.identityKey && current.url === value.url;
    const next: DockForegroundObservation = {
      ...value,
      sequence,
      contextVersion: entry && current ? current.contextVersion : deps.version(),
    };
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      next.sequence = ++sequence;
      current = next;
      deps.changed(next);
    }
    return current;
  }
  async function sample() {
    const scope = deps.scope();
    if (scope !== owner) reset(scope);
    if (stopped || !scope || !deps.visible()) return current;
    const epoch = admissions;
    const value = await deps.read();
    if (stopped || scope !== deps.scope() || !deps.visible()) return null;
    // An explicit admission happened while this read was in flight: it is the newer sample.
    if (epoch !== admissions) return current;
    return accept(value);
  }
  function read() {
    if (!pending)
      pending = sample()
        .catch(() => current)
        .finally(() => {
          pending = null;
        });
    return pending;
  }
  async function tick() {
    await read();
    if (!stopped) {
      timer = setTimeout(tick, deps.intervalMs ?? 750);
      timer.unref();
    }
  }
  return {
    read,
    /**
     * Admit an explicit pre-focus sample (a global shortcut press) through the same versioning
     * and publication as a poll, even while the dock is hidden. Only for the caller's current
     * scope; returns the admitted observation (null when stopped, out of scope or none).
     */
    admit(scope: Scope, value: Omit<DockForegroundObservation, 'contextVersion' | 'sequence'>) {
      if (stopped || scope !== deps.scope()) return null;
      if (scope !== owner) reset(scope);
      admissions++;
      return accept(value);
    },
    start() {
      if (!stopped) return;
      stopped = false;
      void tick();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      reset(null);
    },
  };
}
