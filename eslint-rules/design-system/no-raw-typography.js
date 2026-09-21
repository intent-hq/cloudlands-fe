import { isWithin, relativeFilename } from './common.js';

const directories = [
  'src/lib/components/settings',
  'src/routes/(app)/settings',
  'src/lib/components/patterns/settings',
];
const tokens = (value) => (typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);
const utility = (token) => token.split(':').at(-1).replace(/^!|!$/g, '').split('/')[0];

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use typography roles on settings surfaces' },
    schema: [],
    messages: {
      rawSize: 'Use `type-body, type-caption, or type-title` instead — /sandbox/tokens',
      rawWeight: 'Use `a type-* role alongside font-medium` instead — /sandbox/tokens',
    },
  },
  create(context) {
    const filename = relativeFilename(context);
    if (!filename.endsWith('.svelte') || !directories.some((dir) => isWithin(filename, dir))) {
      return {};
    }
    const elements = new Map();
    function collect(node, value) {
      let attribute = node;
      while (attribute && !['SvelteAttribute', 'SvelteDirective'].includes(attribute.type)) {
        attribute = attribute.parent;
      }
      if (!attribute) return;
      const isClass =
        attribute.type === 'SvelteAttribute'
          ? attribute.key.name === 'class'
          : attribute.kind === 'Class';
      if (!isClass) return;
      const element = attribute.parent;
      const entries = elements.get(element) ?? [];
      entries.push(...tokens(value).map((token) => ({ node, token: utility(token) })));
      elements.set(element, entries);
    }
    return {
      SvelteLiteral(node) {
        collect(node, node.value);
      },
      Literal(node) {
        collect(node, node.value);
      },
      TemplateElement(node) {
        collect(node, node.value.raw);
      },
      SvelteDirective(node) {
        if (node.kind === 'Class') collect(node, node.key.name.name);
      },
      'Program:exit'() {
        for (const entries of elements.values()) {
          const hasRole = entries.some(({ token }) => /^type-[\w-]+$/.test(token));
          for (const { node, token } of entries) {
            if (/^text-(xs|sm|base|lg)$/.test(token)) {
              context.report({ node, messageId: 'rawSize' });
            } else if (token === 'font-medium' && !hasRole) {
              context.report({ node, messageId: 'rawWeight' });
            }
          }
        }
      },
    };
  },
};
