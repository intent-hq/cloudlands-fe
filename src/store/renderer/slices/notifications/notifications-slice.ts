import { createAsyncAction } from '@themislib/themis/utils/store/create-action';
import type { DiscussionTarget } from '../workspace-discussion/workspace-discussion-slice';

/** Wait for the destination's mounted layout before the notification click opens its discussion. */
export const discussionNotificationLayoutRequested = createAsyncAction<
  [target: DiscussionTarget, messageId: string],
  boolean
>('notifications/discussionLayout', 'notifications/discussionLayoutRequested');
