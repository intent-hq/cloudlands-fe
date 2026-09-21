/**
 * Class Name Utility
 *
 * Utility for combining class names with conditional logic
 */

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'type-caption',
        'type-body',
        'type-title',
        'type-display',
        'type-code',
        'text-ui',
        'text-ui-sm',
        'text-xs',
      ],
    },
  },
});

/**
 * Combine and merge Tailwind CSS classes intelligently.
 * Uses clsx for conditional classes and tailwind-merge to resolve conflicts.
 *
 * @param inputs - Class values to combine (strings, objects, arrays)
 * @returns Merged class string with conflicts resolved
 * @example
 * ```typescript
 * // Basic usage
 * cn('px-4', 'py-2', 'bg-blue-500')
 *
 * // Conditional classes
 * cn('base-class', isActive && 'active-class')
 *
 * // Object syntax
 * cn({
 *   'bg-red-500': hasError,
 *   'bg-green-500': isSuccess
 * })
 *
 * // Overriding classes (tailwind-merge handles conflicts)
 * cn('px-4', 'px-8') // Returns 'px-8'
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
