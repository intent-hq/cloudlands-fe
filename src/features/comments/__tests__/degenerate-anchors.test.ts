/**
 * Tests for degenerate anchor detection and removal
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  scanForProblematicAnchors,
  removeDegenerateAnchors,
} from '../main/markdown-anchor-recovery';

describe('Degenerate Anchor Detection', () => {
  describe('scanForProblematicAnchors - DEGENERATE state', () => {
    it('should detect anchors with no text between them', () => {
      const markdown = 'Hello<!--anchor:c1:start--><!--anchor:c1:end--> world';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([{ commentId: 'c1', state: 'DEGENERATE' }]);
    });

    it('should detect anchors with only whitespace between them', () => {
      const markdown = 'Hello<!--anchor:c1:start-->   <!--anchor:c1:end--> world';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([{ commentId: 'c1', state: 'DEGENERATE' }]);
    });

    it('should detect anchors with only newlines between them', () => {
      const markdown = 'Hello<!--anchor:c1:start-->\n\n<!--anchor:c1:end--> world';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([{ commentId: 'c1', state: 'DEGENERATE' }]);
    });

    it('should NOT detect anchors with text between them', () => {
      const markdown = 'Hello<!--anchor:c1:start-->world<!--anchor:c1:end--> there';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([]);
    });

    it('should NOT detect anchors with single character between them', () => {
      const markdown = 'Hello<!--anchor:c1:start-->x<!--anchor:c1:end--> world';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([]);
    });

    it('should handle multiple comments with different states', () => {
      const markdown = `
        Hello<!--anchor:c1:start--><!--anchor:c1:end--> world
        Test<!--anchor:c2:start-->text<!--anchor:c2:end--> here
        More<!--anchor:c3:start-->  <!--anchor:c3:end--> content
      `;
      const result = scanForProblematicAnchors(markdown, ['c1', 'c2', 'c3']);
      expect(result).toEqual([
        { commentId: 'c1', state: 'DEGENERATE' },
        { commentId: 'c3', state: 'DEGENERATE' },
      ]);
    });

    it('should detect partial anchors as well', () => {
      const markdown = 'Hello<!--anchor:c1:start--> world';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([{ commentId: 'c1', state: 'PARTIAL_START_ONLY' }]);
    });

    it('should ignore comments with no anchors', () => {
      const markdown = 'Hello world';
      const result = scanForProblematicAnchors(markdown, ['c1']);
      expect(result).toEqual([]);
    });

    it('should handle real-world case from user report', () => {
      const markdown =
        'Maintain security and privacy standards<!--anchor:c08f2317-71aa-4903-a462-54c5d9fc666b:start--><!--anchor:c08f2317-71aa-4903-a462-54c5d9fc666b:end-->';
      const result = scanForProblematicAnchors(markdown, ['c08f2317-71aa-4903-a462-54c5d9fc666b']);
      expect(result).toEqual([
        { commentId: 'c08f2317-71aa-4903-a462-54c5d9fc666b', state: 'DEGENERATE' },
      ]);
    });
  });

  describe('removeDegenerateAnchors', () => {
    it('should remove both anchors for degenerate comment', () => {
      const markdown = 'Hello<!--anchor:c1:start--><!--anchor:c1:end--> world';
      const result = removeDegenerateAnchors(markdown, ['c1']);
      expect(result).toBe('Hello world');
    });

    it('should remove anchors with whitespace between them', () => {
      const markdown = 'Hello<!--anchor:c1:start-->   <!--anchor:c1:end--> world';
      const result = removeDegenerateAnchors(markdown, ['c1']);
      expect(result).toBe('Hello    world');
    });

    it('should handle multiple degenerate comments', () => {
      const markdown = `
        Hello<!--anchor:c1:start--><!--anchor:c1:end--> world
        Test<!--anchor:c2:start-->  <!--anchor:c2:end--> here
      `;
      const result = removeDegenerateAnchors(markdown, ['c1', 'c2']);
      expect(result).not.toContain('anchor:c1');
      expect(result).not.toContain('anchor:c2');
    });

    it('should preserve non-degenerate anchors', () => {
      const markdown =
        'Hello<!--anchor:c1:start-->world<!--anchor:c1:end--> there<!--anchor:c2:start--><!--anchor:c2:end-->';
      const result = removeDegenerateAnchors(markdown, ['c2']);
      expect(result).toContain('anchor:c1:start');
      expect(result).toContain('anchor:c1:end');
      expect(result).not.toContain('anchor:c2');
    });

    it('should handle real-world case from user report', () => {
      const markdown =
        'Maintain security and privacy standards<!--anchor:c08f2317-71aa-4903-a462-54c5d9fc666b:start--><!--anchor:c08f2317-71aa-4903-a462-54c5d9fc666b:end-->';
      const result = removeDegenerateAnchors(markdown, ['c08f2317-71aa-4903-a462-54c5d9fc666b']);
      expect(result).toBe('Maintain security and privacy standards');
    });
  });

  describe('Integration: Scan and Remove', () => {
    it('should scan and remove degenerate anchors in one flow', () => {
      const markdown = `
        # Title

        Hello<!--anchor:c1:start--><!--anchor:c1:end--> world
        Test<!--anchor:c2:start-->text<!--anchor:c2:end--> here
        More<!--anchor:c3:start-->  <!--anchor:c3:end--> content
      `;

      const commentIds = ['c1', 'c2', 'c3'];
      const problems = scanForProblematicAnchors(markdown, commentIds);
      const degenerateIds = problems
        .filter((p) => p.state === 'DEGENERATE')
        .map((p) => p.commentId);
      const cleaned = removeDegenerateAnchors(markdown, degenerateIds);

      expect(degenerateIds).toEqual(['c1', 'c3']);
      expect(cleaned).not.toContain('anchor:c1');
      expect(cleaned).toContain('anchor:c2:start');
      expect(cleaned).toContain('anchor:c2:end');
      expect(cleaned).not.toContain('anchor:c3');
    });
  });
});
