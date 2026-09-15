const nativeMethods = new Set(['alert', 'confirm', 'prompt']);

const globalObjects = new Set(['window', 'globalThis', 'self']);

function isGlobalIdentifier(node, context) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (variable) return variable.defs.length === 0;
  }
  return true;
}

function nativeDialogCall(node, context) {
  const callee = node.callee;
  if (callee?.type === 'Identifier') {
    return nativeMethods.has(callee.name) && isGlobalIdentifier(callee, context);
  }
  if (callee?.type !== 'MemberExpression') return false;
  const method = callee.computed
    ? callee.property?.type === 'Literal' && callee.property.value
    : callee.property?.type === 'Identifier' && callee.property.name;
  return (
    callee.object?.type === 'Identifier' &&
    globalObjects.has(callee.object.name) &&
    isGlobalIdentifier(callee.object, context) &&
    nativeMethods.has(method)
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
        if (nativeDialogCall(node, context)) context.report({ node, messageId: 'nativeDialog' });
      },
    };
  },
};
