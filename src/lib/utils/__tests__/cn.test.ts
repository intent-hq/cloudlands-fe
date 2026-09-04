/**
 * Tests for cn (class name) utility
 */

import { describe, it, expect } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
  it('should combine simple class names', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('should handle conditional classes', () => {
    expect(cn('base', true && 'active')).toBe('base active');
    expect(cn('base', false && 'active')).toBe('base');
  });

  it('should handle object syntax', () => {
    expect(cn({ 'bg-red-500': true, 'bg-green-500': false })).toBe('bg-red-500');
  });

  it('should merge conflicting Tailwind classes', () => {
    expect(cn('px-4', 'px-8')).toBe('px-8');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('should handle arrays', () => {
    expect(cn(['px-4', 'py-2'])).toBe('px-4 py-2');
  });

  it('should handle undefined and null', () => {
    expect(cn('base', undefined, null, 'active')).toBe('base active');
  });

  it('should handle empty inputs', () => {
    expect(cn()).toBe('');
    expect(cn('')).toBe('');
  });

  it('should handle complex combinations', () => {
    const isActive = true;
    const hasError = false;
    const result = cn('base-class', isActive && 'active', { error: hasError }, ['px-4', 'py-2']);
    expect(result).toBe('base-class active px-4 py-2');
  });
});
