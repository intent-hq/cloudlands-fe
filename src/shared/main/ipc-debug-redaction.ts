const PRIVATE_CHANNEL_PATTERN =
  /(auth|clipboard|content|exec|file|image|message|prompt|secret|terminal|token)/i;
const PRIVATE_KEY_PATTERN =
  /^(authorization|body|content|cookie|data|image|message|password|path|prompt|secret|text|token|url)$/i;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[redacted: maximum depth]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      PRIVATE_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(nested, depth + 1),
    ]),
  );
}

export function redactIpcDebugData(channel: string, data: unknown): unknown {
  if (data === undefined || data === null) return data;
  if (PRIVATE_CHANNEL_PATTERN.test(channel)) return `[redacted payload for ${channel}]`;
  return redactValue(data, 0);
}
