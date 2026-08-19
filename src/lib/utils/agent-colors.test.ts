import { describe, expect, it } from 'vitest';
import { agentColorPalette, getAgentColorsWithSeed } from './agent-colors';

describe('agent colors', () => {
  it('keeps the established seeded palette independent from avatar art', () => {
    expect(agentColorPalette).toEqual([
      '#FFA2A3',
      '#FFD574',
      '#DAF294',
      '#5EEAB4',
      '#75D4FF',
      '#A3B4FF',
      '#DAB2FF',
      '#FEA5D5',
      '#CAD5E2',
    ]);
  });

  it('returns stable colors for a reused agent identity', () => {
    expect(getAgentColorsWithSeed('agent-virtual-row')).toEqual(
      getAgentColorsWithSeed('agent-virtual-row'),
    );
    expect(getAgentColorsWithSeed('agent-virtual-row', true)).not.toEqual(
      getAgentColorsWithSeed('agent-virtual-row'),
    );
  });
});
