// ============================================================================
// Model Defaults
// ============================================================================

export const MODEL_IDS = {
  // Claude models
  CLAUDE_OPUS_4_7: 'opus4.7' as const,
  CLAUDE_OPUS_4_6: 'opus4.6' as const,
  CLAUDE_OPUS_4_5: 'opus4.5' as const,
  CLAUDE_SONNET_4_5: 'sonnet4.5' as const,
  CLAUDE_SONNET_4: 'sonnet4' as const,
  CLAUDE_OPUS_4_1: 'opus4.1' as const,
  CLAUDE_HAIKU_4_5: 'haiku4.5' as const,
  CLAUDE_OPUS_4_1_200K: 'claude-opus-4-1-200k-v8-c4-p2-agent' as const,
  CLAUDE_3_OPUS: 'claude-3-opus' as const,
  CLAUDE_3_SONNET: 'claude-3-sonnet' as const,
  CLAUDE_3_HAIKU: 'claude-3-haiku' as const,

  // GPT models
  GPT_4: 'gpt-4' as const,
  GPT_4_TURBO: 'gpt-4-turbo' as const,
  GPT_4O: 'gpt-4o' as const,
  GPT_4O_MINI: 'gpt-4o-mini' as const,
  GPT_3_5_TURBO: 'gpt-3.5-turbo' as const,
  GPT_5_4: 'gpt5.4' as const,
  GPT_5_CODEX: 'gpt5-codex' as const,

  // Gemini models
  GEMINI_25_PRO: 'gemini25-pro' as const,
  GEMINI_3_EAP: 'gemini3-eap' as const,

  // Other models
  GLM_4_6: 'glm4.6' as const,
  O1_PREVIEW: 'o1-preview' as const,
  O1_MINI: 'o1-mini' as const,
} as const;

/** Type for the built-in model IDs defined in this file */
type KnownModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a value is a known model ID (from MODEL_IDS) */
export function isValidModelId(value: string): boolean {
  return Object.values(MODEL_IDS).includes(value as KnownModelId);
}

// Export as default for convenience
