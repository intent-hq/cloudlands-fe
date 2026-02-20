/**
 * Terminal State Machine
 *
 * Manages terminal lifecycle states and transitions
 * Ensures proper initialization, connection, and cleanup
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('TerminalStateMachine');

export enum TerminalState {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  DISPOSED = 'disposed',
}

export interface StateTransition {
  from: TerminalState[];
  to: TerminalState;
  action: string;
  guard?: () => boolean;
}

export class TerminalStateMachine {
  private currentState: TerminalState = TerminalState.UNINITIALIZED;
  private stateListeners = new Map<TerminalState, Set<() => void>>();
  private transitionListeners = new Set<(from: TerminalState, to: TerminalState) => void>();
  private errorHandlers = new Set<(error: Error) => void>();

  private readonly transitions: StateTransition[] = [
    // Initialization flow
    {
      from: [TerminalState.UNINITIALIZED],
      to: TerminalState.INITIALIZING,
      action: 'initialize',
    },
    {
      from: [TerminalState.INITIALIZING],
      to: TerminalState.CONNECTING,
      action: 'connect',
    },
    {
      from: [TerminalState.CONNECTING],
      to: TerminalState.CONNECTED,
      action: 'connected',
    },

    // Reconnection flow
    {
      from: [TerminalState.DISCONNECTED, TerminalState.ERROR],
      to: TerminalState.RECONNECTING,
      action: 'reconnect',
    },
    {
      from: [TerminalState.RECONNECTING],
      to: TerminalState.CONNECTED,
      action: 'reconnected',
    },

    // Disconnection flow
    {
      from: [TerminalState.CONNECTED, TerminalState.CONNECTING],
      to: TerminalState.DISCONNECTED,
      action: 'disconnect',
    },

    // Error handling
    {
      from: [TerminalState.INITIALIZING, TerminalState.CONNECTING, TerminalState.RECONNECTING],
      to: TerminalState.ERROR,
      action: 'error',
    },

    // Disposal
    {
      from: [
        TerminalState.UNINITIALIZED,
        TerminalState.INITIALIZING,
        TerminalState.CONNECTING,
        TerminalState.CONNECTED,
        TerminalState.RECONNECTING,
        TerminalState.DISCONNECTED,
        TerminalState.ERROR,
      ],
      to: TerminalState.DISPOSED,
      action: 'dispose',
    },
  ];

  constructor(private terminalId: string) {}

  /**
   * Get current state
   */
  getState(): TerminalState {
    return this.currentState;
  }

  /**
   * Check if transition is valid
   */
  canTransition(action: string): boolean {
    const transition = this.transitions.find(
      (t) => t.action === action && t.from.includes(this.currentState),
    );

    if (!transition) return false;
    if (transition.guard && !transition.guard()) return false;

    return true;
  }

  /**
   * Perform state transition
   */
  transition(action: string): boolean {
    const transition = this.transitions.find(
      (t) => t.action === action && t.from.includes(this.currentState),
    );

    if (!transition) {
      logger.warn(`Invalid transition: ${action} from ${this.currentState}`);
      return false;
    }

    if (transition.guard && !transition.guard()) {
      logger.warn(`Guard failed for transition: ${action}`);
      return false;
    }

    const fromState = this.currentState;
    this.currentState = transition.to;

    logger.info(`Terminal ${this.terminalId}: ${fromState} -> ${this.currentState} (${action})`);

    // Notify listeners
    this.notifyStateListeners(this.currentState);
    this.notifyTransitionListeners(fromState, this.currentState);

    return true;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(state: TerminalState, callback: () => void): () => void {
    if (!this.stateListeners.has(state)) {
      this.stateListeners.set(state, new Set());
    }

    this.stateListeners.get(state)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.stateListeners.get(state)?.delete(callback);
    };
  }

  /**
   * Subscribe to any transition
   */
  onTransition(callback: (from: TerminalState, to: TerminalState) => void): () => void {
    this.transitionListeners.add(callback);
    return () => {
      this.transitionListeners.delete(callback);
    };
  }

  /**
   * Subscribe to errors
   */
  onError(callback: (error: Error) => void): () => void {
    this.errorHandlers.add(callback);
    return () => {
      this.errorHandlers.delete(callback);
    };
  }

  /**
   * Report an error
   */
  reportError(error: Error): void {
    logger.error(`Terminal ${this.terminalId} error:`, error);

    // Call each error handler in a try-catch to prevent one from breaking others
    this.errorHandlers.forEach((handler) => {
      try {
        handler(error);
      } catch (handlerError) {
        logger.error('Error handler threw exception:', handlerError as Error);
      }
    });

    // Transition to error state if not already disposed
    if (this.currentState !== TerminalState.DISPOSED) {
      this.transition('error');
    }
  }

  /**
   * Check if terminal is in a healthy state
   */
  isHealthy(): boolean {
    return [TerminalState.CONNECTED, TerminalState.CONNECTING, TerminalState.RECONNECTING].includes(
      this.currentState,
    );
  }

  /**
   * Check if terminal can accept input
   */
  canAcceptInput(): boolean {
    return this.currentState === TerminalState.CONNECTED;
  }

  /**
   * Check if terminal is disposed
   */
  isDisposed(): boolean {
    return this.currentState === TerminalState.DISPOSED;
  }

  private notifyStateListeners(state: TerminalState): void {
    this.stateListeners.get(state)?.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        logger.error('Error in state listener:', error);
      }
    });
  }

  private notifyTransitionListeners(from: TerminalState, to: TerminalState): void {
    this.transitionListeners.forEach((callback) => {
      try {
        callback(from, to);
      } catch (error) {
        logger.error('Error in transition listener:', error);
      }
    });
  }

  /**
   * Dispose of the state machine
   */
  dispose(): void {
    // Only transition if not already disposed
    if (!this.isDisposed()) {
      this.transition('dispose');
    }
    this.stateListeners.clear();
    this.transitionListeners.clear();
    this.errorHandlers.clear();
  }
}
