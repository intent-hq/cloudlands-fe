import { isWithin, relativeFilename } from './common.js';

const restrictedSources = new Set(['svelte/motion', 'svelte/transition']);

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Route animation through the shared motion tiers' },
    schema: [],
    messages: { adhocTransition: 'Use `motion tiers` instead — /sandbox/motion' },
  },
  create(context) {
    if (isWithin(relativeFilename(context), 'src/lib/motion')) return {};
    const reportSource = (node, source) => {
      if (restrictedSources.has(source)) context.report({ node, messageId: 'adhocTransition' });
    };
    return {
      ImportDeclaration(node) {
        reportSource(node, node.source.value);
      },
      ImportExpression(node) {
        reportSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) reportSource(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        reportSource(node, node.source.value);
      },
    };
  },
};
