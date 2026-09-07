/**
 * Pure state-machine boundary for one Untitled workspace draft.
 *
 * Route and effect modules dispatch events here; this module never performs I/O.
 */
export { effectsFor } from './effects';
export { hasUnsavedInput, reduce, reduceDetailed } from './reducer';
export { CONTROLLER_EVENT_TYPES, CONTROLLER_PHASES, createInitialControllerState } from './types';
export type * from './types';
