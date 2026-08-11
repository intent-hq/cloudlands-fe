const PRIVATE_CHANNEL_PATTERN =
  /(auth|clipboard|content|exec|file|image|message|prompt|secret|terminal|token)/i;

function summarizeValue(value: unknown): Record<string, number | string> {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'object') {
    return { type: 'object', keyCount: Object.keys(value as object).length };
  }
  return { type: typeof value };
}

export function redactIpcDebugData(channel: string, data: unknown): unknown {
  if (data === undefined || data === null) return data;
  if (PRIVATE_CHANNEL_PATTERN.test(channel)) return `[redacted payload for ${channel}]`;
  return summarizeValue(data);
}
