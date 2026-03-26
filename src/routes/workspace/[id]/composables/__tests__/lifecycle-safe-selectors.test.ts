/**
 * Regression test: workspace-page composables must not use lifecycle-sensitive
 * selector access patterns inside event handlers or callbacks.
 *
 * Rules enforced (from AGENTS.md / STATE_MANAGEMENT.md):
 *   1. Never call `selector()` (the readable form) inside event handlers —
 *      it uses Svelte's getContext() which is only valid at component init.
 *   2. Never call `getDispatch()` inside event handlers — same reason.
 *   3. For one-time state reads in handlers, use `selector.select(getReduxStore().getState(), ...args)`.
 *   4. `getDispatch()` and readable selectors at the TOP of a composable function
 *      body are safe because the composable is called during component init.
 *
 * This test reads the source files and checks that event handler bodies
 * (inside addEventListener callbacks) do not contain unsafe patterns.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPOSABLES_DIR = path.resolve(__dirname, '..');
const PAGE_FILE = path.resolve(COMPOSABLES_DIR, '..', '+page.svelte');

/**
 * Extract the bodies of event handler callbacks registered via addEventListener.
 * Returns an array of { file, handlerName, body } objects.
 */
function extractEventHandlerBodies(source: string): string[] {
  const bodies: string[] = [];

  // Match patterns like: window.addEventListener('event-name', handlerFn);
  // Then find the handler function definition in the source
  const listenerPattern = /window\.addEventListener\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  let match;
  while ((match = listenerPattern.exec(source)) !== null) {
    const handlerName = match[2];
    // Find the handler function body — look for const/function/async function declarations
    const fnPattern = new RegExp(
      `(?:const|let|var)\\s+${handlerName}\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>\\s*\\{([\\s\\S]*?)\\n\\s{4}\\};|` +
        `(?:async\\s+)?function\\s+${handlerName}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s{2}\\}`,
      'm',
    );
    const fnMatch = fnPattern.exec(source);
    if (fnMatch) {
      bodies.push(fnMatch[1] || fnMatch[2] || '');
    }
  }

  return bodies;
}

/**
 * Check that a code block does not contain lifecycle-sensitive calls.
 * Returns an array of violation descriptions.
 */
function findLifecycleViolations(code: string): string[] {
  const violations: string[] = [];

  // Pattern 1: calling getDispatch() inside a handler (not at top of composable)
  if (/\bgetDispatch\(\)/.test(code)) {
    violations.push('getDispatch() called inside event handler');
  }

  // Pattern 2: calling a selector in readable form (e.g. selectFoo() without .select)
  // This matches selectXxx( but NOT selectXxx.select( or selectXxx.effect(
  const selectorCallPattern = /\bselect\w+\([^.)]/;
  if (selectorCallPattern.test(code)) {
    // Exclude .select() and .effect() calls which are safe
    const lines = code.split('\n');
    for (const line of lines) {
      if (selectorCallPattern.test(line) && !line.includes('.select(') && !line.includes('.effect(')) {
        violations.push(`Possible readable selector call in handler: ${line.trim()}`);
      }
    }
  }

  return violations;
}

describe('lifecycle-safe selector access in workspace-page composables', () => {
  const composableFiles = fs
    .readdirSync(COMPOSABLES_DIR)
    .filter((f) => f.endsWith('.svelte.ts') || f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.test.ts'))
    .map((f) => path.join(COMPOSABLES_DIR, f));

  for (const filePath of composableFiles) {
    const fileName = path.basename(filePath);

    it(`${fileName}: event handlers must not use lifecycle-sensitive selector access`, () => {
      const source = fs.readFileSync(filePath, 'utf-8');
      const handlerBodies = extractEventHandlerBodies(source);

      const allViolations: string[] = [];
      for (const body of handlerBodies) {
        allViolations.push(...findLifecycleViolations(body));
      }

      expect(allViolations, `Lifecycle violations in ${fileName}`).toEqual([]);
    });
  }

  it('+page.svelte: event handlers must not use lifecycle-sensitive selector access', () => {
    const source = fs.readFileSync(PAGE_FILE, 'utf-8');
    const handlerBodies = extractEventHandlerBodies(source);

    const allViolations: string[] = [];
    for (const body of handlerBodies) {
      allViolations.push(...findLifecycleViolations(body));
    }

    expect(allViolations, 'Lifecycle violations in +page.svelte').toEqual([]);
  });

  it('+page.svelte: template must not use one-shot .select() for reactive props', () => {
    const source = fs.readFileSync(PAGE_FILE, 'utf-8');

    // Find the template section (after </script>)
    const templateStart = source.lastIndexOf('</script>');
    if (templateStart === -1) return;
    const template = source.slice(templateStart);

    // Check for inline .select(getReduxStore().getState() calls in template props
    // These are one-shot reads that won't react to Redux state changes
    const inlineSelectPattern = /\w+\.select\(\s*getReduxStore\(\)\.getState\(\)/g;
    const matches = template.match(inlineSelectPattern) || [];

    expect(
      matches,
      'Template should not use inline .select(getReduxStore().getState()) for reactive props. ' +
        'Use a readable selector at component init time instead.',
    ).toEqual([]);
  });
});

