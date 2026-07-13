import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  sanitizeAgentName,
  generateAgentNameFromTask,
  isValidAgentName,
} from '../agent-name-utils';

describe('sanitizeAgentName', () => {
  it('should keep valid names unchanged', () => {
    expect(sanitizeAgentName('My Agent')).toBe('My Agent');
    expect(sanitizeAgentName('task-agent-1')).toBe('task-agent-1');
    expect(sanitizeAgentName('Agent_123')).toBe('Agent_123');
  });

  it('should replace invalid characters with hyphens', () => {
    expect(sanitizeAgentName('Agent@123')).toBe('Agent-123');
    expect(sanitizeAgentName('My/Agent')).toBe('My-Agent');
    expect(sanitizeAgentName('Agent!Name')).toBe('Agent-Name');
  });

  it('should collapse multiple hyphens', () => {
    expect(sanitizeAgentName('Agent---Name')).toBe('Agent-Name');
    expect(sanitizeAgentName('My--Task--Agent')).toBe('My-Task-Agent');
  });

  it('should trim and remove leading/trailing hyphens', () => {
    expect(sanitizeAgentName('  Agent  ')).toBe('Agent');
    expect(sanitizeAgentName('-Agent-')).toBe('Agent');
    expect(sanitizeAgentName('---Agent---')).toBe('Agent');
  });

  it('should enforce length limit', () => {
    const longName = 'A'.repeat(150);
    const sanitized = sanitizeAgentName(longName);
    expect(sanitized.length).toBeLessThanOrEqual(100);
  });

  it('should return a random name for empty or invalid input', () => {
    // Returns random names instead of fixed 'Agent', so just check it returns non-empty string
    const emptyResult = sanitizeAgentName('');
    expect(emptyResult).toBeTruthy();
    expect(typeof emptyResult).toBe('string');
    expect(emptyResult.length).toBeGreaterThan(0);

    const whitespaceResult = sanitizeAgentName('   ');
    expect(whitespaceResult).toBeTruthy();
    expect(typeof whitespaceResult).toBe('string');

    const dashesResult = sanitizeAgentName('---');
    expect(dashesResult).toBeTruthy();
    expect(typeof dashesResult).toBe('string');

    // @ts-expect-error - testing invalid input
    const nullResult = sanitizeAgentName(null);
    expect(nullResult).toBeTruthy();
    expect(typeof nullResult).toBe('string');

    // @ts-expect-error - testing invalid input
    const undefinedResult = sanitizeAgentName(undefined);
    expect(undefinedResult).toBeTruthy();
    expect(typeof undefinedResult).toBe('string');
  });

  it('should handle special characters', () => {
    // Special characters are replaced with hyphens, trailing hyphens are trimmed
    expect(sanitizeAgentName('Agent™')).toBe('Agent');
    expect(sanitizeAgentName('Agent©2024')).toBe('Agent-2024');
    // Parentheses become hyphens, space is preserved: "Agent (v2)" -> "Agent -v2-" -> "Agent -v2"
    expect(sanitizeAgentName('Agent (v2)')).toBe('Agent -v2');
  });
});

describe('generateAgentNameFromTask', () => {
  it('should generate name from task title', () => {
    // No longer adds 'Agent' suffix - just truncates and sanitizes
    expect(generateAgentNameFromTask('Implement feature X')).toBe('Implement feature X');
    expect(generateAgentNameFromTask('Fix bug in auth')).toBe('Fix bug in auth');
  });

  it('should preserve names with "Agent" in them', () => {
    expect(generateAgentNameFromTask('My Agent')).toBe('My Agent');
    expect(generateAgentNameFromTask('Task Agent')).toBe('Task Agent');
    expect(generateAgentNameFromTask('AGENT Task')).toBe('AGENT Task');
  });

  it('should truncate long titles', () => {
    const longTitle =
      'This is a very long task title that exceeds the reasonable length for an agent name';
    const result = generateAgentNameFromTask(longTitle);
    // Truncates to first 50 chars, then sanitizes
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toBe('This is a very long task title that exceeds the re');
  });

  it('should sanitize invalid characters', () => {
    // No longer adds 'Agent' suffix
    expect(generateAgentNameFromTask('Fix bug #123')).toBe('Fix bug -123');
    expect(generateAgentNameFromTask('Update @mentions')).toBe('Update -mentions');
  });

  it('should return random name for empty input', () => {
    // Returns random names for empty/invalid input
    const emptyResult = generateAgentNameFromTask('');
    expect(emptyResult).toBeTruthy();
    expect(typeof emptyResult).toBe('string');
    expect(emptyResult.length).toBeGreaterThan(0);

    const whitespaceResult = generateAgentNameFromTask('   ');
    expect(whitespaceResult).toBeTruthy();
    expect(typeof whitespaceResult).toBe('string');

    // @ts-expect-error - testing invalid input
    const nullResult = generateAgentNameFromTask(null);
    expect(nullResult).toBeTruthy();
    expect(typeof nullResult).toBe('string');
  });
});

describe('isValidAgentName', () => {
  it('should validate correct names', () => {
    expect(isValidAgentName('My Agent')).toBe(true);
    expect(isValidAgentName('task-agent-1')).toBe(true);
    expect(isValidAgentName('Agent_123')).toBe(true);
  });

  it('should accept names with special characters', () => {
    // The pattern now accepts any non-empty string
    expect(isValidAgentName('Agent@123')).toBe(true);
    expect(isValidAgentName('My/Agent')).toBe(true);
    expect(isValidAgentName('Agent!Name')).toBe(true);
  });

  it('should reject empty names', () => {
    expect(isValidAgentName('')).toBe(false);
    expect(isValidAgentName('   ')).toBe(false);
    // @ts-expect-error - testing invalid input
    expect(isValidAgentName(null)).toBe(false);
    // @ts-expect-error - testing invalid input
    expect(isValidAgentName(undefined)).toBe(false);
  });

  it('should reject names exceeding length limit', () => {
    const longName = 'A'.repeat(150);
    expect(isValidAgentName(longName)).toBe(false);
  });

  it('should accept names at length limit', () => {
    const maxLengthName = 'A'.repeat(100);
    expect(isValidAgentName(maxLengthName)).toBe(true);
  });
});
