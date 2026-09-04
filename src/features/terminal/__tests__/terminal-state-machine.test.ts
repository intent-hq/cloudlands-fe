/**
 * Tests for Terminal State Machine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalStateMachine, TerminalState } from '../terminal-state-machine';

// Mock the Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('TerminalStateMachine', () => {
  let machine: TerminalStateMachine;

  beforeEach(() => {
    machine = new TerminalStateMachine('test-terminal');
  });

  describe('initial state', () => {
    it('should start in UNINITIALIZED state', () => {
      expect(machine.getState()).toBe(TerminalState.UNINITIALIZED);
    });

    it('should not be healthy initially', () => {
      expect(machine.isHealthy()).toBe(false);
    });

    it('should not accept input initially', () => {
      expect(machine.canAcceptInput()).toBe(false);
    });

    it('should not be disposed initially', () => {
      expect(machine.isDisposed()).toBe(false);
    });
  });

  describe('state transitions', () => {
    it('should transition from UNINITIALIZED to INITIALIZING', () => {
      expect(machine.canTransition('initialize')).toBe(true);
      expect(machine.transition('initialize')).toBe(true);
      expect(machine.getState()).toBe(TerminalState.INITIALIZING);
    });

    it('should transition through full initialization flow', () => {
      machine.transition('initialize');
      expect(machine.getState()).toBe(TerminalState.INITIALIZING);

      machine.transition('connect');
      expect(machine.getState()).toBe(TerminalState.CONNECTING);

      machine.transition('connected');
      expect(machine.getState()).toBe(TerminalState.CONNECTED);
    });

    it('should be healthy when connected', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      expect(machine.isHealthy()).toBe(true);
      expect(machine.canAcceptInput()).toBe(true);
    });

    it('should reject invalid transitions', () => {
      expect(machine.canTransition('connected')).toBe(false);
      expect(machine.transition('connected')).toBe(false);
      expect(machine.getState()).toBe(TerminalState.UNINITIALIZED);
    });

    it('should handle disconnection', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('disconnect');
      expect(machine.getState()).toBe(TerminalState.DISCONNECTED);
    });

    it('should handle reconnection', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('disconnect');
      machine.transition('reconnect');
      expect(machine.getState()).toBe(TerminalState.RECONNECTING);
      machine.transition('reconnected');
      expect(machine.getState()).toBe(TerminalState.CONNECTED);
    });
  });

  describe('error handling', () => {
    it('should transition to ERROR state on error', () => {
      machine.transition('initialize');
      machine.transition('error');
      expect(machine.getState()).toBe(TerminalState.ERROR);
    });

    it('should transition from CONNECTED to ERROR (for heartbeat failures)', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      expect(machine.getState()).toBe(TerminalState.CONNECTED);

      machine.transition('error');
      expect(machine.getState()).toBe(TerminalState.ERROR);
    });

    it('should allow reconnection from ERROR state', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('error');

      machine.transition('reconnect');
      expect(machine.getState()).toBe(TerminalState.RECONNECTING);

      machine.transition('reconnected');
      expect(machine.getState()).toBe(TerminalState.CONNECTED);
    });

    it('should transition from RECONNECTING to ERROR', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('disconnect');
      machine.transition('reconnect');
      expect(machine.getState()).toBe(TerminalState.RECONNECTING);

      machine.transition('error');
      expect(machine.getState()).toBe(TerminalState.ERROR);
    });

    it('should not be healthy in ERROR state', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      expect(machine.isHealthy()).toBe(true);

      machine.transition('error');
      expect(machine.isHealthy()).toBe(false);
      expect(machine.canAcceptInput()).toBe(false);
    });

    it('should call error handlers', () => {
      const errorHandler = vi.fn();
      machine.onError(errorHandler);
      machine.transition('initialize');
      machine.reportError(new Error('Test error'));
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('disposal', () => {
    it('should transition to DISPOSED from any state', () => {
      machine.transition('dispose');
      expect(machine.getState()).toBe(TerminalState.DISPOSED);
      expect(machine.isDisposed()).toBe(true);
    });

    it('should clear listeners on dispose', () => {
      const callback = vi.fn();
      machine.onStateChange(TerminalState.CONNECTED, callback);
      machine.dispose();
      expect(machine.isDisposed()).toBe(true);
    });
  });

  describe('listeners', () => {
    it('should notify state listeners', () => {
      const callback = vi.fn();
      machine.onStateChange(TerminalState.INITIALIZING, callback);
      machine.transition('initialize');
      expect(callback).toHaveBeenCalled();
    });

    it('should notify transition listeners', () => {
      const callback = vi.fn();
      machine.onTransition(callback);
      machine.transition('initialize');
      expect(callback).toHaveBeenCalledWith(
        TerminalState.UNINITIALIZED,
        TerminalState.INITIALIZING,
      );
    });

    it('should allow unsubscribing', () => {
      const callback = vi.fn();
      const unsubscribe = machine.onStateChange(TerminalState.INITIALIZING, callback);
      unsubscribe();
      machine.transition('initialize');
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
