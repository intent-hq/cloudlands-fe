/**
 * Assertion Helpers for Type Guards
 *
 * Assertion functions that throw errors when type checks fail.
 * Useful for debugging and ensuring type safety at runtime.
 */

import type { AgentSession, AgentMessage, ContentBlock, ToolCall } from '../types';
import {
  isAgentSession,
  isAgentMessage,
  isContentBlock,
  isToolCall,
} from './guards';

/**
 * Assert that an object is an AgentSession
 * @throws Error if the object is not a valid AgentSession
 */
export function assertAgentSession(
  obj: unknown,
  message = 'Invalid agent session',
): asserts obj is AgentSession {
  if (!isAgentSession(obj)) {
    throw new Error(message);
  }
}

/**
 * Assert that an object is an AgentMessage
 * @throws Error if the object is not a valid AgentMessage
 */
export function assertAgentMessage(
  obj: unknown,
  message = 'Invalid agent message',
): asserts obj is AgentMessage {
  if (!isAgentMessage(obj)) {
    throw new Error(message);
  }
}

/**
 * Assert that an object is a ContentBlock
 * @throws Error if the object is not a valid ContentBlock
 */
export function assertContentBlock(
  obj: unknown,
  message = 'Invalid content block',
): asserts obj is ContentBlock {
  if (!isContentBlock(obj)) {
    throw new Error(message);
  }
}

/**
 * Assert that an object is a ToolCall
 * @throws Error if the object is not a valid ToolCall
 */
export function assertToolCall(
  obj: unknown,
  message = 'Invalid tool call',
): asserts obj is ToolCall {
  if (!isToolCall(obj)) {
    throw new Error(message);
  }
}

/**
 * Assert that a value is defined (not null or undefined)
 * @throws Error if the value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message = 'Value is null or undefined',
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

/**
 * Assert that a value is not null
 * @throws Error if the value is null
 */
export function assertNotNull<T>(value: T | null, message = 'Value is null'): asserts value is T {
  if (value === null) {
    throw new Error(message);
  }
}

/**
 * Assert that a string is not empty
 * @throws Error if the string is empty
 */
export function assertNonEmptyString(
  value: string,
  message = 'String is empty',
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }
}

/**
 * Assert that an array is not empty
 * @throws Error if the array is empty
 */
export function assertNonEmptyArray<T>(
  arr: T[],
  message = 'Array is empty',
): asserts arr is [T, ...T[]] {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(message);
  }
}

/**
 * Assert that a condition is true
 * @throws Error if the condition is false
 */
export function assertTrue(condition: boolean, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Assert that a condition is false
 * @throws Error if the condition is true
 */
export function assertFalse(
  condition: boolean,
  message = 'Assertion failed',
): asserts condition is false {
  if (condition) {
    throw new Error(message);
  }
}
