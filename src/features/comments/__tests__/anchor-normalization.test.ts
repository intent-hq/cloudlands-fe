/**
 * Tests for anchor position normalization
 *
 * These tests verify that anchors are moved to after markdown control symbols
 * to prevent breaking markdown syntax.
 */

import { describe, it, expect } from 'vitest';
import { normalizeAnchorPositions } from '$lib/utils/anchor-normalization';

describe('normalizeAnchorPositions', () => {
  describe('headings', () => {
    it('should move anchor after heading marker', () => {
      const input = '<!--anchor:id:start-->## Title<!--anchor:id:end-->';
      const expected = '## <!--anchor:id:start-->Title<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should handle all heading levels', () => {
      const cases = [
        [
          '<!--anchor:id:start--># H1<!--anchor:id:end-->',
          '# <!--anchor:id:start-->H1<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->## H2<!--anchor:id:end-->',
          '## <!--anchor:id:start-->H2<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->### H3<!--anchor:id:end-->',
          '### <!--anchor:id:start-->H3<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->#### H4<!--anchor:id:end-->',
          '#### <!--anchor:id:start-->H4<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->##### H5<!--anchor:id:end-->',
          '##### <!--anchor:id:start-->H5<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->###### H6<!--anchor:id:end-->',
          '###### <!--anchor:id:start-->H6<!--anchor:id:end-->',
        ],
      ];

      for (const [input, expected] of cases) {
        expect(normalizeAnchorPositions(input)).toBe(expected);
      }
    });

    it('should handle multiple nested anchors', () => {
      const input =
        '<!--anchor:outer:start--><!--anchor:inner:start-->## Title<!--anchor:inner:end--><!--anchor:outer:end-->';
      const expected =
        '## <!--anchor:outer:start--><!--anchor:inner:start-->Title<!--anchor:inner:end--><!--anchor:outer:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should not modify headings with anchors already after marker', () => {
      const input = '## <!--anchor:id:start-->Title<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(input);
    });

    it('should not modify headings with anchors in the middle', () => {
      const input = '## Some <!--anchor:id:start-->Title<!--anchor:id:end--> Text';
      expect(normalizeAnchorPositions(input)).toBe(input);
    });
  });

  describe('unordered lists', () => {
    it('should move anchor after dash marker', () => {
      const input = '<!--anchor:id:start-->- List item<!--anchor:id:end-->';
      const expected = '- <!--anchor:id:start-->List item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should move anchor after asterisk marker', () => {
      const input = '<!--anchor:id:start-->* List item<!--anchor:id:end-->';
      const expected = '* <!--anchor:id:start-->List item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should handle indented list items', () => {
      const input = '   <!--anchor:id:start-->- Nested item<!--anchor:id:end-->';
      const expected = '   - <!--anchor:id:start-->Nested item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should not modify lists with anchors already after marker', () => {
      const input = '- <!--anchor:id:start-->List item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(input);
    });
  });

  describe('ordered lists', () => {
    it('should move anchor after number marker', () => {
      const input = '<!--anchor:id:start-->1. List item<!--anchor:id:end-->';
      const expected = '1. <!--anchor:id:start-->List item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should handle different numbers', () => {
      const cases = [
        [
          '<!--anchor:id:start-->1. Item<!--anchor:id:end-->',
          '1. <!--anchor:id:start-->Item<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->2. Item<!--anchor:id:end-->',
          '2. <!--anchor:id:start-->Item<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->10. Item<!--anchor:id:end-->',
          '10. <!--anchor:id:start-->Item<!--anchor:id:end-->',
        ],
        [
          '<!--anchor:id:start-->999. Item<!--anchor:id:end-->',
          '999. <!--anchor:id:start-->Item<!--anchor:id:end-->',
        ],
      ];

      for (const [input, expected] of cases) {
        expect(normalizeAnchorPositions(input)).toBe(expected);
      }
    });

    it('should handle indented ordered lists', () => {
      const input = '   <!--anchor:id:start-->1. Nested item<!--anchor:id:end-->';
      const expected = '   1. <!--anchor:id:start-->Nested item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });
  });

  describe('task lists', () => {
    it('should move anchor after unchecked task marker', () => {
      const input = '<!--anchor:id:start-->- [ ] Task item<!--anchor:id:end-->';
      const expected = '- [ ] <!--anchor:id:start-->Task item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should move anchor after checked task marker', () => {
      const input = '<!--anchor:id:start-->- [x] Task item<!--anchor:id:end-->';
      const expected = '- [x] <!--anchor:id:start-->Task item<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should handle indented task lists', () => {
      const input = '   <!--anchor:id:start-->- [ ] Nested task<!--anchor:id:end-->';
      const expected = '   - [ ] <!--anchor:id:start-->Nested task<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });
  });

  describe('blockquotes', () => {
    it('should move anchor after blockquote marker', () => {
      const input = '<!--anchor:id:start-->> Quote text<!--anchor:id:end-->';
      const expected = '> <!--anchor:id:start-->Quote text<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should handle indented blockquotes', () => {
      const input = '   <!--anchor:id:start-->> Quote<!--anchor:id:end-->';
      const expected = '   > <!--anchor:id:start-->Quote<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });
  });

  describe('code blocks', () => {
    it('should move anchor after code fence', () => {
      const input = '<!--anchor:id:start-->```<!--anchor:id:end-->';
      const expected = '```<!--anchor:id:start--><!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(expected);
    });
  });

  describe('paragraphs', () => {
    it('should not modify paragraphs with anchors at start', () => {
      const input = '<!--anchor:id:start-->Regular paragraph text<!--anchor:id:end-->';
      expect(normalizeAnchorPositions(input)).toBe(input);
    });

    it('should not modify paragraphs with anchors in middle', () => {
      const input = 'Some <!--anchor:id:start-->text<!--anchor:id:end--> here';
      expect(normalizeAnchorPositions(input)).toBe(input);
    });
  });

  describe('multi-line documents', () => {
    it('should normalize multiple lines independently', () => {
      const input = `<!--anchor:1:start-->## Heading<!--anchor:1:end-->

<!--anchor:2:start-->- List item<!--anchor:2:end-->

Regular paragraph with <!--anchor:3:start-->inline<!--anchor:3:end--> anchor`;

      const expected = `## <!--anchor:1:start-->Heading<!--anchor:1:end-->

- <!--anchor:2:start-->List item<!--anchor:2:end-->

Regular paragraph with <!--anchor:3:start-->inline<!--anchor:3:end--> anchor`;

      expect(normalizeAnchorPositions(input)).toBe(expected);
    });

    it('should handle real-world example from bug report', () => {
      const input = `# <!--anchor:cmt-1:start-->Syncthing Prototype<!--anchor:cmt-1:end--> Specification

## Overview

<!--anchor:cmt-2:start-->Lorem ipsum<!--anchor:cmt-2:end-->

<!--anchor:cmt-3:start-->## Goals<!--anchor:cmt-3:end-->

<!--anchor:cmt-4:start-->## Discussion<!--anchor:cmt-4:end-->`;

      const expected = `# <!--anchor:cmt-1:start-->Syncthing Prototype<!--anchor:cmt-1:end--> Specification

## Overview

<!--anchor:cmt-2:start-->Lorem ipsum<!--anchor:cmt-2:end-->

## <!--anchor:cmt-3:start-->Goals<!--anchor:cmt-3:end-->

## <!--anchor:cmt-4:start-->Discussion<!--anchor:cmt-4:end-->`;

      expect(normalizeAnchorPositions(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(normalizeAnchorPositions('')).toBe('');
    });

    it('should handle string with no anchors', () => {
      const input = '## Heading\n\n- List item';
      expect(normalizeAnchorPositions(input)).toBe(input);
    });

    it('should handle anchors with various comment IDs', () => {
      const cases = [
        ['<!--anchor:cmt-123:start-->## Title', '## <!--anchor:cmt-123:start-->Title'],
        ['<!--anchor:uuid-abc-def:start-->## Title', '## <!--anchor:uuid-abc-def:start-->Title'],
        [
          '<!--anchor:259ebe28-02ab-49e0-9034-851954dac0cc:start-->## Title',
          '## <!--anchor:259ebe28-02ab-49e0-9034-851954dac0cc:start-->Title',
        ],
      ];

      for (const [input, expected] of cases) {
        expect(normalizeAnchorPositions(input)).toBe(expected);
      }
    });
  });
});
