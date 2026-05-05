import { describe, expect, it } from 'vitest';
import {
  CODEX_DEFAULT_MODEL_ID,
  CODEX_MODELS,
  getCodexModelList,
  supportedReasoningEfforts,
} from '../open-ai-codex-models';

describe('OpenAI Codex model config', () => {
  it('keeps GPT-5.4 as the newest static fallback frontier model', () => {
    expect(CODEX_MODELS['gpt-5.5']).toBeUndefined();
    expect(CODEX_MODELS['gpt-5.4']).toEqual({
      label: 'GPT-5.4',
      description: 'Latest frontier agentic coding model',
    });
  });

  it('generates reasoning effort variants for effort-capable Codex models', () => {
    for (const effort of supportedReasoningEfforts) {
      expect(CODEX_MODELS[`gpt-5.3-codex/${effort}`]).toBeDefined();
    }
  });

  it('keeps the existing Codex default model selected', () => {
    const defaultEntry = getCodexModelList().find((model) => model.isDefault);

    expect(CODEX_DEFAULT_MODEL_ID).toBe('gpt-5.3-codex/medium');
    expect(defaultEntry?.value).toBe(CODEX_DEFAULT_MODEL_ID);
  });
});