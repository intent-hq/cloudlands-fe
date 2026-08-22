/**
 * Terminal Events Slice
 *
 * Saga-only slice (no reducer) for terminal domain events.
 * Actions: terminal:*, terminal:professional:*
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import type { DomainEventPayloads } from '../../../../features/events/types';

// ---------------------------------------------------------------------------
// Terminal actions
// ---------------------------------------------------------------------------

export const terminalCreated = createAction<[data: DomainEventPayloads['terminal:created']]>(
  'domainEvents/terminalCreated',
);

export const terminalDisposed = createAction<[data: DomainEventPayloads['terminal:disposed']]>(
  'domainEvents/terminalDisposed',
);

// ---------------------------------------------------------------------------
// Professional terminal actions
// ---------------------------------------------------------------------------

export const terminalProfessionalData = createAction<
  [data: DomainEventPayloads['terminal:professional:data']]
>('domainEvents/terminalProfessionalData');

export const terminalProfessionalExit = createAction<
  [data: DomainEventPayloads['terminal:professional:exit']]
>('domainEvents/terminalProfessionalExit');
