/**
 * Tests for the Pi IPC model-listing handler and ACP shape parsing.
 *
 * Covers:
 * - parseModelsFromSessionUpdate handling every supported ACP shape.
 * - The GET_MODELS handler returning DEFAULT_MODELS (never empty) when
 *   resolvePiCommand() returns null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pi-resolver', () => ({
  resolvePiCommand: vi.fn(),
}));

// Capture the handler registered via ipcMain.handle so we can invoke it directly.
const registeredHandlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

import { resolvePiCommand } from '../pi-resolver';
import { PI_CHANNELS } from '../../../../shared/ipc/channels';
import { parseModelsFromSessionUpdate, setupPiIPC } from '../pi.ipc';

describe('parseModelsFromSessionUpdate', () => {
  const model = { modelId: 'gpt-x', name: 'GPT X', description: 'fast' };

  it('parses wrapped models.availableModels (params)', () => {
    const result = parseModelsFromSessionUpdate({ models: { availableModels: [model] } });
    expect(result).toEqual([{ value: 'gpt-x', label: 'GPT X', description: 'fast' }]);
  });

  it('parses unwrapped availableModels (params)', () => {
    const result = parseModelsFromSessionUpdate({ availableModels: [model] });
    expect(result).toEqual([{ value: 'gpt-x', label: 'GPT X', description: 'fast' }]);
  });

  it('parses models.available variant', () => {
    const result = parseModelsFromSessionUpdate({ models: { available: [model] } });
    expect(result).toEqual([{ value: 'gpt-x', label: 'GPT X', description: 'fast' }]);
  });

  it('parses models wrapped under params.update', () => {
    const result = parseModelsFromSessionUpdate({
      update: { models: { availableModels: [model] } },
    });
    expect(result).toEqual([{ value: 'gpt-x', label: 'GPT X', description: 'fast' }]);
  });

  it('parses models wrapped under params.sessionUpdate', () => {
    const result = parseModelsFromSessionUpdate({
      sessionUpdate: { availableModels: [model] },
    });
    expect(result).toEqual([{ value: 'gpt-x', label: 'GPT X', description: 'fast' }]);
  });

  it('returns empty array when no models present', () => {
    expect(parseModelsFromSessionUpdate(undefined)).toEqual([]);
    expect(parseModelsFromSessionUpdate({})).toEqual([]);
  });
});

describe('Pi GET_MODELS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.clear();
  });

  it('returns DEFAULT_MODELS (never empty) when resolvePiCommand returns null', async () => {
    vi.mocked(resolvePiCommand).mockResolvedValue(null);

    setupPiIPC();
    const handler = registeredHandlers.get(PI_CHANNELS.GET_MODELS);
    expect(handler).toBeDefined();

    const response = await handler!({});

    expect(response.success).toBe(true);
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data).toEqual([
      { value: 'default', label: 'Default (Pi)', description: 'Use Pi default model' },
    ]);
    expect(response.warning).toBe('Pi command unavailable; using default model');
  });
});
