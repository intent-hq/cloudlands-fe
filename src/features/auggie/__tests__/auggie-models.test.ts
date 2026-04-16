/**
 * Tests for auggie-models client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getModelIcon, type AuggieModel } from '../auggie-models.client';

// Mock the electron-bridge
vi.mock('$lib/electron-bridge', async () => await import('$lib/store/utils/test-helpers/electron-bridge-mock'));

vi.mock('$lib/utils/client-logger', async () => await import('$lib/store/utils/test-helpers/client-logger-mock'));

describe('auggie-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getModelIcon', () => {
    it('should return correct icon for Claude models', () => {
      expect(getModelIcon('haiku4.5')).toBe('🌸');
      expect(getModelIcon('opus4.1')).toBe('🎭');
      expect(getModelIcon('sonnet4')).toBe('🎵');
      expect(getModelIcon('sonnet4.5')).toBe('🎭');
      expect(getModelIcon('sonnet4.5_1m')).toBe('📖');
      expect(getModelIcon('sonnet4.5_direct')).toBe('⚡');
    });

    it('should return correct icon for Gemini models', () => {
      expect(getModelIcon('gemini25-pro')).toBe('💎');
      expect(getModelIcon('gemini3-eap')).toBe('🔥');
    });

    it('should return correct icon for GPT models', () => {
      expect(getModelIcon('gpt5-codex')).toBe('🤖');
      expect(getModelIcon('gpt5-r-high-grep')).toBe('📊');
      expect(getModelIcon('gpt5-r-low-grep')).toBe('📉');
      expect(getModelIcon('gpt5-r-medium-grep')).toBe('📈');
    });

    it('should return correct icon for other models', () => {
      expect(getModelIcon('glm4.6')).toBe('🌟');
      expect(getModelIcon('kimi-k2')).toBe('🎋');
      expect(getModelIcon('willow-alpha')).toBe('🌳');
      expect(getModelIcon('willow-alpha-apply-patch')).toBe('🌲');
    });

    it('should return default icon for unknown models', () => {
      expect(getModelIcon('unknown-model')).toBe('🤖');
      expect(getModelIcon('')).toBe('🤖');
    });
  });

  describe('AuggieModel type', () => {
    it('should create valid model objects', () => {
      const model: AuggieModel = {
        value: 'sonnet4.5',
        label: 'Claude Sonnet 4.5',
        description: 'A powerful AI model',
      };

      expect(model.value).toBe('sonnet4.5');
      expect(model.label).toBe('Claude Sonnet 4.5');
      expect(model.description).toBe('A powerful AI model');
    });

    it('should allow optional description', () => {
      const model: AuggieModel = {
        value: 'haiku4.5',
        label: 'Claude Haiku 4.5',
      };

      expect(model.value).toBe('haiku4.5');
      expect(model.description).toBeUndefined();
    });
  });

  // Regression: opus4.7-xhigh is the Auggie default and must have display metadata
  describe('opus4.7-xhigh default model regression', () => {
    it('opus4.7-xhigh has a dedicated icon (not the fallback)', () => {
      const icon = getModelIcon('opus4.7-xhigh');
      expect(icon).toBe('🎭');
      // Ensure it's NOT the generic fallback
      expect(icon).not.toBe(getModelIcon('unknown-model'));
    });
  });
});

/**
 * Inline replica of the private parseModelListJson logic from auggie.ipc.ts
 * so we can unit-test the parsing algorithm without exporting it.
 */
