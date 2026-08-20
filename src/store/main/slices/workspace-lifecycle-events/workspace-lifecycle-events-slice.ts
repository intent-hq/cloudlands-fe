/**
 * Workspace Lifecycle Events Slice
 *
 * Saga-only slice (no reducer) for workspace lifecycle domain events.
 * Actions: workspace:created/updated/deleting/deleted/archived/file-changes
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import type { DomainEventPayloads } from '../../../../features/events/types';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const workspaceCreated = createAction<[data: DomainEventPayloads['workspace:created']]>(
  'domainEvents/workspaceCreated',
);

export const workspaceUpdated = createAction<[data: DomainEventPayloads['workspace:updated']]>(
  'domainEvents/workspaceUpdated',
);

export const workspaceDeleting = createAction<[data: DomainEventPayloads['workspace:deleting']]>(
  'domainEvents/workspaceDeleting',
);

export const workspaceDeleted = createAction<[data: DomainEventPayloads['workspace:deleted']]>(
  'domainEvents/workspaceDeleted',
);

export const workspaceArchived = createAction<[data: DomainEventPayloads['workspace:archived']]>(
  'domainEvents/workspaceArchived',
);
