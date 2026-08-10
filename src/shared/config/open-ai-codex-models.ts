/**
 * Static list of OpenAI Codex models.
 *
 * The Codex CLI/MCP server does not expose a model listing endpoint,
 * so we maintain this list manually. Update when new models are released.
 *
 * Models that support reasoning effort (gpt-5.3-codex, gpt-5.2-codex,
 * gpt-5.1-codex-max) appear ONCE with `effortLevels` metadata — matching the
 * daemon's collapsed catalog (one base row per model, PROTOCOL §5.30/§6.7)
 * instead of the former 4-row "{model}/{effort}" expansion. Reasoning effort
 * is a first-class session field (`reasoningEffort`); selection no longer
 * composes compound ids.
 */

/** Supported reasoning effort levels */
export const supportedReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const;

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

/** Models that support reasoning effort (surfaced as `effortLevels` metadata) */
const EFFORT_CAPABLE_MODELS = new Set(['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']);

/** Build the model map: one row per base model; effort-capable rows carry effortLevels */
function buildCodexModels() {
  const models: Record<
    string,
    { label: string; description: string; effortLevels?: string[] }
  > = {};
  for (const [id, config] of Object.entries(CODEX_BASE_MODELS)) {
    models[id] = EFFORT_CAPABLE_MODELS.has(id)
      ? {
          label: config.label,
          description: config.description,
          effortLevels: [...supportedReasoningEfforts],
        }
      : {
          label: config.label,
          description: config.description,
        };
  }
  return models;
}

export const CODEX_MODELS = buildCodexModels();

export type CodexModelId = keyof typeof CODEX_MODELS;

/** Get Codex models as an array for UI consumption */
export function getCodexModelList(): Array<{
  value: string;
  label: string;
  description?: string;
  effortLevels?: string[];
}> {
  return Object.entries(CODEX_MODELS).map(([id, config]) => ({
    value: id,
    label: config.label,
    description: config.description,
    ...(config.effortLevels ? { effortLevels: config.effortLevels } : {}),
  }));
}
