/**
 * Context slice types.
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ContextItem } from '$features/context/types';
import type { ContentBlock } from '$shared/types';
import type { HydratedBlockEntry } from '../chat-state/chat-state-types';

/** Presentation of an existing draft or user-message attachment; never stored separately. */
export interface ContextAttachment {
  id: string;
  name?: string;
  block: ContentBlock;
  agentId?: string;
  messageId?: string;
  placementStatus?: 'placing' | 'failed' | 'placed';
  hydration?: HydratedBlockEntry;
}

export type ContextWorkspaceState = {
  items: Collection<ContextItem, 'id'>;
  loading: boolean;
  error: string | null;
};

export type ContextState = {
  byWorkspaceId: Record<string, ContextWorkspaceState>;
};
