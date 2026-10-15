import type { MutationResult } from './client-types';

export type FileWriteOptions = {
  /** Host transport must invoke this synchronously at its final dispatch boundary. */
  onDispatch: () => void;
};

export type FileWriteResult = MutationResult & {
  /** Absent for legacy writes; an unconfirmed explicit write must not be retried silently. */
  outcome?: 'failed' | 'uncertain';
};
