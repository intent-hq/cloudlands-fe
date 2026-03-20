/**
 * Tracks workspace identity across the ChatPanel lifecycle to detect
 * workspace rebinds that happen while async initialization is in flight.
 *
 * Extracted from ChatPanel.svelte so the race-prevention logic can be
 * unit-tested against production code without rendering the full component.
 *
 * Usage sites in ChatPanel:
 *   - onMount: recordMount() before await, wasWorkspaceChangedDuringMount() after
 *   - $effect: shouldRebind() detects prop change, recordRebind() updates tracking
 *   - handleSendMessage: hasWorkspaceChanged() + recordRebind() for send-time check
 */

export class WorkspaceRebindTracker {
  private previousWorkspaceId: string | null = null;

  /**
   * True while an async initializeChat triggered by a workspace rebind is
   * in flight. The send path must check this to avoid sending against a
   * stale/partially-initialized ChatService.
   */
  private _isRebinding = false;

  /**
   * Monotonically increasing generation counter. Each startRebind() increments
   * this so that overlapping rebinds (A→B→C) don't let an earlier endRebind()
   * clear isRebinding while a newer rebind is still in flight.
   */
  private _generation = 0;

  /** Resolves when the current in-flight rebind completes (success or failure). */
  private _rebindPromise: Promise<void> | null = null;
  private _rebindResolve: (() => void) | null = null;

  /**
   * Called at the start of onMount, BEFORE the async initializeChat await.
   * Returns the mount-time workspace ID for later comparison.
   *
   * Setting this before the await is the core fix: it ensures shouldRebind()
   * can detect a workspace change that arrives during initialization.
   * Without this, previousWorkspaceId stays null and shouldRebind() returns
   * false (null guard).
   */
  recordMount(workspaceId: string): string {
    this.previousWorkspaceId = workspaceId;
    return workspaceId;
  }

  /**
   * Called after the onMount initializeChat await resolves.
   * Returns true if the workspace changed while we were awaiting,
   * meaning the stale result should NOT be applied.
   */
  wasWorkspaceChangedDuringMount(mountWorkspaceId: string): boolean {
    return this.previousWorkspaceId !== mountWorkspaceId;
  }

  /**
   * Called by the reactive $effect to determine if a workspace rebind
   * occurred. Returns true if the workspace ID changed and re-initialization
   * is needed.
   *
   * Returns false (no action) when:
   *   - previousWorkspaceId is null (first run; onMount handles init)
   *   - currentWorkspaceId matches previousWorkspaceId (no change)
   */
  shouldRebind(currentWorkspaceId: string | undefined): boolean {
    if (!currentWorkspaceId) return false;
    if (this.previousWorkspaceId === null) return false;
    return currentWorkspaceId !== this.previousWorkspaceId;
  }

  /**
   * Updates the tracked workspace ID after a rebind is detected
   * (by the $effect or handleSendMessage).
   */
  recordRebind(workspaceId: string): void {
    this.previousWorkspaceId = workspaceId;
  }

  /**
   * Returns true if the given workspace ID differs from the tracked one.
   * Used by handleSendMessage to detect workspace changes at send time.
   */
  hasWorkspaceChanged(workspaceId: string): boolean {
    return workspaceId !== this.previousWorkspaceId;
  }

  /** Current tracked workspace ID (for logging). */
  get trackedWorkspaceId(): string | null {
    return this.previousWorkspaceId;
  }

  // ── In-flight rebind tracking ──────────────────────────────────────

  /** Whether a rebind initializeChat is currently in flight. */
  get isRebinding(): boolean {
    return this._isRebinding;
  }

  /**
   * Mark the start of an async rebind. Call this BEFORE awaiting
   * initializeChat in the rebind $effect.
   *
   * Returns a generation number that must be passed to endRebind() so
   * that only the *latest* rebind's completion unblocks the send path.
   */
  startRebind(): number {
    this._generation++;
    this._isRebinding = true;
    // Resolve any prior promise so callers already awaiting waitForRebind()
    // on the old generation are unblocked immediately instead of timing out.
    this._rebindResolve?.();
    // Create a fresh promise for the latest rebind so new waitForRebind()
    // calls wait on the correct (newest) one.
    this._rebindPromise = new Promise<void>((resolve) => {
      this._rebindResolve = resolve;
    });
    return this._generation;
  }

  /**
   * Mark the end of an async rebind (success or failure). Call this in
   * both the success and error paths of the rebind $effect.
   *
   * Only clears `isRebinding` if `generation` matches the latest
   * startRebind(). An older rebind completing while a newer one is
   * in-flight is a no-op for the flag/promise (the newer one still
   * owns them).
   */
  endRebind(generation?: number): void {
    // If no generation is provided (backwards compat), always clear.
    // If provided but stale, skip — a newer rebind owns the flag.
    if (generation !== undefined && generation !== this._generation) {
      return;
    }
    this._isRebinding = false;
    this._rebindResolve?.();
    this._rebindPromise = null;
    this._rebindResolve = null;
  }

  /**
   * Wait for an in-flight rebind to complete, with a timeout.
   * Returns true if the rebind completed, false if it timed out or
   * no rebind was in flight.
   *
   * Handles supersession: if a newer startRebind() resolves the promise
   * we were awaiting while a newer rebind is still in flight, we loop
   * and wait on the new promise. This prevents the send path from
   * proceeding against a stale/partially-initialized chatService.
   */
  async waitForRebind(timeoutMs = 5000): Promise<boolean> {
    if (!this._isRebinding || !this._rebindPromise) return false;

    const deadline = Date.now() + timeoutMs;

    while (this._isRebinding && this._rebindPromise) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;

      // FIX: Track the timeout so it can be cancelled when the rebind
      // promise resolves first, preventing a leaked timer.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        this._rebindPromise.then(() => false),
        new Promise<true>((resolve) => {
          timeoutId = setTimeout(() => resolve(true), remaining);
        }),
      ]);
      clearTimeout(timeoutId);

      if (timedOut) return false;

      // The promise resolved. If isRebinding is still true, a newer
      // startRebind() superseded the one we were waiting on — loop to
      // wait on the fresh promise.
    }

    return true;
  }
}