function parseModelListJson(stdout: string): Array<{
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  isLegacyModel?: boolean;
  costTier?: number;
  badges?: Array<{ color: string; label: string; variant?: string }>;
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}> | null {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.models)) {
      return null;
    }

    return parsed.models
      .filter(
        (m: Record<string, unknown>) =>
          typeof m.shortName === 'string' && typeof m.displayName === 'string',
      )
      .map((m: Record<string, unknown>) => ({
        value: m.shortName as string,
        label: m.displayName as string,
        ...(m.description ? { description: m.description as string } : {}),
        ...(m.modelGroupPriority != null
          ? { modelGroupPriority: m.modelGroupPriority as number }
          : {}),
        ...(m.isLegacyModel ? { isLegacyModel: true } : {}),
        ...(m.costTier != null ? { costTier: m.costTier as number } : {}),
        ...(Array.isArray(m.badges) && m.badges.length > 0 ? { badges: m.badges } : {}),
        ...(Array.isArray(m.effortLevels) && m.effortLevels.length > 0
          ? { effortLevels: m.effortLevels }
          : {}),
        ...(m.isDefault ? { isDefault: true } : {}),
        ...(m.priority != null ? { priority: m.priority as number } : {}),
      }));
  } catch {
    return null;
  }
}

describe('parseModelListJson', () => {
  it('should parse valid JSON with all fields', () => {
    const input = JSON.stringify({
      models: [
        {
          shortName: 'sonnet4.5',
          displayName: 'Claude Sonnet 4.5',
          description: 'Fast and capable',
          modelGroupPriority: 1,
          isLegacyModel: false,
          costTier: 2,
          badges: [{ color: 'blue', label: 'Auto' }],
          effortLevels: ['low', 'medium', 'high'],
          isDefault: true,
          priority: 1,
        },
      ],
    });

    const result = parseModelListJson(input);
    expect(result).toEqual([
      {
        value: 'sonnet4.5',
        label: 'Claude Sonnet 4.5',
        description: 'Fast and capable',
        modelGroupPriority: 1,
        costTier: 2,
        badges: [{ color: 'blue', label: 'Auto' }],
        effortLevels: ['low', 'medium', 'high'],
        isDefault: true,
        priority: 1,
      },
    ]);
  });

  it('should return null for invalid JSON', () => {
    expect(parseModelListJson('not json')).toBeNull();
    expect(parseModelListJson('')).toBeNull();
    expect(parseModelListJson('{broken')).toBeNull();
  });

  it('should return null when models array is missing', () => {
    expect(parseModelListJson(JSON.stringify({}))).toBeNull();
    expect(parseModelListJson(JSON.stringify({ models: 'not-array' }))).toBeNull();
    expect(parseModelListJson(JSON.stringify({ models: null }))).toBeNull();
  });

  it('should skip entries with missing shortName or displayName', () => {
    const input = JSON.stringify({
      models: [
        { shortName: 'valid', displayName: 'Valid Model' },
        { displayName: 'Missing shortName' },
        { shortName: 'missing-display' },
        { shortName: 123, displayName: 'Numeric shortName' },
        {},
      ],
    });

    const result = parseModelListJson(input);
    expect(result).toHaveLength(1);
    expect(result![0].value).toBe('valid');
  });

  it('should omit optional fields when not present', () => {
    const input = JSON.stringify({
      models: [{ shortName: 'minimal', displayName: 'Minimal Model' }],
    });

    const result = parseModelListJson(input);
    expect(result).toEqual([{ value: 'minimal', label: 'Minimal Model' }]);
    expect(result![0]).not.toHaveProperty('description');
    expect(result![0]).not.toHaveProperty('modelGroupPriority');
    expect(result![0]).not.toHaveProperty('isLegacyModel');
    expect(result![0]).not.toHaveProperty('costTier');
    expect(result![0]).not.toHaveProperty('badges');
    expect(result![0]).not.toHaveProperty('effortLevels');
    expect(result![0]).not.toHaveProperty('isDefault');
    expect(result![0]).not.toHaveProperty('priority');
  });

  it('should omit badges and effortLevels when they are empty arrays', () => {
    const input = JSON.stringify({
      models: [{ shortName: 'test', displayName: 'Test', badges: [], effortLevels: [] }],
    });

    const result = parseModelListJson(input);
    expect(result![0]).not.toHaveProperty('badges');
    expect(result![0]).not.toHaveProperty('effortLevels');
  });
});

