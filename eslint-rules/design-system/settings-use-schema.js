import { isWithin, relativeFilename } from './common.js';

function isUiPrimitiveImport(source) {
  return (
    typeof source === 'string' &&
    (source === '$lib/components/ui' ||
      source.startsWith('$lib/components/ui/') ||
      source === '@/lib/components/ui' ||
      source.startsWith('@/lib/components/ui/') ||
      /^(?:\.\.\/)+ui(?:\/|$)/.test(source))
  );
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Build settings components from typed settings schemas' },
    schema: [],
    messages: { directPrimitive: 'Use `defineSettings` instead — /sandbox/settings' },
  },
  create(context) {
    if (!isWithin(relativeFilename(context), 'src/lib/components/settings')) return {};
    return {
      ImportDeclaration(node) {
        if (isUiPrimitiveImport(node.source.value)) {
          context.report({ node, messageId: 'directPrimitive' });
        }
      },
    };
  },
};
