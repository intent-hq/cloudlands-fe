/**
 * Auto-Update IPC Request Validation
 *
 * Zod schemas for validating auto-update IPC requests.
 */

import { z } from 'zod';

/**
 * Schema for SET_CHANNEL request
 */
export const SetChannelRequestSchema = z.object({
  channel: z.enum(['stable', 'beta', 'alpha']),
});

export type SetChannelRequest = z.infer<typeof SetChannelRequestSchema>;
