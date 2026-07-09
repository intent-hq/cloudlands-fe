/**
 * IPC Channel Validation
 *
 * Provides runtime validation and type guards for IPC channels.
 * Ensures type safety across the IPC boundary.
 */

import {
  getAllowedChannels,
  isDynamicChannel as isRegistryDynamic,
  DYNAMIC_CHANNEL_PATTERNS,
} from '../ipc-registry';
import type { ChannelName } from './channels';

/**
 * Check if a channel is valid (either static or dynamic)
 */
export function isValidChannel(channel: string): channel is ChannelName {
  const allowed = getAllowedChannels();

  // Check static channels
  if (allowed.includes(channel)) {
    return true;
  }

  // Check dynamic patterns
  return DYNAMIC_CHANNEL_PATTERNS.some((pattern) => channel.startsWith(pattern));
}

/**
 * Assert that a channel is valid
 * Throws an error if the channel is not valid
 */
export function assertValidChannel(channel: string): asserts channel is ChannelName {
  if (!isValidChannel(channel)) {
    throw new Error(`Invalid IPC channel: "${channel}". Channel is not in the whitelist.`);
  }
}

/**
 * Check if a channel is dynamic (contains runtime IDs)
 */
export function isDynamicChannel(channel: string): boolean {
  return isRegistryDynamic(channel);
}

/**
 * Get the base pattern for a dynamic channel
 * e.g., "agent:stream:123" -> "agent:stream:"
 */
export function getDynamicChannelPattern(channel: string): string | null {
  for (const pattern of DYNAMIC_CHANNEL_PATTERNS) {
    if (channel.startsWith(pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Validate a channel name and return it if valid
 * Returns null if invalid
 */
export function validateChannel(channel: string): ChannelName | null {
  return isValidChannel(channel) ? (channel as ChannelName) : null;
}

/**
 * Get all allowed channels
 */
export function getAllowedChannelsList(): string[] {
  return getAllowedChannels();
}

/**
 * Check if a channel requires authentication
 */
export function requiresAuth(channel: string): boolean {
  // Channels that require authentication
  const authRequired = [
    'agent:create',
    'agent:send-message',
    'workspace:create',
    'workspace:delete',
    'file:write',
    'file:delete',
  ];

  return authRequired.includes(channel);
}

/**
 * Get rate limit for a channel (requests per second)
 * Returns null if no rate limit
 */
export function getRateLimit(channel: string): number | null {
  const limits: Record<string, number> = {
    'agent:send-message': 10,
    'agent:stream': 5,
    'file:read-batch': 20,
  };

  return limits[channel] ?? null;
}
