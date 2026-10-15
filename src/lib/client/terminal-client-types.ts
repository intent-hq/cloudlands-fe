import type { MutationResult, TerminalsClient, Unsubscribe } from './app-client';
export interface TerminalMutationResult extends MutationResult {
  terminalOutcome?: 'unknown';
}
export type TerminalSubscription = Unsubscribe & { ready?: Promise<void> };
export interface InteractiveTerminalsClient extends TerminalsClient {
  create(...args: Parameters<TerminalsClient['create']>): Promise<TerminalMutationResult>;
  kill(...args: Parameters<TerminalsClient['kill']>): Promise<TerminalMutationResult>;
  subscribeEvents(...args: Parameters<TerminalsClient['subscribeEvents']>): TerminalSubscription;
}
