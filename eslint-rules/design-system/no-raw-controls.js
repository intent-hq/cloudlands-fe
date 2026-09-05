import fs from 'node:fs';
import path from 'node:path';
import { isWithin, packageRoot, relativeFilename, svelteElementName } from './common.js';

const policy = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'scripts/ui-component-raw-element-allowlist.json')),
);
const exceptions = new Map();
for (const entry of policy.exceptions) {
  exceptions.set(entry.file, new Set(entry.elements));
}

const replacements = {
  button: 'Button',
  input: 'Input',
  select: 'Select',
  textarea: 'Textarea',
};
const approvedRoots = [
  'button',
  'input',
  'select',
  'textarea',
  'checkbox',
  'switch',
  'toggle',
  'toggle-group',
  'menu',
  'dialog',
  'sheet',
  'combobox',
  'file-input',
  'slider',
].map((family) => `src/lib/components/ui/${family}`);

function isProductionSvelteSource(filename) {
  const internalRoute =
    filename.startsWith('src/routes/sandbox/') ||
    filename.startsWith('src/routes/(app)/test-') ||
    filename.includes('/terminal-test/');
  return (
    filename.endsWith('.svelte') &&
    !internalRoute &&
    !filename.includes('/__tests__/') &&
    !/(?:test-harness|Harness|TestWrapper)\.svelte$/.test(filename)
  );
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer design-system controls over raw HTML controls' },
    schema: [],
    messages: {
      rawControl: 'Use `{{replacement}}` instead — /sandbox/{{slug}}',
    },
  },
  create(context) {
    const filename = relativeFilename(context);
    if (!isProductionSvelteSource(filename)) return {};
    return {
      SvelteElement(node) {
        const tag = svelteElementName(node);
        if (!replacements[tag] || node.kind !== 'html') return;
        if (approvedRoots.some((root) => isWithin(filename, root))) return;
        if (exceptions.get(filename)?.has(tag)) return;
        context.report({
          node,
          messageId: 'rawControl',
          data: { replacement: replacements[tag], slug: tag },
        });
      },
    };
  },
};
