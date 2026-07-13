/**
 * Static list of OpenAI Codex models with reasoning effort variants.
 *
 * The Codex CLI/MCP server does not expose a model listing endpoint,
 * so we maintain this list manually. Update when new models are released.
 *
 * Models that support reasoning effort (gpt-5.3-codex, gpt-5.2-codex,
 * gpt-5.1-codex-max) are expanded into low/medium/high/xhigh reasoning
 * effort variants using the "{model}/{effort}" ID format expected by
 * codex-acp. All other models appear as bare entries.
 */

/** Supported reasoning effort levels */
export const supportedReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const;

export type CodexReasoningEffort = (typeof supportedReasoningEfforts)[number];

/** Reasoning effort metadata for UI display */
export const CODEX_REASONING_EFFORTS: Record<
  CodexReasoningEffort,
  { label: string; description: string }
> = {
  low: {
    label: 'Low reasoning',
    description: 'Faster responses with less deliberation',
  },
  medium: {
    label: 'Medium reasoning',
    description: 'Balanced speed and reasoning depth',
  },
  high: {
    label: 'High reasoning',
    description: 'Deeper reasoning for complex problems',
  },
  xhigh: {
    label: 'Extra-high reasoning',
    description: 'Maximum reasoning depth for the hardest problems',
  },
};

/** Base Codex models before effort expansion */
const CODEX_BASE_MODELS = {
  'gpt-5.3-codex': {
    label: 'GPT-5.3 Codex',
    description: "OpenAI's flagship coding model",
  },
  'gpt-5.3-codex-spark': {
    label: 'GPT-5.3 Codex Spark',
    description: 'Very fast GPT-5.3 coding model',
  },
  'gpt-5.2-codex': {
    label: 'GPT-5.2 Codex',
    description: 'GPT-5.2 optimized for agentic coding',
  },
  'gpt-5.1-codex-max': {
    label: 'GPT-5.1 Codex Max',
    description: 'Maximum capability coding model',
  },
  'gpt-5.1-codex': {
    label: 'GPT-5.1 Codex',
    description: 'GPT-5.1 optimized for agentic coding',
  },
  'gpt-5-codex': {
    label: 'GPT-5 Codex',
    description: 'GPT-5 optimized for agentic coding',
  },
  'gpt-5.1-codex-mini': {
    label: 'GPT-5.1 Codex Mini',
    description: 'Faster version for coding tasks',
  },
  'gpt-5-codex-mini': {
    label: 'GPT-5 Codex Mini',
    description: 'Faster coding model',
  },
  'gpt-5.4': {
    label: 'GPT-5.4',
    description: 'Latest frontier agentic coding model',
  },
  'gpt-5.3': {
    label: 'GPT-5.3',
    description: 'General GPT-5.3 model',
  },
  'gpt-5.2': {
    label: 'GPT-5.2',
    description: 'General GPT-5.2 model',
  },
  'gpt-5.1': {
    label: 'GPT-5.1',
    description: 'General GPT-5.1 model',
  },
  'gpt-5': {
    label: 'GPT-5',
    description: 'General GPT-5 model',
  },
} as const;

/** Base models that get expanded into reasoning-effort variants */
const EFFORT_VARIANT_MODELS = new Set(['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']);

/** Build the expanded model map: effort-variant models get low/medium/high/xhigh; others are bare */
function buildCodexModels() {
  const models: Record<string, { label: string; description: string }> = {};
  for (const [id, config] of Object.entries(CODEX_BASE_MODELS)) {
    if (EFFORT_VARIANT_MODELS.has(id)) {
      for (const effort of supportedReasoningEfforts) {
        const effortMeta = CODEX_REASONING_EFFORTS[effort];
        const variantId = `${id}/${effort}`;
        const effortLabel = effort.charAt(0).toUpperCase() + effort.slice(1);
        models[variantId] = {
          label: `${config.label} (${effortLabel})`,
          description: `${config.description} — ${effortMeta.description.toLowerCase()}`,
        };
      }
    } else {
      models[id] = {
        label: config.label,
        description: config.description,
      };
    }
  }
  return models;
}

export const CODEX_MODELS = buildCodexModels();

export type CodexModelId = keyof typeof CODEX_MODELS;

export const CODEX_DEFAULT_MODEL_ID = 'gpt-5.3-codex/medium';

/**
 * Parse a Codex model ID into its base model and optional reasoning effort.
 *
 * @example
 * parseCodexReasoningEffort('gpt-5.3-codex/high')
 * // => { baseModel: 'gpt-5.3-codex', effort: 'high' }
 *
 * parseCodexReasoningEffort('gpt-5.3-codex')
 * // => { baseModel: 'gpt-5.3-codex', effort: undefined }
 */
export function parseCodexReasoningEffort(modelId: string): {
  baseModel: string;
  effort: string | undefined;
} {
  const slashIndex = modelId.indexOf('/');
  if (slashIndex === -1) {
    return { baseModel: modelId, effort: undefined };
  }
  return {
    baseModel: modelId.slice(0, slashIndex),
    effort: modelId.slice(slashIndex + 1),
  };
}

/** Get Codex models as an array for UI consumption */
export function getCodexModelList(): Array<{
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}> {
  return Object.entries(CODEX_MODELS).map(([id, config]) => ({
    value: id,
    label: config.label,
    description: config.description,
    isDefault: id === CODEX_DEFAULT_MODEL_ID,
  }));
}