describe('model filter and sort logic', () => {
  type ParsedModel = {
    value: string;
    label: string;
    modelGroupPriority?: number;
    isLegacyModel?: boolean;
    priority?: number;
  };

  function filterAndSort(models: ParsedModel[]): ParsedModel[] {
    const filtered = models.filter((m) => !m.isLegacyModel);
    return filtered.sort((a, b) => {
      const aGroup = a.modelGroupPriority ?? 999;
      const bGroup = b.modelGroupPriority ?? 999;
      if (aGroup !== bGroup) return aGroup - bGroup;
      const aPriority = a.priority ?? 999;
      const bPriority = b.priority ?? 999;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.label.localeCompare(b.label);
    });
  }

  it('should remove legacy models', () => {
    const models: ParsedModel[] = [
      { value: 'new-model', label: 'New', isLegacyModel: false },
      { value: 'legacy-model', label: 'Legacy', isLegacyModel: true },
      { value: 'another-new', label: 'Another New' },
    ];

    const result = filterAndSort(models);
    expect(result.map((m) => m.value)).toEqual(['another-new', 'new-model']);
  });

  it('should sort by modelGroupPriority first', () => {
    const models: ParsedModel[] = [
      { value: 'group2', label: 'Group 2', modelGroupPriority: 2 },
      { value: 'group1', label: 'Group 1', modelGroupPriority: 1 },
      { value: 'no-group', label: 'No Group' },
    ];

    const result = filterAndSort(models);
    expect(result.map((m) => m.value)).toEqual(['group1', 'group2', 'no-group']);
  });

  it('should sort by priority within the same group', () => {
    const models: ParsedModel[] = [
      { value: 'low-pri', label: 'Low', modelGroupPriority: 1, priority: 10 },
      { value: 'high-pri', label: 'High', modelGroupPriority: 1, priority: 1 },
      { value: 'mid-pri', label: 'Mid', modelGroupPriority: 1, priority: 5 },
    ];

    const result = filterAndSort(models);
    expect(result.map((m) => m.value)).toEqual(['high-pri', 'mid-pri', 'low-pri']);
  });

  it('should place models without priority after those with priority in the same group', () => {
    const models: ParsedModel[] = [
      { value: 'no-pri', label: 'No Priority', modelGroupPriority: 1 },
      { value: 'has-pri', label: 'Has Priority', modelGroupPriority: 1, priority: 5 },
    ];

    const result = filterAndSort(models);
    expect(result.map((m) => m.value)).toEqual(['has-pri', 'no-pri']);
  });

  it('should handle combined filter and sort', () => {
    const models: ParsedModel[] = [
      { value: 'g2-p2', label: 'G2P2', modelGroupPriority: 2, priority: 2 },
      { value: 'legacy', label: 'Legacy', modelGroupPriority: 1, priority: 1, isLegacyModel: true },
      { value: 'g1-p2', label: 'G1P2', modelGroupPriority: 1, priority: 2 },
      { value: 'g1-p1', label: 'G1P1', modelGroupPriority: 1, priority: 1 },
      { value: 'g2-p1', label: 'G2P1', modelGroupPriority: 2, priority: 1 },
    ];

    const result = filterAndSort(models);
    expect(result.map((m) => m.value)).toEqual(['g1-p1', 'g1-p2', 'g2-p1', 'g2-p2']);
  });

  it('should use display name as a stable tie-breaker when group and priority match', () => {
    const models: ParsedModel[] = [
      { value: 'zeta', label: 'Zeta', modelGroupPriority: 1, priority: 0 },
      { value: 'alpha', label: 'Alpha', modelGroupPriority: 1, priority: 0 },
      { value: 'beta', label: 'Beta', modelGroupPriority: 1, priority: 0 },
    ];

    const result = filterAndSort(models);
    expect(result.map((m) => m.value)).toEqual(['alpha', 'beta', 'zeta']);
  });
});
