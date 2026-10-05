import { svelteElementName } from './common.js';

const aliases = {
  variant: new Map([
    ['default', 'secondary'],
    ['tertiary', 'outline'],
    ['neumorphic', 'outline'],
  ]),
  size: new Map([
    ['xs', 'compact'],
    ['icon-xs', 'icon-compact'],
  ]),
};

function staticAttributeValue(attribute) {
  if (attribute.type !== 'SvelteAttribute' || !Array.isArray(attribute.value)) return undefined;
  if (attribute.value.length !== 1 || attribute.value[0].type !== 'SvelteLiteral') return undefined;
  return attribute.value[0].value;
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer canonical Button emphasis and size names' },
    schema: [],
    messages: {
      compatibilityAlias: 'Use `{{prop}}="{{replacement}}"` instead — /sandbox/button',
    },
  },
  create(context) {
    const buttonNames = new Set();
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          source !== '$lib/components/ui/button' &&
          source !== '$lib/components/ui/button/index.js' &&
          !source.endsWith('/ui/button/button.svelte')
        ) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportDefaultSpecifier' ||
            (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'Button')
          ) {
            buttonNames.add(specifier.local.name);
          }
        }
      },
      SvelteElement(node) {
        if (!buttonNames.has(svelteElementName(node))) return;
        for (const attribute of node.startTag.attributes) {
          const prop = attribute.key?.name;
          if (!(prop in aliases)) continue;
          const replacement = aliases[prop].get(staticAttributeValue(attribute));
          if (replacement) {
            context.report({
              node: attribute,
              messageId: 'compatibilityAlias',
              data: { prop, replacement },
            });
          }
        }
      },
    };
  },
};
