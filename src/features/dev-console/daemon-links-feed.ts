import type {
  LinkCaptureStatus,
  LinkTrafficRead,
  LinkTrafficRecord,
  LinkTrafficRow,
} from '$shared/types/daemon-links';

/** Session-scoped daemon-link capture calls exposed by the Dev Console bridge. */
export interface DaemonLinksApi {
  status(): Promise<{ supported: boolean }>;
  start(): Promise<LinkCaptureStatus>;
  stop(): Promise<LinkCaptureStatus>;
  read(afterSeq: number): Promise<LinkTrafficRead>;
  record(seq: number): Promise<LinkTrafficRecord | null>;
  /** `remoteLinkTraffic:records` arrived (start, stop or new records); returns a disposer. */
  onChanged?(listener: () => void): () => void;
}

export interface DaemonLinksState {
  /** null until the first capability check answers. */
  supported: boolean | null;
  /** null until the first snapshot answers. */
  capture: LinkCaptureStatus | null;
  /** Oldest first, never more than the daemon retains. */
  rows: LinkTrafficRow[];
  busy: boolean;
  error: string | null;
}

const LINK_FEED_TIMING = {
  /** Local capability check (no daemon call). */
  statusMs: 2000,
  /** Fallback snapshot cadence while capture is on; each records event also re-reads at once. */
  liveMs: 3000,
  /** Fallback cadence while capture is off (another owner client may start it). */
  idleMs: 5000,
};

/**
 * Owns the Daemon links view's reads. Capability checks are main-local; the
 * daemon is only read while the view is visible: at once on every
 * `remoteLinkTraffic:records` event (including the empty one each start and
 * stop emits), plus a slow fallback poll that also fills gaps. Rows mirror the daemon's bounded buffer: a new capture (startedAt
 * changed), a stop, or a daemon restart resets them.
 */
export function createDaemonLinksFeed(
  api: DaemonLinksApi,
  onState: (state: DaemonLinksState) => void,
  timing = LINK_FEED_TIMING,
) {
  let state: DaemonLinksState = {
    supported: null,
    capture: null,
    rows: [],
    busy: false,
    error: null,
  };
  let disposed = false;
  let visible = false;
  let lastSeq = -1;
  let generation: string | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  let reading: Promise<void> | null = null;
  let readAgain = false;
  const publish = (next: Partial<DaemonLinksState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    onState(state);
  };
  const reset = (capture: LinkCaptureStatus | null) => {
    lastSeq = -1;
    generation = capture?.active ? (capture.startedAt ?? '') : undefined;
    return [] as LinkTrafficRow[];
  };
  function merge(result: LinkTrafficRead): boolean {
    const { capture } = result;
    let rows = state.rows;
    if (!capture.active) {
      rows = reset(capture);
      publish({ capture, rows });
      return false;
    }
    const key = capture.startedAt ?? '';
    if (lastSeq >= 0 && (generation !== key || capture.nextSeq < lastSeq + 1)) {
      // A new capture (or a restarted daemon): this page may start mid-buffer, so re-read.
      rows = reset(capture);
      publish({ capture, rows });
      return true;
    }
    generation = key;
    const fresh = result.records.filter((row) => row.seq > lastSeq);
    if (fresh.length) {
      rows = [...rows, ...fresh];
      lastSeq = fresh[fresh.length - 1].seq;
    }
    const firstRetained = capture.nextSeq - capture.retained;
    rows = rows.filter((row) => row.seq >= firstRetained);
    if (capture.maxRecords > 0 && rows.length > capture.maxRecords)
      rows = rows.slice(rows.length - capture.maxRecords);
    publish({ capture, rows });
    // A reply may stop short (size cap): page on until the newest record is held.
    return fresh.length > 0 && lastSeq < capture.nextSeq - 1;
  }
  /** Single-flight with one trailing re-read for triggers that arrive mid-flight. */
  function readNow(): Promise<void> {
    if (reading) {
      readAgain = true;
      return reading;
    }
    if (disposed || state.supported !== true) {
      schedule();
      return Promise.resolve();
    }
    const run = async () => {
      try {
        do {
          readAgain = false;
          const result = await api.read(lastSeq);
          if (disposed || state.supported !== true) return;
          if (merge(result)) readAgain = true;
          if (state.error) publish({ error: null });
        } while (readAgain && !disposed);
      } catch (error) {
        publish({ error: String(error) });
      } finally {
        reading = null;
        schedule();
      }
    };
    // `run` always awaits before settling, so `reading` is assigned before `finally` clears it.
    reading = run();
    return reading;
  }
  function schedule() {
    if (readTimer) clearTimeout(readTimer);
    readTimer = undefined;
    if (disposed || !visible || state.supported !== true) return;
    readTimer = setTimeout(
      () => void readNow(),
      state.capture?.active ? timing.liveMs : timing.idleMs,
    );
  }
  async function checkStatus() {
    statusTimer = undefined;
    try {
      const { supported } = await api.status();
      if (disposed) return;
      if (supported !== state.supported) {
        if (!supported) {
          reset(null);
          publish({ supported: false, capture: null, rows: [], error: null });
        } else publish({ supported: true });
        if (supported && visible) void readNow();
        else schedule();
      }
    } catch {
      /* The capability check is retried on the next tick. */
    }
    if (!disposed) statusTimer = setTimeout(() => void checkStatus(), timing.statusMs);
  }
  async function command(run: () => Promise<LinkCaptureStatus>) {
    if (state.busy) return;
    publish({ busy: true, error: null });
    try {
      const capture = await run();
      if (disposed) return;
      if (!capture.active) publish({ capture, rows: reset(capture) });
      else publish({ capture });
      publish({ busy: false });
      await readNow();
    } catch (error) {
      publish({ busy: false, error: String(error) });
    }
  }
  const stopListening = api.onChanged?.(() => {
    if (visible) void readNow();
  });
  void checkStatus();
  return {
    get state() {
      return state;
    },
    /** Read the daemon only while the Daemon links view is shown. */
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (visible) void readNow();
      else schedule();
    },
    start: () => command(api.start),
    stop: () => command(api.stop),
    record: (seq: number) => api.record(seq),
    dispose() {
      disposed = true;
      stopListening?.();
      if (statusTimer) clearTimeout(statusTimer);
      if (readTimer) clearTimeout(readTimer);
    },
  };
}
export type DaemonLinksFeed = ReturnType<typeof createDaemonLinksFeed>;
