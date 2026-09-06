/**
 * Tests for the orphaned-sidecar kill-and-restart recovery (#2444): the
 * never-signal-external invariant (re-verification gating), active-agent
 * confirmation, SIGTERM→SIGKILL escalation, and spawn hand-off.
 */
import { describe, expect, it, vi } from 'vitest';

import type { OrphanedSidecarState } from './connection-mode';
import {
  restartOrphanedSidecar,
  type KillOutcome,
  type OrphanRecoveryDeps,
} from './orphan-recovery';
import type { RespondingAgent } from '../../../main/running-agents';

const ORPHAN: OrphanedSidecarState = {
  pid: 4242,
  executablePath: '/app/resources/intentd/intentd',
};
const AGENT: RespondingAgent = { agentId: 'a1', name: 'Agent One', workspaceId: 'ws1' };

/** Deps whose orphan is alive until killed; every step is spied. */
function makeDeps(overrides: Partial<OrphanRecoveryDeps> = {}) {
  let alive = true;
  const deps: OrphanRecoveryDeps = {
    getOrphanedSidecarInfo: vi.fn(() => ORPHAN),
    clearOrphanState: vi.fn(),
    detectOrphan: vi.fn(() => (alive ? ORPHAN : null)),
    listRespondingAgents: vi.fn(async () => [] as RespondingAgent[]),
    confirmInterrupt: vi.fn(async () => true),
    kill: vi.fn((_pid: number, signal: NodeJS.Signals | 0): KillOutcome => {
      if (!alive) return 'gone';
      if (signal === 'SIGTERM' || signal === 'SIGKILL') alive = false;
      return 'ok';
    }),
    spawnSidecar: vi.fn(async () => ({ ok: true, spawned: true, reason: 'sidecar spawned' })),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
  return deps;
}

describe('restartOrphanedSidecar', () => {
  it('kills the orphan and spawns the bundled sidecar', async () => {
    const deps = makeDeps();
    const result = await restartOrphanedSidecar(deps);
    expect(result).toEqual({ ok: true, spawned: true, reason: 'sidecar spawned' });
    expect(deps.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(deps.clearOrphanState).toHaveBeenCalled();
    expect(deps.spawnSidecar).toHaveBeenCalled();
    expect(deps.confirmInterrupt).not.toHaveBeenCalled();
  });

  it('refuses when no orphan was recorded', async () => {
    const deps = makeDeps({ getOrphanedSidecarInfo: vi.fn(() => null) });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(deps.kill).not.toHaveBeenCalled();
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
  });

  it('refuses when action-time re-verification fails (never signals)', async () => {
    const deps = makeDeps({ detectOrphan: vi.fn(() => null) });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('re-verification');
    expect(deps.kill).not.toHaveBeenCalled();
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
  });

  it('refuses when the re-verified pid differs (pid reuse guard)', async () => {
    const deps = makeDeps({
      detectOrphan: vi.fn(() => ({ pid: 9999, executablePath: ORPHAN.executablePath })),
    });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(deps.kill).not.toHaveBeenCalled();
  });

  it('asks for confirmation when agents are responding, proceeds on yes', async () => {
    const deps = makeDeps({ listRespondingAgents: vi.fn(async () => [AGENT]) });
    const result = await restartOrphanedSidecar(deps);
    expect(deps.confirmInterrupt).toHaveBeenCalledWith([AGENT]);
    expect(result.ok).toBe(true);
    expect(deps.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('cancels without signalling when the user declines', async () => {
    const deps = makeDeps({
      listRespondingAgents: vi.fn(async () => [AGENT]),
      confirmInterrupt: vi.fn(async () => false),
    });
    const result = await restartOrphanedSidecar(deps);
    expect(result).toMatchObject({ ok: false, spawned: false, cancelled: true });
    expect(deps.kill).not.toHaveBeenCalled();
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
  });

  it('escalates to SIGKILL when SIGTERM does not stop the orphan', async () => {
    let alive = true;
    const kill = vi.fn((_pid: number, signal: NodeJS.Signals | 0): KillOutcome => {
      if (!alive) return 'gone';
      if (signal === 'SIGKILL') alive = false;
      return 'ok'; // SIGTERM sent but ignored; signal-0 keeps reporting alive
    });
    const deps = makeDeps({ kill });
    const result = await restartOrphanedSidecar(deps);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGKILL');
    expect(result.ok).toBe(true);
    expect(deps.spawnSidecar).toHaveBeenCalled();
  });

  it('fails without spawning when the orphan never exits', async () => {
    const kill = vi.fn((): KillOutcome => 'ok'); // every signal "sent", process never dies
    const deps = makeDeps({ kill });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not exit');
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
    expect(deps.clearOrphanState).not.toHaveBeenCalled();
  });

  it('proceeds to spawn when the orphan is already gone at kill time', async () => {
    const kill = vi.fn((): KillOutcome => 'gone'); // ESRCH on every signal
    const deps = makeDeps({ kill, detectOrphan: vi.fn(() => ORPHAN) });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(true);
    expect(deps.spawnSidecar).toHaveBeenCalled();
  });

  it('aborts on a non-ESRCH kill failure instead of treating it as exited', async () => {
    // EPERM (or any non-ESRCH error) on SIGTERM: the process may still be
    // alive — never proceed to clear state and spawn a second daemon.
    const kill = vi.fn((): KillOutcome => 'error');
    const deps = makeDeps({ kill });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
    expect(deps.clearOrphanState).not.toHaveBeenCalled();
  });

  it('does not read a signal-0 probe error as exited while waiting', async () => {
    // SIGTERM is delivered, but the liveness probe then errors (e.g. EPERM
    // after a privilege change): waitForExit must not report "exited".
    const kill = vi.fn((_pid: number, signal: NodeJS.Signals | 0): KillOutcome => {
      return signal === 0 ? 'error' : 'ok';
    });
    const deps = makeDeps({ kill });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('did not exit');
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
  });

  it('refuses SIGTERM when the pid was recycled during the confirmation dialog', async () => {
    // detectOrphan verifies at click time, then fails at signal time while the
    // pid is still alive — a recycled pid must never be signalled.
    const detectOrphan = vi
      .fn<() => OrphanedSidecarState | null>()
      .mockReturnValueOnce(ORPHAN)
      .mockReturnValue(null);
    const kill = vi.fn((): KillOutcome => 'ok'); // pid alive (signal-0 succeeds)
    const deps = makeDeps({
      detectOrphan,
      kill,
      listRespondingAgents: vi.fn(async () => [AGENT]),
    });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('re-verification');
    expect(kill).not.toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(4242, 'SIGKILL');
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
  });

  it('refuses SIGKILL when the pid no longer verifies at escalation time', async () => {
    // SIGTERM is verified and sent but ignored; by SIGKILL time the pidfile
    // identity no longer matches while the pid is alive → refuse escalation.
    const detectOrphan = vi
      .fn<() => OrphanedSidecarState | null>()
      .mockReturnValueOnce(ORPHAN) // click-time re-verification
      .mockReturnValueOnce(ORPHAN) // SIGTERM identity check
      .mockReturnValue(null); // SIGKILL identity check fails
    const kill = vi.fn((): KillOutcome => 'ok'); // alive throughout; SIGTERM ignored
    const deps = makeDeps({ detectOrphan, kill });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('re-verification');
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(4242, 'SIGKILL');
    expect(deps.spawnSidecar).not.toHaveBeenCalled();
  });

  it('treats identity-check failure on an already-dead pid as gone and spawns', async () => {
    // The orphan exited between confirmation and signalling: detectOrphan
    // fails but signal-0 shows the pid gone → nothing to stop, proceed.
    const detectOrphan = vi
      .fn<() => OrphanedSidecarState | null>()
      .mockReturnValueOnce(ORPHAN)
      .mockReturnValue(null);
    const kill = vi.fn((): KillOutcome => 'gone'); // ESRCH: process gone
    const deps = makeDeps({ detectOrphan, kill });
    const result = await restartOrphanedSidecar(deps);
    expect(result.ok).toBe(true);
    expect(deps.spawnSidecar).toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalledWith(4242, 'SIGTERM');
  });
});
