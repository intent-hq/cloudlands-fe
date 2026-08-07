import {
  describe,
  expect,
  it,
} from 'vitest';
import {
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

  it('keeps effort-capable Codex models as single rows with effortLevels metadata (no {model}/{effort} expansion)', () => {
    for (const baseModel of ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']) {
      expect(CODEX_MODELS[baseModel]?.effortLevels).toEqual([...supportedReasoningEfforts]);
      for (const effort of supportedReasoningEfforts) {
        expect(CODEX_MODELS[`${baseModel}/${effort}`]).toBeUndefined();
      }
    }
    // Non-effort models carry no effortLevels metadata.
    expect(CODEX_MODELS['gpt-5.4']?.effortLevels).toBeUndefined();
  });

  it('surfaces effortLevels on the UI model list rows', () => {
    const list = getCodexModelList();
    const capable = list.find((model) => model.value === 'gpt-5.3-codex');
    expect(capable?.effortLevels).toEqual([...supportedReasoningEfforts]);
    const plain = list.find((model) => model.value === 'gpt-5.4');
    expect(plain).toBeDefined();
    expect('effortLevels' in (plain ?? {})).toBe(false);
  });

  it('marks no static Codex model as default (defaults come from the provider CLI)', () => {
    expect(getCodexModelList().every((model) => !('isDefault' in model))).toBe(true);
  });
});