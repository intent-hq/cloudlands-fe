/**
 * Svelte Error Resolver
 *
 * Resolves Svelte's URL-based error messages to human-readable descriptions
 * with debugging tips. Svelte 5 uses URLs like https://svelte.dev/e/each_key_duplicate
 * to reduce bundle size.
 */

export interface SvelteErrorInfo {
  code: string;
  title: string;
  description: string;
  debuggingTips: string[];
  commonCauses: string[];
  docsUrl: string;
}

// Map of Svelte error codes to human-readable descriptions
const SVELTE_ERRORS: Record<string, Omit<SvelteErrorInfo, 'code' | 'docsUrl'>> = {
  each_key_duplicate: {
    title: 'Duplicate Key in {#each} Block',
    description:
      'Two or more items in an {#each} block have the same key. Keys must be unique so Svelte can track which items changed.',
    debuggingTips: [
      'Check your {#each} block for the (key) expression - e.g., {#each items as item (item.id)}',
      'Log the array being iterated to find duplicate key values',
      'Ensure IDs are actually unique - check for undefined, null, or empty string keys',
      'If using index as key, items may be getting reordered or duplicated',
      'Look for race conditions where the array is updated with duplicate entries',
    ],
    commonCauses: [
      'Array has items with the same id/key property',
      'Key expression returns undefined or null for some items',
      'Data was merged incorrectly, creating duplicates',
      'Optimistic updates added an item that already existed',
    ],
  },
  effect_update_depth_exceeded: {
    title: 'Effect Update Depth Exceeded',
    description:
      'An effect triggered too many re-renders. This usually means a $effect or $derived is causing infinite updates.',
    debuggingTips: [
      'Look for $effect blocks that modify state they also read from',
      'Check $derived values that trigger effects which update their dependencies',
      'Use untrack() to read values without creating dependencies',
      'Consider using $effect.pre for DOM measurements before updates',
    ],
    commonCauses: [
      '$effect writes to state it reads from, creating a loop',
      'Component props change triggers effect that updates parent',
      '$derived depends on $state that gets updated in $effect',
    ],
  },
  state_unsafe_mutation: {
    title: 'Unsafe State Mutation',
    description:
      'State was mutated in a way that Svelte cannot track. Use $state for reactive variables or reassign the value.',
    debuggingTips: [
      'Instead of array.push(), use array = [...array, newItem]',
      'Instead of object.prop = value, use object = { ...object, prop: value }',
      'For deep mutations, ensure the root $state variable is reassigned',
    ],
    commonCauses: [
      'Direct mutation of arrays (push, pop, splice) without $state',
      'Direct mutation of objects without reassignment',
      'Mutating a value received as a prop',
    ],
  },
  bind_invalid_value: {
    title: 'Invalid Bind Value',
    description: 'A value passed to bind: is not valid for the element or component.',
    debuggingTips: [
      'Check that the bound value type matches the element (e.g., string for input)',
      'Ensure the value is defined before binding',
      'For components, verify the prop accepts bind:',
    ],
    commonCauses: [
      'Binding undefined to an input element',
      'Type mismatch between bound value and element',
    ],
  },
  component_api_changed: {
    title: 'Component API Changed',
    description: 'Using legacy Svelte 4 component instantiation in Svelte 5.',
    debuggingTips: [
      'Use mount() instead of new Component()',
      'Use hydrate() for SSR hydration',
      'Update third-party components to Svelte 5 compatible versions',
    ],
    commonCauses: [
      'Using new Component() syntax from Svelte 4',
      'Importing Svelte 4 components into Svelte 5 project',
    ],
  },
};

// Parse Svelte error URL
const SVELTE_ERROR_URL_REGEX = /https?:\/\/svelte\.dev\/e\/([a-z_]+)/i;

/**
 * Check if an error message is a Svelte error URL
 */
export function isSvelteErrorUrl(message: string): boolean {
  return SVELTE_ERROR_URL_REGEX.test(message);
}

