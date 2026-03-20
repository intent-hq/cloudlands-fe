import { describe, it, expect, vi } from 'vitest';
import { WorkspaceRebindTracker } from '../workspace-rebind-tracker';

describe('WorkspaceRebindTracker', () => {
  describe('initial state', () => {
    it('shouldRebind returns false when no mount has been recorded (null guard)', () => {
      const tracker = new WorkspaceRebindTracker();
      expect(tracker.shouldRebind('ws-1')).toBe(false);
    });

    it('trackedWorkspaceId is null before any recording', () => {
      const tracker = new WorkspaceRebindTracker();
      expect(tracker.trackedWorkspaceId).toBeNull();
    });
  });

  describe('recordMount', () => {
    it('sets the tracked workspace and returns the mount-time ID', () => {
      const tracker = new WorkspaceRebindTracker();
      const mountId = tracker.recordMount('ws-A');
      expect(mountId).toBe('ws-A');
      expect(tracker.trackedWorkspaceId).toBe('ws-A');
    });

    it('enables shouldRebind to detect subsequent changes', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');
      // Same workspace — no rebind needed
      expect(tracker.shouldRebind('ws-A')).toBe(false);
      // Different workspace — rebind needed
      expect(tracker.shouldRebind('ws-B')).toBe(true);
    });
  });

  describe('wasWorkspaceChangedDuringMount — the core race-prevention check', () => {
    it('returns false when workspace did NOT change during await', () => {
      const tracker = new WorkspaceRebindTracker();
      const mountId = tracker.recordMount('ws-A');
      // Simulate: initializeChat resolves, workspace still the same
      expect(tracker.wasWorkspaceChangedDuringMount(mountId)).toBe(false);
    });

    it('returns true when workspace changed during await (race condition)', () => {
      const tracker = new WorkspaceRebindTracker();
      const mountId = tracker.recordMount('ws-A');
      // Simulate: $effect fires and records a rebind while initializeChat is in flight
      tracker.recordRebind('ws-B');
      // Now the mount result is stale
      expect(tracker.wasWorkspaceChangedDuringMount(mountId)).toBe(true);
    });
  });

  describe('shouldRebind + recordRebind ($effect cycle)', () => {
    it('detects a workspace change and updates tracking after recordRebind', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // $effect sees ws-B
      expect(tracker.shouldRebind('ws-B')).toBe(true);
      tracker.recordRebind('ws-B');

      // Now ws-B is current, no rebind needed
      expect(tracker.shouldRebind('ws-B')).toBe(false);
      // ws-C would need rebind
      expect(tracker.shouldRebind('ws-C')).toBe(true);
    });

    it('returns false for undefined workspace', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');
      expect(tracker.shouldRebind(undefined)).toBe(false);
    });
  });

  describe('hasWorkspaceChanged (handleSendMessage)', () => {
    it('detects mismatch between tracked and given workspace', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');
      expect(tracker.hasWorkspaceChanged('ws-A')).toBe(false);
      expect(tracker.hasWorkspaceChanged('ws-B')).toBe(true);
    });
  });

  describe('full mount → race → stale-skip lifecycle', () => {
    it('reproduces the original bug scenario end-to-end', () => {
      const tracker = new WorkspaceRebindTracker();

      // 1. onMount starts: record before await
      const mountId = tracker.recordMount('ws-original');

      // 2. While initializeChat is in flight, workspace prop changes to ws-new.
      //    The $effect checks shouldRebind:
      expect(tracker.shouldRebind('ws-new')).toBe(true);
      //    $effect records the rebind and starts its own initializeChat
      tracker.recordRebind('ws-new');

      // 3. The original onMount's initializeChat finally resolves.
      //    It checks wasWorkspaceChangedDuringMount — should be TRUE (stale).
      expect(tracker.wasWorkspaceChangedDuringMount(mountId)).toBe(true);
      //    So the stale state is NOT applied. ✓

      // 4. The tracker now correctly tracks ws-new
      expect(tracker.trackedWorkspaceId).toBe('ws-new');
      expect(tracker.shouldRebind('ws-new')).toBe(false);
    });

    it('would fail if recordMount were skipped (the original bug)', () => {
      const tracker = new WorkspaceRebindTracker();

      // BUG SCENARIO: Without recordMount, tracker stays null.
      // The $effect's shouldRebind returns false (null guard), missing the change.
      expect(tracker.shouldRebind('ws-new')).toBe(false); // <-- BUG: should be true

      // This proves the fix: recordMount MUST be called before the await.
    });
  });

  describe('failed init revert — prevents suppressed rebinds', () => {
    it('allows retry after failed init by reverting tracker to previous workspace', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // $effect detects ws-B, records rebind
      expect(tracker.shouldRebind('ws-B')).toBe(true);
      const previousWorkspaceId = tracker.trackedWorkspaceId;
      tracker.recordRebind('ws-B');

      // initializeChat fails — revert tracker
      tracker.recordRebind(previousWorkspaceId ?? '');

      // Now shouldRebind for ws-B should return true again (retry is possible)
      expect(tracker.shouldRebind('ws-B')).toBe(true);
      expect(tracker.trackedWorkspaceId).toBe('ws-A');
    });

    it('does NOT revert if another rebind happened during the failed init', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // $effect detects ws-B, records rebind
      tracker.recordRebind('ws-B');
      const rebindWorkspaceId = 'ws-B';

      // While init for ws-B is in flight, another rebind to ws-C happens
      tracker.recordRebind('ws-C');

      // Init for ws-B fails — but ws-C already advanced the tracker
      // hasWorkspaceChanged(ws-B) is true because tracker is now at ws-C
      expect(tracker.hasWorkspaceChanged(rebindWorkspaceId)).toBe(true);

      // So we should NOT revert — tracker stays at ws-C
      expect(tracker.trackedWorkspaceId).toBe('ws-C');
    });

    it('reproduces the suppressed-rebind bug scenario end-to-end', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-original');

      // 1. Workspace changes to ws-new
      expect(tracker.shouldRebind('ws-new')).toBe(true);
      tracker.recordRebind('ws-new');

      // 2. initializeChat throws (e.g., network error, abort)
      // BUG: Without revert, shouldRebind('ws-new') returns false forever
      // because tracker already advanced to ws-new.

      // 3. Simulate revert (the fix)
      tracker.recordRebind('ws-original');

      // 4. Next $effect trigger can now detect ws-new again
      expect(tracker.shouldRebind('ws-new')).toBe(true);
      // And successfully re-initialize
      tracker.recordRebind('ws-new');
      expect(tracker.trackedWorkspaceId).toBe('ws-new');
    });
  });

  describe('in-flight rebind tracking (isRebinding / waitForRebind)', () => {
    it('isRebinding is false by default', () => {
      const tracker = new WorkspaceRebindTracker();
      expect(tracker.isRebinding).toBe(false);
    });

    it('startRebind sets isRebinding to true', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.startRebind();
      expect(tracker.isRebinding).toBe(true);
    });

    it('endRebind clears isRebinding', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.startRebind();
      tracker.endRebind();
      expect(tracker.isRebinding).toBe(false);
    });

    it('waitForRebind resolves when endRebind is called', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.startRebind();

      // Simulate async init completing after a short delay
      setTimeout(() => tracker.endRebind(), 10);

      const result = await tracker.waitForRebind(1000);
      expect(result).toBe(true);
      expect(tracker.isRebinding).toBe(false);
    });

    it('waitForRebind returns false when no rebind is in flight', async () => {
      const tracker = new WorkspaceRebindTracker();
      const result = await tracker.waitForRebind(100);
      expect(result).toBe(false);
    });

    it('waitForRebind times out if endRebind is never called', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.startRebind();

      const result = await tracker.waitForRebind(50);
      expect(result).toBe(false);
      // isRebinding is still true (the rebind hasn't actually finished)
      expect(tracker.isRebinding).toBe(true);

      // Clean up
      tracker.endRebind();
    });

    it('send-path race: detects in-flight rebind even when tracker ID already matches', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // $effect detects ws-B, records rebind and starts async init
      tracker.recordRebind('ws-B');
      tracker.startRebind();

      // At this point, hasWorkspaceChanged('ws-B') returns false because
      // the tracker already recorded ws-B. But isRebinding is true,
      // so the send path should wait.
      expect(tracker.hasWorkspaceChanged('ws-B')).toBe(false);
      expect(tracker.isRebinding).toBe(true);

      // Simulate init completing
      tracker.endRebind();
      expect(tracker.isRebinding).toBe(false);
    });

    it('send-path must abort when waitForRebind times out (prevents stale session send)', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // $effect detects ws-B, records rebind and starts async init
      tracker.recordRebind('ws-B');
      tracker.startRebind();

      // The send path detects isRebinding and waits, but the rebind
      // never completes (e.g., initializeChat hangs or takes too long).
      const rebindCompleted = await tracker.waitForRebind(50);
      expect(rebindCompleted).toBe(false);

      // CRITICAL: hasWorkspaceChanged('ws-B') returns false because
      // recordRebind already updated the tracker to ws-B. Without
      // checking the waitForRebind return value, the send path would
      // skip re-initialization and send against a stale chatService.
      expect(tracker.hasWorkspaceChanged('ws-B')).toBe(false);
      expect(tracker.isRebinding).toBe(true);

      // The send path MUST check rebindCompleted and abort if false.
      // This test documents the invariant that the caller is responsible
      // for handling the timeout case.

      // Clean up
      tracker.endRebind();
    });

    it('send-path proceeds normally when waitForRebind succeeds', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // $effect detects ws-B, records rebind and starts async init
      tracker.recordRebind('ws-B');
      const gen = tracker.startRebind();

      // Simulate init completing quickly
      setTimeout(() => tracker.endRebind(gen), 10);

      const rebindCompleted = await tracker.waitForRebind(1000);
      expect(rebindCompleted).toBe(true);
      expect(tracker.isRebinding).toBe(false);

      // After successful rebind, hasWorkspaceChanged returns false
      // (tracker matches), so the send path can proceed safely.
      expect(tracker.hasWorkspaceChanged('ws-B')).toBe(false);
    });
  });

  describe('overlapping rebinds (generation tracking)', () => {
    it('earlier endRebind does NOT clear isRebinding when a newer rebind is in flight', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // First rebind: A→B
      tracker.recordRebind('ws-B');
      const gen1 = tracker.startRebind();

      // Second rebind: B→C (starts before first completes)
      tracker.recordRebind('ws-C');
      const gen2 = tracker.startRebind();

      // First rebind completes — should NOT clear isRebinding
      tracker.endRebind(gen1);
      expect(tracker.isRebinding).toBe(true); // gen2 is still in flight

      // Second rebind completes — should clear isRebinding
      tracker.endRebind(gen2);
      expect(tracker.isRebinding).toBe(false);
    });

    it('waitForRebind waits for the latest rebind, not the first', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // First rebind
      tracker.recordRebind('ws-B');
      const gen1 = tracker.startRebind();

      // Second rebind (replaces the promise)
      tracker.recordRebind('ws-C');
      const gen2 = tracker.startRebind();

      // First rebind completes (stale generation — no-op)
      tracker.endRebind(gen1);
      expect(tracker.isRebinding).toBe(true);

      // waitForRebind should still be waiting (gen2 not done)
      // End gen2 after a short delay
      setTimeout(() => tracker.endRebind(gen2), 10);

      const result = await tracker.waitForRebind(1000);
      expect(result).toBe(true);
      expect(tracker.isRebinding).toBe(false);
    });

    it('rapid A→B→C: send path stays blocked until latest rebind completes', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // Rapid rebinds
      tracker.recordRebind('ws-B');
      const genB = tracker.startRebind();
      tracker.recordRebind('ws-C');
      const genC = tracker.startRebind();

      // genB finishes — still rebinding (genC owns flag)
      tracker.endRebind(genB);
      expect(tracker.isRebinding).toBe(true);

      // Send path checks and must wait
      expect(tracker.isRebinding).toBe(true);

      // genC finishes — now clear
      tracker.endRebind(genC);
      expect(tracker.isRebinding).toBe(false);
      expect(tracker.trackedWorkspaceId).toBe('ws-C');
    });

    it('existing waiters stay blocked until the latest superseding rebind completes', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // First rebind: A→B
      tracker.recordRebind('ws-B');
      const gen1 = tracker.startRebind();

      // Send path starts waiting on the first rebind's promise
      const waiterPromise = tracker.waitForRebind(500);

      // Before gen1 completes, a second rebind (B→C) starts,
      // which supersedes the first promise.
      tracker.recordRebind('ws-C');
      const gen2 = tracker.startRebind();

      // The waiter must NOT resolve yet — gen2 is still in flight.
      // Complete the latest rebind after a short delay.
      setTimeout(() => tracker.endRebind(gen2), 10);

      const result = await waiterPromise;
      expect(result).toBe(true);

      // Now isRebinding is actually false — safe to send.
      expect(tracker.isRebinding).toBe(false);
    });

    it('rapid A→B→C supersession: waitForRebind blocks until final generation completes', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      // Rapid-fire rebinds: A→B→C
      tracker.recordRebind('ws-B');
      const genB = tracker.startRebind();
      tracker.recordRebind('ws-C');
      const genC = tracker.startRebind();
      tracker.recordRebind('ws-D');
      const genD = tracker.startRebind();

      // Send path starts waiting — must not proceed until genD completes
      const waiterPromise = tracker.waitForRebind(500);

      // Stale generations complete — should be no-ops
      tracker.endRebind(genB);
      tracker.endRebind(genC);
      expect(tracker.isRebinding).toBe(true);

      // Complete the latest generation
      setTimeout(() => tracker.endRebind(genD), 10);

      const result = await waiterPromise;
      expect(result).toBe(true);
      expect(tracker.isRebinding).toBe(false);
      expect(tracker.trackedWorkspaceId).toBe('ws-D');
    });

    it('waitForRebind times out if superseding rebinds keep arriving', async () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      tracker.recordRebind('ws-B');
      tracker.startRebind();

      // waitForRebind with a very short timeout — the rebind never completes
      const result = await tracker.waitForRebind(50);
      expect(result).toBe(false);
      expect(tracker.isRebinding).toBe(true);

      // Clean up
      tracker.endRebind();
    });

    it('endRebind without generation (backwards compat) always clears', () => {
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');

      tracker.recordRebind('ws-B');
      tracker.startRebind();

      // Calling without generation — backwards-compatible, always clears
      tracker.endRebind();
      expect(tracker.isRebinding).toBe(false);
    });

    it('waitForRebind cancels timeout when rebind resolves first (no timer leak)', async () => {
      // Regression: the setTimeout in Promise.race was not cancelled when
      // _rebindPromise resolved first, leaking a timer.
      const tracker = new WorkspaceRebindTracker();
      tracker.recordMount('ws-A');
      tracker.recordRebind('ws-B');
      const gen = tracker.startRebind();

      // Spy on clearTimeout to verify it's called
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      // Resolve the rebind quickly
      setTimeout(() => tracker.endRebind(gen), 5);

      const result = await tracker.waitForRebind(5000);
      expect(result).toBe(true);

      // clearTimeout should have been called to clean up the racing timer
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});

