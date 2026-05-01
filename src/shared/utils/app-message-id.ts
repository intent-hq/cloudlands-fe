import { v4 as uuidv4 } from 'uuid';

export const APP_MESSAGE_ID_PREFIX = 'app_msg_';

/**
 * Creates an app-owned logical message ID that is independent from provider/backend message IDs.
 */
export function createAppMessageId(): string {
  return `${APP_MESSAGE_ID_PREFIX}${uuidv4()}`;
}
