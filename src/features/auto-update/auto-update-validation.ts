/**
 * Auto-Update IPC Request Validation
 *
 * Zod schemas for validating auto-update IPC requests.
 */

import { z } from 'zod';
import { UPDATE_CHANNELS } from './types';

/**
 * Schema for SET_CHANNEL request
 */
export const SetChannelRequestSchema = z.object({
  channel: z.enum(UPDATE_CHANNELS),
});
