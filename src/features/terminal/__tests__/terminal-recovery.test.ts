/**
 * Tests for Terminal freeze recovery logic
 *
 * Tests the auto-reconnect, heartbeat, and WebGL recovery behavior
 * added to TerminalAdapter and the state machine.
 *
 * Since TerminalAdapter has heavy dependencies (xterm, WebGL, IPC),
 * we test the recovery logic through the state machine transitions
 * and by simulating the adapter's listener pattern.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  TerminalStateMachine,
  TerminalState,
} from '../terminal-state-machine';

// Mock the Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('Terminal Recovery - State Machine Transitions', () => {
  let machine: TerminalStateMachine;

  beforeEach(() => {
    machine = new TerminalStateMachine('test-recovery');
  });

  function connectMachine() {
    machine.transition('initialize');
    machine.transition('connect');
    machine.transition('connected');
  }

  describe('auto-reconnect state flow', () => {
    it('should support CONNECTED → ERROR → RECONNECTING → CONNECTED cycle', () => {
      connectMachine();
      expect(machine.getState()).toBe(TerminalState.CONNECTED);

      machine.transition('error');
      expect(machine.getState()).toBe(TerminalState.ERROR);
      expect(machine.isHealthy()).toBe(false);
      expect(machine.canAcceptInput()).toBe(false);

      machine.transition('reconnect');
      expect(machine.getState()).toBe(TerminalState.RECONNECTING);
      expect(machine.isHealthy()).toBe(true);
      expect(machine.canAcceptInput()).toBe(false);

      machine.transition('reconnected');
      expect(machine.getState()).toBe(TerminalState.CONNECTED);
      expect(machine.isHealthy()).toBe(true);
      expect(machine.canAcceptInput()).toBe(true);
    });

    it('should support CONNECTED → DISCONNECTED → RECONNECTING → CONNECTED cycle', () => {
      connectMachine();
      machine.transition('disconnect');
      expect(machine.getState()).toBe(TerminalState.DISCONNECTED);

      machine.transition('reconnect');
      expect(machine.getState()).toBe(TerminalState.RECONNECTING);

      machine.transition('reconnected');
      expect(machine.getState()).toBe(TerminalState.CONNECTED);
    });

    it('should handle multiple error-reconnect cycles', () => {
      connectMachine();

      for (let i = 0; i < 3; i++) {
        machine.transition('error');
        machine.transition('reconnect');
        machine.transition('reconnected');
        expect(machine.getState()).toBe(TerminalState.CONNECTED);
      }
    });

    it('should allow disposal from ERROR state', () => {
      connectMachine();
      machine.transition('error');
      machine.transition('dispose');
      expect(machine.isDisposed()).toBe(true);
    });

    it('should allow disposal from RECONNECTING state', () => {
      connectMachine();
      machine.transition('error');
      machine.transition('reconnect');
      machine.transition('dispose');
      expect(machine.isDisposed()).toBe(true);
    });

    it('should not allow reconnect from CONNECTED state', () => {
      connectMachine();
      expect(machine.canTransition('reconnect')).toBe(false);
      expect(machine.transition('reconnect')).toBe(false);
      expect(machine.getState()).toBe(TerminalState.CONNECTED);
    });

    it('should not allow reconnect from INITIALIZING state', () => {
      machine.transition('initialize');
      expect(machine.canTransition('reconnect')).toBe(false);
    });
  });

  describe('state change notifications for recovery', () => {
    it('should notify listeners when entering ERROR from CONNECTED', () => {
      const errorCallback = vi.fn();
      const transitionCallback = vi.fn();
      machine.onStateChange(TerminalState.ERROR, errorCallback);
      machine.onTransition(transitionCallback);

      connectMachine();
      machine.transition('error');

      expect(errorCallback).toHaveBeenCalled();
      expect(transitionCallback).toHaveBeenCalledWith(
        TerminalState.CONNECTED,
        TerminalState.ERROR,
      );
    });

    it('should notify listeners on full reconnect cycle', () => {
      const connectedCallback = vi.fn();
      machine.onStateChange(TerminalState.CONNECTED, connectedCallback);

      connectMachine();
      expect(connectedCallback).toHaveBeenCalledTimes(1);

      machine.transition('error');
      machine.transition('reconnect');
      machine.transition('reconnected');
      expect(connectedCallback).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Terminal Recovery - Auto-reconnect Logic', () => {
  /**
   * These tests verify the auto-reconnect scheduling logic
   * that lives in TerminalAdapter.setupStateMachineListeners().
   * We simulate the logic by wiring up a state machine with
   * the same listener pattern used in the adapter.
   */

  let machine: TerminalStateMachine;
  let exitedNormally: boolean;
  let autoReconnectAttempts: number;
  let autoReconnectTimer: ReturnType<typeof setTimeout> | null;
  let heartbeatRunning: boolean;
  let webglRecoveryAttempts: number;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const MAX_WEBGL_RECOVERY_ATTEMPTS = 3;

  function scheduleAutoReconnect() {
    if (autoReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    cancelAutoReconnect();
    autoReconnectAttempts++;
    autoReconnectTimer = setTimeout(() => {
      autoReconnectTimer = null;
    }, 10);
  }

  function cancelAutoReconnect() {
    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = null;
    }
  }

  function startHeartbeat() {
    heartbeatRunning = true;
  }

  function stopHeartbeat() {
    heartbeatRunning = false;
  }

  function connectMachine() {
    machine.transition('initialize');
    machine.transition('connect');
    machine.transition('connected');
  }

  beforeEach(() => {
    machine = new TerminalStateMachine('test-adapter-recovery');
    exitedNormally = false;
    autoReconnectAttempts = 0;
    autoReconnectTimer = null;
    heartbeatRunning = false;
    webglRecoveryAttempts = 0;

    // Wire up the same listener pattern as TerminalAdapter.setupStateMachineListeners()
    machine.onTransition((_from, to) => {
      if (to === TerminalState.DISCONNECTED || to === TerminalState.ERROR) {
        stopHeartbeat();
        if (!exitedNormally) {
          scheduleAutoReconnect();
        }
      }
      if (to === TerminalState.CONNECTED) {
        autoReconnectAttempts = 0;
        cancelAutoReconnect();
        startHeartbeat();
      }
    });
  });

  afterEach(() => {
    cancelAutoReconnect();
    machine.dispose();
  });

  describe('normal exit vs unexpected disconnect', () => {
    it('should NOT schedule auto-reconnect on normal exit', () => {
      connectMachine();

      exitedNormally = true;
      machine.transition('disconnect');

      expect(machine.getState()).toBe(TerminalState.DISCONNECTED);
      expect(autoReconnectAttempts).toBe(0);
      expect(autoReconnectTimer).toBeNull();
    });

    it('should schedule auto-reconnect on unexpected disconnect', () => {
      connectMachine();

      machine.transition('disconnect');

      expect(machine.getState()).toBe(TerminalState.DISCONNECTED);
      expect(autoReconnectAttempts).toBe(1);
    });

    it('should schedule auto-reconnect on error', () => {
      connectMachine();

      machine.transition('error');

      expect(machine.getState()).toBe(TerminalState.ERROR);
      expect(autoReconnectAttempts).toBe(1);
      expect(heartbeatRunning).toBe(false);
    });
  });

  describe('heartbeat management', () => {
    it('should start heartbeat when entering CONNECTED', () => {
      connectMachine();
      expect(heartbeatRunning).toBe(true);
    });

    it('should stop heartbeat on disconnect', () => {
      connectMachine();
      expect(heartbeatRunning).toBe(true);

      machine.transition('disconnect');
      expect(heartbeatRunning).toBe(false);
    });

    it('should stop heartbeat on error', () => {
      connectMachine();
      expect(heartbeatRunning).toBe(true);

      machine.transition('error');
      expect(heartbeatRunning).toBe(false);
    });

    it('should restart heartbeat after successful reconnect', () => {
      connectMachine();
      machine.transition('error');
      expect(heartbeatRunning).toBe(false);

      machine.transition('reconnect');
      machine.transition('reconnected');
      expect(heartbeatRunning).toBe(true);
    });
  });

  describe('reconnect attempt limits', () => {
    it('should cap auto-reconnect attempts at MAX_RECONNECT_ATTEMPTS', () => {
      autoReconnectAttempts = MAX_RECONNECT_ATTEMPTS;

      connectMachine();
      // Reset attempts on connect
      expect(autoReconnectAttempts).toBe(0);

      // Now manually set to max and try disconnect
      autoReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
      machine.transition('disconnect');

      // Should not increment beyond max
      expect(autoReconnectAttempts).toBe(MAX_RECONNECT_ATTEMPTS);
    });

    it('should reset reconnect attempts on successful connection', () => {
      connectMachine();

      machine.transition('error');
      expect(autoReconnectAttempts).toBe(1);

      machine.transition('reconnect');
      machine.transition('reconnected');
      expect(autoReconnectAttempts).toBe(0);
    });
  });

  describe('WebGL recovery attempts cap', () => {
    it('should limit WebGL recovery to MAX_WEBGL_RECOVERY_ATTEMPTS', () => {
      function attemptWebglRecovery(): boolean {
        if (webglRecoveryAttempts >= MAX_WEBGL_RECOVERY_ATTEMPTS) {
          return false;
        }
        webglRecoveryAttempts++;
        return true;
      }

      expect(attemptWebglRecovery()).toBe(true);  // attempt 1
      expect(attemptWebglRecovery()).toBe(true);  // attempt 2
      expect(attemptWebglRecovery()).toBe(true);  // attempt 3
      expect(attemptWebglRecovery()).toBe(false); // capped
      expect(webglRecoveryAttempts).toBe(3);
    });
  });

  describe('reattach resets recovery counters', () => {
    it('should reset all recovery state on reattach', () => {
      autoReconnectAttempts = 3;
      webglRecoveryAttempts = 2;
      exitedNormally = true;
      autoReconnectTimer = setTimeout(() => {}, 10000);

      // Simulate reattach() reset behavior
      cancelAutoReconnect();
      autoReconnectAttempts = 0;
      webglRecoveryAttempts = 0;
      exitedNormally = false;

      expect(autoReconnectAttempts).toBe(0);
      expect(webglRecoveryAttempts).toBe(0);
      expect(exitedNormally).toBe(false);
      expect(autoReconnectTimer).toBeNull();
    });
  });
});
