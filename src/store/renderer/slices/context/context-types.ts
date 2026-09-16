/**
 * Context slice types.
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ContextItem } from '$features/context/types';
import type { ContentBlock } from '$shared/types';

/** Presentation of an existing draft or user-message image; never stored separately. */
export interface ContextImage {
  id: string;
  name?: string;
  block: ContentBlock;
  agentId?: string;
  messageId?: string;
  hydrationStatus?: 'loading' | 'loaded' | 'error';
}

export type ContextWorkspaceState = {
  items: Collection<ContextItem, 'id'>;
  loading: boolean;
  error: string | null;
};

export type ContextState = {
  byWorkspaceId: Record<string, ContextWorkspaceState>;
};
