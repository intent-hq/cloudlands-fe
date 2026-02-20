/**
 * Tests for accessibility utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkColorContrast, addAriaLabels, makeKeyboardNavigable } from '../accessibility';

// Mock the logger
vi.mock('../client-logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('accessibility utilities', () => {
  describe('checkColorContrast', () => {
    it('should calculate contrast ratio for black and white', () => {
      const result = checkColorContrast('#000000', '#ffffff');
      expect(result.ratio).toBeCloseTo(21, 0);
      expect(result.passes.aa).toBe(true);
      expect(result.passes.aaa).toBe(true);
    });

    it('should calculate contrast ratio for similar colors', () => {
      const result = checkColorContrast('#777777', '#888888');
      expect(result.ratio).toBeLessThan(4.5);
      expect(result.passes.aa).toBe(false);
    });

    it('should handle invalid colors', () => {
      const result = checkColorContrast('invalid', '#ffffff');
      expect(result.ratio).toBe(0);
      expect(result.passes.aa).toBe(false);
      expect(result.passes.aaa).toBe(false);
    });

    it('should pass AA for sufficient contrast', () => {
      // Dark gray on white should pass AA
      const result = checkColorContrast('#595959', '#ffffff');
      expect(result.passes.aa).toBe(true);
    });
  });

  describe('addAriaLabels', () => {
    it('should add aria attributes to element', () => {
      const element = document.createElement('div');
      addAriaLabels(element, {
        label: 'Test label',
        describedby: 'desc-id',
      });
      expect(element.getAttribute('aria-label')).toBe('Test label');
      expect(element.getAttribute('aria-describedby')).toBe('desc-id');
    });
  });

  describe('makeKeyboardNavigable', () => {
    it('should add tabindex to element', () => {
      const element = document.createElement('div');
      makeKeyboardNavigable(element);
      expect(element.getAttribute('tabindex')).toBe('0');
    });

    it('should not override existing tabindex', () => {
      const element = document.createElement('div');
      element.setAttribute('tabindex', '1');
      makeKeyboardNavigable(element);
      expect(element.getAttribute('tabindex')).toBe('1');
    });

    it('should add role if provided', () => {
      const element = document.createElement('div');
      makeKeyboardNavigable(element, { role: 'button' });
      expect(element.getAttribute('role')).toBe('button');
    });

    it('should add aria-label if provided', () => {
      const element = document.createElement('div');
      makeKeyboardNavigable(element, { label: 'Click me' });
      expect(element.getAttribute('aria-label')).toBe('Click me');
    });
  });
});
