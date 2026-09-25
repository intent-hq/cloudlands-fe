import { isWithin, relativeFilename, svelteElementName } from './common.js';

const replacements = {
  button: 'Button',
  input: 'Input',
  select: 'Select',
  textarea: 'Textarea',
};
const approvedRoots = [
  ...[
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
  ].map((family) => `src/lib/components/ui/${family}`),
  'src/lib/components/ui/sidebar/sidebar-rail.svelte',
  'src/lib/components/ui/sidebar/sidebar-menu-button.svelte',
];

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
        context.report({
          node,
          messageId: 'rawControl',
          data: { replacement: replacements[tag], slug: tag },
        });
      },
    };
  },
};
