const nativeMethods = new Set(['alert', 'confirm', 'prompt']);

function nativeDialogCall(node) {
  if (node.callee?.type !== 'MemberExpression' || node.callee.computed) return false;
  return (
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'window' &&
    node.callee.property?.type === 'Identifier' &&
    nativeMethods.has(node.callee.property.name)
  );
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer the confirm pattern over browser-native dialogs' },
    schema: [],
    messages: { nativeDialog: 'Use `confirm()` instead — /sandbox/confirm' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (nativeDialogCall(node)) context.report({ node, messageId: 'nativeDialog' });
      },
    };
  },
};
