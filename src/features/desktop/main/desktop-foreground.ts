/** Reads the frontmost application's pid; `undefined` when the OS reports none. */
export type FrontmostSampler = () => Promise<number | undefined>;

interface Track {
  sessionId: string;
  /** Frontmost pid attributed to the agent (or the session start). */
  expected?: number;
  lastAgentAction: number;
  userSwitched: boolean;
  settle?: ReturnType<typeof setTimeout>;
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
 * expires. A change outside that window is the user's, and stays so for the
 * rest of the session.
 */
export class DesktopForegroundTracker {
  private track?: Track;
  constructor(
    private readonly sample: FrontmostSampler,
    private readonly graceMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async read(): Promise<number | undefined> {
    try {
      return await this.sample();
    } catch {
      return undefined;
    }
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

  async begin(sessionId: string): Promise<void> {
    clearTimeout(this.track?.settle);
    const t: Track = { sessionId, lastAgentAction: -Infinity, userSwitched: false };
    this.track = t;
    const pid = await this.read();
    if (this.track === t) t.expected = pid;
  }
  async beforeAgentAction(sessionId: string): Promise<void> {
    const t = this.current(sessionId);
    if (!t) return;
    const pid = await this.read();
    if (this.track === t) this.observe(t, pid);
  }
  async afterAgentAction(sessionId: string): Promise<void> {
    const t = this.current(sessionId);
    if (!t) return;
    t.lastAgentAction = this.now();
    const pid = await this.read();
    if (this.track !== t) return;
    if (pid !== undefined) t.expected = pid;
    clearTimeout(t.settle);
    // Catch an activation that lands after the action with no later action.
    t.settle = setTimeout(() => {
      void this.read().then((late) => {
        if (
          this.track === t &&
          late !== undefined &&
          this.now() - t.lastAgentAction <= this.graceMs + 1_000
        )
          t.expected = late;
      });
    }, this.graceMs);
    t.settle.unref?.();
  }
  /** `true` when the user switched apps, `undefined` when it cannot tell. */
  async userSwitched(sessionId: string): Promise<boolean | undefined> {
    const t = this.current(sessionId);
    if (!t) return undefined;
    if (t.userSwitched) return true;
    const pid = await this.read();
    if (pid === undefined || t.expected === undefined) return undefined;
    if (pid === t.expected || !this.settled(t)) return false;
    return true;
  }
}
