/**
 * Unit tests for the shared `<provider>:get-models` reply builder. Both build
 * paths (Electron main and the daemon/web bridge seeder) return this builder's
 * output, so these cases pin the envelope semantics for both at once.
 */
import { describe, expect, it } from 'vitest';
import { toGetModelsEnvelope, type WireModelsListResult } from './wire-model-info';

describe('toGetModelsEnvelope', () => {
  it('maps rows and carries every daemon label', () => {
    const result: WireModelsListResult = {
      providerId: 'codex',
      models: [
        { id: 'gpt-a', name: 'GPT A', description: 'desc', isDefault: true },
        { id: 'gpt-b', name: 'GPT B', costTier: 2 },
      ],
      source: 'codex',
      stale: true,
      warning: 'codex CLI not found',
      warningKind: 'cli-missing',
    };

    expect(toGetModelsEnvelope(result)).toEqual({
      success: true,
      data: [
        { value: 'gpt-a', label: 'GPT A', description: 'desc', isDefault: true },
        { value: 'gpt-b', label: 'GPT B', costTier: 2 },
      ],
      warning: 'codex CLI not found',
      stale: true,
      warningKind: 'cli-missing',
    });
  });

  it('omits optional labels the daemon did not set', () => {
    const envelope = toGetModelsEnvelope({ models: [{ id: 'm', name: 'M' }], source: 'pi' });

    expect(envelope).toEqual({ success: true, data: [{ value: 'm', label: 'M' }] });
    expect(Object.keys(envelope)).toEqual(['success', 'data']);
  });

  it('drops an empty warning, a non-true stale flag, and malformed rows', () => {
    expect(
      toGetModelsEnvelope({
        models: [{ id: 'm', name: 'M' }, { id: 'no-name' }, { name: 'no-id' }],
        warning: '',
        stale: false,
      }),
    ).toEqual({ success: true, data: [{ value: 'm', label: 'M' }] });
  });

  it('keeps a warning but drops an unknown warningKind', () => {
    expect(
      toGetModelsEnvelope({ models: [], warning: 'adapter crashed', warningKind: 'adapter-crash' }),
    ).toEqual({ success: true, data: [], warning: 'adapter crashed' });
  });

  it('drops a warningKind that arrives without a warning', () => {
    expect(toGetModelsEnvelope({ models: [], warningKind: 'cli-missing' })).toEqual({
      success: true,
      data: [],
    });
  });

  it.each([null, undefined])('treats a %s result as an empty catalog', (result) => {
    expect(toGetModelsEnvelope(result)).toEqual({ success: true, data: [] });
  });
});
