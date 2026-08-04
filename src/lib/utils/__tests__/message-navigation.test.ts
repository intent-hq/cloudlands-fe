import { describe, it, expect } from 'vitest';
import { resolvePreviousUserMessageId } from '../message-navigation';

const messages = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'a2', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'a3', role: 'assistant' },
  { id: 'u3', role: 'user' },
];

describe('resolvePreviousUserMessageId', () => {
  it('returns the previous user message id, skipping assistant messages', () => {
    expect(resolvePreviousUserMessageId(messages, 'u3')).toBe('u2');
    expect(resolvePreviousUserMessageId(messages, 'u2')).toBe('u1');
  });

  it('returns null for the first user message', () => {
    expect(resolvePreviousUserMessageId(messages, 'u1')).toBeNull();
  });

  it('returns null for an unknown message id', () => {
    expect(resolvePreviousUserMessageId(messages, 'missing')).toBeNull();
  });

  it('returns null for an assistant message id (not a user message)', () => {
    expect(resolvePreviousUserMessageId(messages, 'a2')).toBeNull();
  });

  it('returns null for an empty message list', () => {
    expect(resolvePreviousUserMessageId([], 'u1')).toBeNull();
  });
});
