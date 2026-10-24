import type { DiscussionError } from '$shared/types/workspace-discussion';

export interface DiscussionManagement {
  pending: 'rename' | 'delete' | null;
  conversationId: string | null;
  requestId: string | null;
  error: DiscussionError | null;
}
