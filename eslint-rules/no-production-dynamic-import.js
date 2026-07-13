const MESSAGE = 'Runtime dynamic imports are not allowed in production modules. Use a top-level static import instead.';

function isDynamicImportCall(node) {
  return node.callee?.type === 'Import';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow runtime dynamic imports in production modules',
    },
    schema: [],
    messages: {
      noDynamicImport: MESSAGE,
    },
  },

  create(context) {
    return {
      ImportExpression(node) {
        context.report({ node, messageId: 'noDynamicImport' });
      },

      CallExpression(node) {
        if (isDynamicImportCall(node)) {
          context.report({ node, messageId: 'noDynamicImport' });
        }
      },
    };
  },
};