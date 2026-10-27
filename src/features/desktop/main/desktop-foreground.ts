/** Reads the frontmost application's pid; `undefined` when the OS reports none. */
export type FrontmostSampler = () => Promise<number | undefined>;

/** Tracking is optional telemetry: a sample never delays an agent action longer. */
const FOREGROUND_SAMPLE_TIMEOUT_MS = 250;
/** How late after the attribution window a settle sample may still be adopted. */
const SETTLE_SLACK_MS = 1_000;

interface Track {
  sessionId: string;
  /** Frontmost pid attributed to the agent (or the session start). */
  expected?: number;
  lastAgentAction: number;
  userSwitched: boolean;
  /** Bumped by every agent action; a settle sample from an older one is ignored. */
  generation: number;
  settleTimer?: ReturnType<typeof setTimeout>;
  /** The post-action settle sample is still owed (timer pending or sample running). */
  settleOwed: boolean;
  settling?: Promise<void>;
}

/**
 * Tells whether the user, not the agent, changed the frontmost app during a
 * desktop session, including switches between two non-Intent apps that
 * Electron's own focus events cannot see.
 *
 * Agent actions can change the frontmost app asynchronously (a Dock click
 * activates the app a second or two after the click returns), so any change
 * within `graceMs` of the last agent action is attributed to the agent: the
 * pid is re-sampled before each later action and once more when the window
 * expires (or at session end, if that settle sample is still owed). A change
 * outside that window is the user's, and stays so for the rest of the session.
 */
export class DesktopForegroundTracker {
  private track?: Track;
  constructor(
    private readonly sample: FrontmostSampler,
    private readonly graceMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sampleTimeoutMs = FOREGROUND_SAMPLE_TIMEOUT_MS,
  ) {}

  /** Bounded read; a failure, timeout or late result is simply "unknown". */
  private read(): Promise<number | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), this.sampleTimeoutMs);
      timer.unref?.();
      this.sample().then(
        (pid) => {
          clearTimeout(timer);
          resolve(pid);
        },
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
      );
    });
  }
  private current(sessionId: string): Track | undefined {
    return this.track?.sessionId === sessionId ? this.track : undefined;
  }
  private settled(t: Track): boolean {
    return this.now() - t.lastAgentAction >= this.graceMs;
  }
  /** Compares a reading with the agent-attributed app; adopts it when unsettled. */
  private observe(t: Track, pid: number | undefined): void {
    if (pid === undefined) return;
    if (t.expected !== undefined && pid !== t.expected && this.settled(t)) t.userSwitched = true;
    t.expected = pid;
  }
  /** Runs (or joins) the owed settle sample for the latest agent action. */
  private settle(t: Track): Promise<void> {
    clearTimeout(t.settleTimer);
    if (!t.settleOwed) return Promise.resolve();
    const generation = t.generation;
    return (t.settling ??= this.read().then((late) => {
      if (this.track !== t || t.generation !== generation) return;
      t.settleOwed = false;
      t.settling = undefined;
      if (late !== undefined && this.now() - t.lastAgentAction <= this.graceMs + SETTLE_SLACK_MS)
        t.expected = late;
    }));
  }
  private supersedeSettle(t: Track): void {
    clearTimeout(t.settleTimer);
    t.generation += 1;
    t.settleOwed = false;
    t.settling = undefined;
  }

  async begin(sessionId: string): Promise<void> {
    if (this.track) this.supersedeSettle(this.track);
    const t: Track = {
      sessionId,
      lastAgentAction: -Infinity,
      userSwitched: false,
      generation: 0,
      settleOwed: false,
    };
    this.track = t;
    const pid = await this.read();
    if (this.track === t) t.expected = pid;
  }
  async beforeAgentAction(sessionId: string): Promise<void> {
    const t = this.current(sessionId);
    if (!t) return;
    // This reading covers anything the owed settle sample would have seen.
    this.supersedeSettle(t);
    const pid = await this.read();
    if (this.track === t) this.observe(t, pid);
  }
  async afterAgentAction(sessionId: string): Promise<void> {
    const t = this.current(sessionId);
    if (!t) return;
    this.supersedeSettle(t);
    t.lastAgentAction = this.now();
    const generation = t.generation;
    const pid = await this.read();
    if (this.track !== t || t.generation !== generation) return;
    if (pid !== undefined) t.expected = pid;
    // Catch an activation that lands after the action with no later action.
    t.settleOwed = true;
    t.settleTimer = setTimeout(() => void this.settle(t), this.graceMs);
    t.settleTimer.unref?.();
  }
  /** `true` when the user switched apps, `undefined` when it cannot tell. */
  async userSwitched(sessionId: string): Promise<boolean | undefined> {
    const t = this.current(sessionId);
    if (!t) return undefined;
    if (t.userSwitched) return true;
    if (t.settleOwed && this.settled(t)) await this.settle(t);
    const pid = await this.read();
    if (this.track !== t) return undefined;
    if (pid === undefined || t.expected === undefined) return undefined;
    if (pid === t.expected || !this.settled(t)) return false;
    return true;
  }
}
