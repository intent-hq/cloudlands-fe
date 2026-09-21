import postcss from 'postcss';

const uppercaseClass = /(?:^|\s)(?:[^\s:]+:)*!?uppercase!?(?=\s|$)/;

function checkCss(context, text, offset = 0) {
  const root = postcss.parse(text);
  root.walkDecls(/^text-transform$/i, (declaration) => {
    if (!/\buppercase\b/i.test(declaration.value)) return;
    const start = offset + declaration.source.start.offset;
    context.report({
      loc: context.sourceCode.getLocFromIndex(start),
      messageId: 'sentenceCase',
    });
  });
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep renderer labels in sentence case' },
    schema: [],
    messages: { sentenceCase: 'Use `sentence-case labels` instead — /sandbox/tokens' },
  },
  create(context) {
    const checkClass = (node, value) => {
      if (typeof value === 'string' && uppercaseClass.test(value)) {
        context.report({ node, messageId: 'sentenceCase' });
      }
    };
    return {
      Program() {
        if (context.filename.endsWith('.css')) checkCss(context, context.sourceCode.text);
      },
      Literal(node) {
        checkClass(node, node.value);
      },
      TemplateElement(node) {
        checkClass(node, node.value.cooked ?? node.value.raw);
      },
      SvelteLiteral(node) {
        if (node.parent?.type === 'SvelteAttribute' && node.parent.key.name !== 'class') return;
        checkClass(node, node.value);
      },
      SvelteDirective(node) {
        if (node.kind === 'Class' && node.key.name.name === 'uppercase') {
          context.report({ node, messageId: 'sentenceCase' });
        }
      },
      SvelteText(node) {
        if (node.parent?.type === 'SvelteStyleElement') {
          checkCss(context, node.value, node.range[0]);
        }
      },
    };
  },
};
