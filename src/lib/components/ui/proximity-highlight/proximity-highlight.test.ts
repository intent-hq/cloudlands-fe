import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import { ProximityHighlight } from './index';
import { proximityHighlightMetadata } from './proximity-highlight.meta';

describe('ProximityHighlight registration', () => {
  it('publishes its component and catalog contract', () => {
    expect(ProximityHighlight).toBeDefined();
    expect(() => parseUiComponentMetadata(proximityHighlightMetadata)).not.toThrow();
    expect(proximityHighlightMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining(['pointer-proximity', 'keyboard-focus', 'merged-selection']),
    );
  });
});