/**
 * Extract the error code from a Svelte error URL
 */
export function extractSvelteErrorCode(message: string): string | null {
  const match = message.match(SVELTE_ERROR_URL_REGEX);
  return match ? match[1] : null;
}

/**
 * Resolve a Svelte error URL to detailed error information
 */
export function resolveSvelteError(message: string): SvelteErrorInfo | null {
  const code = extractSvelteErrorCode(message);
  if (!code) return null;

  const errorInfo = SVELTE_ERRORS[code];
  if (!errorInfo) {
    // Unknown error code - return generic info
    return {
      code,
      title: `Svelte Error: ${code.replace(/_/g, ' ')}`,
      description: 'Svelte runtime error. See documentation for details.',
      debuggingTips: ['Visit the error URL for full documentation', 'Check component source code'],
      commonCauses: ['Check the Svelte documentation for this specific error'],
      docsUrl: `https://svelte.dev/e/${code}`,
    };
  }

  return {
    code,
    ...errorInfo,
    docsUrl: `https://svelte.dev/e/${code}`,
  };
}

/**
 * Format a Svelte error for display with full context
 */
export function formatSvelteError(message: string): string {
  const info = resolveSvelteError(message);
  if (!info) return message;

  const lines = [
    `🔴 ${info.title}`,
    '',
    info.description,
    '',
    '💡 Debugging Tips:',
    ...info.debuggingTips.map((tip) => `  • ${tip}`),
    '',
    '❓ Common Causes:',
    ...info.commonCauses.map((cause) => `  • ${cause}`),
    '',
    `📚 Docs: ${info.docsUrl}`,
  ];

  return lines.join('\n');
}

/**
 * Search patterns to help find the source of specific error types.
 * Returns grep/search patterns that can help locate the issue.
 */
export function getSearchPatternsForError(code: string): string[] {
  switch (code) {
    case 'each_key_duplicate':
      return [
        '{#each.*\\(.*\\)', // Each blocks with keyed expressions
        'as.*,.*\\(', // Destructured each with key
      ];
    case 'effect_update_depth_exceeded':
      return ['\\$effect', '\\$derived'];
    case 'state_unsafe_mutation':
      return ['\\.push\\(', '\\.pop\\(', '\\.splice\\(', '\\$state'];
    default:
      return [];
  }
}

/**
 * Extract any useful context from the error's stack trace or context object.
 * Tries to find component names, file paths, or other identifying information.
 */
export function extractErrorContext(
  stack?: string,
  context?: Record<string, unknown>,
): { likelyComponents: string[]; route: string | null; hints: string[] } {
  const likelyComponents: string[] = [];
  const hints: string[] = [];
  let route: string | null = null;

  // Extract route from URL context
  if (context?.url && typeof context.url === 'string') {
    const urlMatch = context.url.match(/\/workspace\/([^/]+)/);
    if (urlMatch) {
      route = `/workspace/${urlMatch[1]}`;
      hints.push(`Error occurred on route: ${route}`);
    }
  }

  // Look for .svelte files in stack trace (even if marked as dependency, might have source map info)
  if (stack) {
    const svelteMatches = stack.match(/([A-Z][a-zA-Z]+)\.svelte/g);
    if (svelteMatches) {
      const unique = [...new Set(svelteMatches)];
      likelyComponents.push(...unique);
    }

    // Look for src/ paths that might indicate app code
    const srcMatches = stack.match(/src\/[^\s:]+\.svelte/g);
    if (srcMatches) {
      const unique = [...new Set(srcMatches)];
      hints.push(`Possible source files: ${unique.join(', ')}`);
    }
  }

  // For each_key_duplicate, suggest checking components that commonly use {#each}
  // These are heuristics based on common patterns
  if (likelyComponents.length === 0) {
    hints.push(
      'Stack trace shows only Svelte internals. Try adding console.log in suspected components to identify the source.',
    );
  }

  return { likelyComponents, route, hints };
}
