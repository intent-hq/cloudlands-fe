/**
 * Tests for markdown-anchor-recovery production module
 *
 * These tests verify the production implementation of markdown-based anchor recovery.
 * Ported from the spike to ensure the production code works correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  findAnchorsInMarkdown,
  removeAnchors,
  extractAnchoredText,
  recoverMissingEndAnchor,
  recoverMissingStartAnchor,
  scanForProblematicAnchors,
  findMostRecentHealthyVersion,
  recoverPartialAnchor,
  recoverAllPartialAnchors,
} from '../markdown-anchor-recovery';
import type { NoteVersion } from '../../../shared/types';

describe('Markdown Anchor Recovery - Production', () => {
  describe('findAnchorsInMarkdown', () => {
    it('should find both start and end anchors', () => {
      const markdown = 'Hello <!--anchor:test:start-->world<!--anchor:test:end--> today';
      const positions = findAnchorsInMarkdown(markdown, 'test');

      expect(positions.start).toBe(6);
      expect(positions.end).toBe(35);
    });

    it('should return undefined for missing anchors', () => {
      const markdown = 'Hello world';
      const positions = findAnchorsInMarkdown(markdown, 'test');

      expect(positions.start).toBeUndefined();
      expect(positions.end).toBeUndefined();
    });

    it('should find only start anchor', () => {
      const markdown = 'Hello <!--anchor:test:start-->world';
      const positions = findAnchorsInMarkdown(markdown, 'test');

      expect(positions.start).toBe(6);
      expect(positions.end).toBeUndefined();
    });

    it('should find only end anchor', () => {
      const markdown = 'Hello world<!--anchor:test:end-->';
      const positions = findAnchorsInMarkdown(markdown, 'test');

      expect(positions.start).toBeUndefined();
      expect(positions.end).toBe(11);
    });
  });

  describe('removeAnchors', () => {
    it('should remove both anchors', () => {
      const markdown = 'Hello <!--anchor:test:start-->world<!--anchor:test:end--> today';
      const result = removeAnchors(markdown, 'test');

      expect(result).toBe('Hello world today');
    });

    it('should remove duplicate anchors', () => {
      const markdown =
        'Hello <!--anchor:test:start--><!--anchor:test:start-->world<!--anchor:test:end--><!--anchor:test:end--> today';
      const result = removeAnchors(markdown, 'test');

      expect(result).toBe('Hello world today');
    });

    it('should not affect other comment anchors', () => {
      const markdown =
        'Hello <!--anchor:test:start-->world<!--anchor:test:end--> <!--anchor:other:start-->foo<!--anchor:other:end-->';
      const result = removeAnchors(markdown, 'test');

      expect(result).toBe('Hello world <!--anchor:other:start-->foo<!--anchor:other:end-->');
    });
  });

  describe('extractAnchoredText', () => {
    it('should extract text and context', () => {
      const markdown = 'Hello <!--anchor:test:start-->world<!--anchor:test:end--> today';
      const info = extractAnchoredText(markdown, 'test');

      expect(info).not.toBeNull();
      expect(info!.text).toBe('world');
      expect(info!.contextBefore).toBe('Hello ');
      expect(info!.contextAfter).toBe(' today');
    });

    it('should return null if anchors missing', () => {
      const markdown = 'Hello world';
      const info = extractAnchoredText(markdown, 'test');

      expect(info).toBeNull();
    });

    it('should handle multi-word text', () => {
      const markdown =
        'Intro <!--anchor:test:start-->beautiful, wonderful, and amazing<!--anchor:test:end--> conclusion';
      const info = extractAnchoredText(markdown, 'test');

      expect(info).not.toBeNull();
      expect(info!.text).toBe('beautiful, wonderful, and amazing');
      expect(info!.contextBefore).toBe('Intro ');
      expect(info!.contextAfter).toBe(' conclusion');
    });
  });

  describe('recoverMissingEndAnchor', () => {
    describe('Heuristic 1: Anchor neighbor word', () => {
      it('should recover using neighbor word after end anchor', () => {
        // Original: Hello <!--anchor:test:start-->beautiful, wonderful, and amazing<!--anchor:test:end--> world.
        // Current: Hello <!--anchor:test:start-->wonderful world.
        // Expected: Hello <!--anchor:test:start-->wonderful<!--anchor:test:end--> world.
        // Note: Whitespace before "world" is preserved

        const current = 'Hello <!--anchor:test:start-->wonderful world.';
        const originalText = 'beautiful, wonderful, and amazing';
        const contextAfter = ' world.';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(true);
        expect(result.method).toBe('anchor-neighbor');
        expect(result.confidence).toBe(0.9);
        expect(result.markdown).toBe(
          'Hello <!--anchor:test:start-->wonderful<!--anchor:test:end--> world.',
        );
      });

      it('should handle punctuation in neighbor word', () => {
        const current = 'Hello <!--anchor:test:start-->wonderful world.';
        const originalText = 'beautiful, wonderful, and amazing';
        const contextAfter = ' world.';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(true);
        // Whitespace before neighbor word is preserved
        expect(result.markdown).toContain('wonderful<!--anchor:test:end--> world');
      });
    });

    describe('Heuristic 2: Longest sequence of words', () => {
      it('should recover using longest matching sequence', () => {
        // Original: <!--anchor:test:start-->beautiful, wonderful, and amazing<!--anchor:test:end-->
        // Current: <!--anchor:test:start-->wonderful and amazing
        // Should find "wonderful" and "amazing" as longest sequence

        const current = '<!--anchor:test:start-->wonderful and amazing';
        const originalText = 'beautiful, wonderful, and amazing';
        const contextAfter = '';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(true);
        expect(result.method).toBe('longest-sequence');
        expect(result.confidence).toBe(0.7);
      });

      it('should strip punctuation when matching words', () => {
        // This tests the fix for "wonderful," vs "wonderful"
        const current = '<!--anchor:test:start-->wonderful amazing';
        const originalText = 'beautiful, wonderful, and amazing';
        const contextAfter = '';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(true);
        // Should match "wonderful" and "amazing" despite punctuation differences
      });
    });

    describe('Failure cases', () => {
      it('should fail when no original text remains', () => {
        const current = '<!--anchor:test:start-->completely different text';
        const originalText = 'beautiful';
        const contextAfter = ' world';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('no-matching-text');
      });

      it('should fail when start anchor not found', () => {
        const current = 'no anchors here';
        const originalText = 'beautiful';
        const contextAfter = ' world';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('start-anchor-not-found');
      });
    });
  });

  describe('recoverMissingStartAnchor', () => {
    describe('Heuristic 1: Anchor neighbor word', () => {
      it('should recover using neighbor word before start anchor', () => {
        // Original: Hello <!--anchor:test:start-->wonderful, and amazing<!--anchor:test:end--> world
        // Current: Hello wonderful, and amazing<!--anchor:test:end--> world
        // Expected: Hello <!--anchor:test:start-->wonderful, and amazing<!--anchor:test:end--> world

        const current = 'Hello wonderful, and amazing<!--anchor:test:end--> world';
        const originalText = 'wonderful, and amazing';
        const contextBefore = 'Hello ';

        const result = recoverMissingStartAnchor(current, 'test', originalText, contextBefore);

        expect(result.success).toBe(true);
        expect(result.method).toBe('anchor-neighbor');
        expect(result.confidence).toBe(0.9);
      });
    });

    describe('Heuristic 2: Longest sequence', () => {
      it('should recover using longest matching sequence', () => {
        const current = 'wonderful and amazing<!--anchor:test:end-->';
        const originalText = 'beautiful, wonderful, and amazing';
        const contextBefore = '';

        const result = recoverMissingStartAnchor(current, 'test', originalText, contextBefore);

        expect(result.success).toBe(true);
        expect(result.method).toBe('longest-sequence');
        expect(result.confidence).toBe(0.7);
      });
    });
  });

  describe('No duplicate anchors', () => {
    it('should not create duplicate anchors when recovering', () => {
      // Start with duplicate start anchors
      const current = 'Hello <!--anchor:test:start--><!--anchor:test:start-->wonderful world.';
      const originalText = 'wonderful';
      const contextAfter = ' world.';

      const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

      expect(result.success).toBe(true);
      // Should have exactly one start and one end
      const startCount = (result.markdown!.match(/<!--anchor:test:start-->/g) || []).length;
      const endCount = (result.markdown!.match(/<!--anchor:test:end-->/g) || []).length;

      expect(startCount).toBe(1);
      expect(endCount).toBe(1);
    });
  });

  describe('Edge cases', () => {
    describe('Repeated words', () => {
      it('should handle repeated phrases correctly', () => {
        // "quick brown fox" appears twice, we want the first one
        const current =
          'The <!--anchor:test:start-->quick brown fox jumps. The quick brown fox sleeps.';
        const originalText = 'quick brown fox';
        const contextAfter = ' jumps';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        expect(result.success).toBe(true);
        // Should find the first occurrence (before "jumps")
        // Whitespace before "jumps" is preserved
        expect(result.markdown).toContain('fox<!--anchor:test:end--> jumps');
      });
    });

    describe('Multiple edits', () => {
      it('should handle text that has been modified multiple times', () => {
        // V1: "quick brown fox" → V2: "fast brown fox" → V3: "fast red fox"
        // Recovery uses V1 but current is V3
        const current = '<!--anchor:test:start-->fast red fox';
        const originalText = 'quick brown fox'; // From V1
        const contextAfter = '';

        const result = recoverMissingEndAnchor(current, 'test', originalText, contextAfter);

        // Should either succeed (if "fox" matches) or fail gracefully
        if (result.success) {
          expect(result.markdown).toContain('<!--anchor:test:end-->');
        } else {
          expect(result.reason).toBeDefined();
        }
      });
    });
  });

  describe('High-Level Recovery Functions', () => {
    // Helper to create test versions
    const createTestVersion = (content: string, versionNumber: number): NoteVersion => ({
      versionId: `v${versionNumber}`,
      versionNumber,
      content,
      title: `Version ${versionNumber}`,
      createdAt: new Date().toISOString(),
    });

    describe('scanForProblematicAnchors', () => {
      it('should identify partial start only', () => {
        const markdown = 'Hello <!--anchor:c1:start-->world';
        const partial = scanForProblematicAnchors(markdown, ['c1']);

        expect(partial).toHaveLength(1);
        expect(partial[0]).toEqual({ commentId: 'c1', state: 'PARTIAL_START_ONLY' });
      });

      it('should identify partial end only', () => {
        const markdown = 'Hello world<!--anchor:c1:end-->';
        const partial = scanForProblematicAnchors(markdown, ['c1']);

        expect(partial).toHaveLength(1);
        expect(partial[0]).toEqual({ commentId: 'c1', state: 'PARTIAL_END_ONLY' });
      });

      it('should not identify healthy anchors', () => {
        const markdown = 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->';
        const partial = scanForProblematicAnchors(markdown, ['c1']);

        expect(partial).toHaveLength(0);
      });

      it('should handle multiple comments', () => {
        const markdown =
          'Hello <!--anchor:c1:start-->world <!--anchor:c2:end--> <!--anchor:c3:start-->foo<!--anchor:c3:end-->';
        const partial = scanForProblematicAnchors(markdown, ['c1', 'c2', 'c3']);

        expect(partial).toHaveLength(2);
        expect(partial).toContainEqual({ commentId: 'c1', state: 'PARTIAL_START_ONLY' });
        expect(partial).toContainEqual({ commentId: 'c2', state: 'PARTIAL_END_ONLY' });
      });
    });

    describe('recoverMissingEndAnchor - whitespace preservation', () => {
      it('should preserve newlines added by user before neighbor word', () => {
        // User had: "sense?\n- next" with end anchor after "?"
        // User added newline: "sense?\n\n- next"
        // Recovery should preserve the extra newline
        const current = '- What <!--anchor:c1:start-->makes sense?\n\n- next item';
        const original = 'makes sense?';
        const contextAfter = '\n- next item';

        const result = recoverMissingEndAnchor(current, 'c1', original, contextAfter);

        expect(result.success).toBe(true);
        expect(result.markdown).toBe(
          '- What <!--anchor:c1:start-->makes sense?<!--anchor:c1:end-->\n\n- next item',
        );
      });

      it('should preserve multiple newlines', () => {
        const current = 'Text <!--anchor:c1:start-->here\n\n\nNext';
        const original = 'here';
        const contextAfter = '\nNext';

        const result = recoverMissingEndAnchor(current, 'c1', original, contextAfter);

        expect(result.success).toBe(true);
        expect(result.markdown).toBe(
          'Text <!--anchor:c1:start-->here<!--anchor:c1:end-->\n\n\nNext',
        );
      });

      it('should preserve spaces before neighbor word', () => {
        const current = 'Text <!--anchor:c1:start-->here   Next';
        const original = 'here';
        const contextAfter = ' Next';

        const result = recoverMissingEndAnchor(current, 'c1', original, contextAfter);

        expect(result.success).toBe(true);
        expect(result.markdown).toBe('Text <!--anchor:c1:start-->here<!--anchor:c1:end-->   Next');
      });

      it('should preserve newline in list item formatting (real-world case)', () => {
        // User's real case: added newline to fix list formatting
        // Original: "sense?\n- hahahahhaah"
        // User added newline: "sense?\n\n- hahahahhaah"
        const current =
          '- What <!--anchor:c1:start-->conflict resolution strategy makes the most sense?\n\n- hahahahhaah How do we handle large file transfers efficiently?';
        const original = 'conflict resolution strategy makes the most sense?';
        const contextAfter = '\n- hahahahhaah How do we handle large file transfers efficiently?';

        const result = recoverMissingEndAnchor(current, 'c1', original, contextAfter);

        expect(result.success).toBe(true);
        // The extra newline should be preserved
        expect(result.markdown).toBe(
          '- What <!--anchor:c1:start-->conflict resolution strategy makes the most sense?<!--anchor:c1:end-->\n\n- hahahahhaah How do we handle large file transfers efficiently?',
        );
      });
    });

    describe('recoverMissingStartAnchor - whitespace preservation', () => {
      it('should preserve newlines added by user after neighbor word', () => {
        const current = 'Previous\n\nText<!--anchor:c1:end-->here';
        const original = 'Text';
        const contextBefore = 'Previous\n';

        const result = recoverMissingStartAnchor(current, 'c1', original, contextBefore);

        expect(result.success).toBe(true);
        expect(result.markdown).toBe(
          'Previous\n\n<!--anchor:c1:start-->Text<!--anchor:c1:end-->here',
        );
      });
    });

    describe('findMostRecentHealthyVersion', () => {
      it('should find most recent healthy version', () => {
        const versions = [
          createTestVersion('Hello <!--anchor:c1:start-->world', 3), // Partial
          createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 2), // Healthy
          createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1), // Healthy
        ];

        const healthy = findMostRecentHealthyVersion('c1', versions);

        expect(healthy).not.toBeNull();
        expect(healthy!.versionNumber).toBe(2);
      });

      it('should return null if no healthy version exists', () => {
        const versions = [
          createTestVersion('Hello world', 2), // No anchors
          createTestVersion('Hello <!--anchor:c1:start-->world', 1), // Partial
        ];

        const healthy = findMostRecentHealthyVersion('c1', versions);

        expect(healthy).toBeNull();
      });
    });

    describe('recoverPartialAnchor', () => {
      it('should recover missing end anchor', () => {
        const current = 'Hello <!--anchor:c1:start-->wonderful world.';
        const versions = [
          createTestVersion('Hello <!--anchor:c1:start-->wonderful<!--anchor:c1:end--> world.', 1),
        ];

        const result = recoverPartialAnchor(current, 'c1', versions);

        expect(result.success).toBe(true);
        expect(result.markdown).toContain('<!--anchor:c1:end-->');
      });

      it('should recover missing start anchor', () => {
        const current = 'Hello wonderful<!--anchor:c1:end--> world.';
        const versions = [
          createTestVersion('Hello <!--anchor:c1:start-->wonderful<!--anchor:c1:end--> world.', 1),
        ];

        const result = recoverPartialAnchor(current, 'c1', versions);

        expect(result.success).toBe(true);
        expect(result.markdown).toContain('<!--anchor:c1:start-->');
      });

      it('should fail if both anchors present', () => {
        const current = 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->';
        const versions = [createTestVersion(current, 1)];

        const result = recoverPartialAnchor(current, 'c1', versions);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('both-anchors-present');
      });

      it('should fail if both anchors missing', () => {
        const current = 'Hello world';
        const versions = [
          createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1),
        ];

        const result = recoverPartialAnchor(current, 'c1', versions);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('both-anchors-missing');
      });

      it('should fail if no healthy version exists', () => {
        const current = 'Hello <!--anchor:c1:start-->world';
        const versions = [createTestVersion('Hello world', 1)]; // No anchors

        const result = recoverPartialAnchor(current, 'c1', versions);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('no-healthy-version');
      });
    });

    describe('recoverAllPartialAnchors', () => {
      it('should recover multiple partial anchors', () => {
        const current = 'Hello <!--anchor:c1:start-->wonderful <!--anchor:c2:end--> world.';
        const versions = [
          createTestVersion(
            'Hello <!--anchor:c1:start-->wonderful<!--anchor:c1:end--> <!--anchor:c2:start-->foo<!--anchor:c2:end--> world.',
            1,
          ),
        ];

        const result = recoverAllPartialAnchors(current, ['c1', 'c2'], versions);

        expect(result.recovered).toHaveLength(2);
        expect(result.recovered).toContain('c1');
        expect(result.recovered).toContain('c2');
        expect(result.failed).toHaveLength(0);
        expect(result.markdown).toContain('<!--anchor:c1:end-->');
        expect(result.markdown).toContain('<!--anchor:c2:start-->');
      });

      it('should track failed recoveries', () => {
        const current = 'Hello <!--anchor:c1:start-->completely different text';
        const versions = [
          createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1),
        ];

        const result = recoverAllPartialAnchors(current, ['c1'], versions);

        expect(result.recovered).toHaveLength(0);
        expect(result.failed).toHaveLength(1);
        expect(result.failed).toContain('c1');
      });

      it('should remove partial anchors when recovery fails', () => {
        const current = 'Hello <!--anchor:c1:start-->completely different text';
        const versions = [
          createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1),
        ];

        const result = recoverAllPartialAnchors(current, ['c1'], versions);

        // Recovery should fail
        expect(result.failed).toContain('c1');

        // Partial anchor should be removed from markdown
        expect(result.markdown).not.toContain('<!--anchor:c1:start-->');
        expect(result.markdown).not.toContain('<!--anchor:c1:end-->');
        expect(result.markdown).toBe('Hello completely different text');
      });

      it('should skip healthy anchors', () => {
        const current =
          'Hello <!--anchor:c1:start-->world<!--anchor:c1:end--> <!--anchor:c2:start-->foo';
        const versions = [
          createTestVersion(
            'Hello <!--anchor:c1:start-->world<!--anchor:c1:end--> <!--anchor:c2:start-->foo<!--anchor:c2:end-->',
            1,
          ),
        ];

        const result = recoverAllPartialAnchors(current, ['c1', 'c2'], versions);

        // Only c2 should be recovered (c1 is healthy)
        expect(result.recovered).toHaveLength(1);
        expect(result.recovered).toContain('c2');
      });
    });
  });
});
