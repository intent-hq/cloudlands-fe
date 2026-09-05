const arbitraryUtility = /(?:duration-\[(?!var\()|ease-\[(?!var\()|bg-\[#|text-\[#)/;

function reportIfArbitrary(context, node, value) {
  if (typeof value === 'string' && arbitraryUtility.test(value)) {
    context.report({ node, messageId: 'arbitraryToken' });
  }
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer design tokens over arbitrary motion and color utilities' },
    schema: [],
    messages: { arbitraryToken: 'Use `design tokens` instead — /sandbox/tokens' },
  },
  create(context) {
    return {
      Literal(node) {
        reportIfArbitrary(context, node, node.value);
      },
      SvelteLiteral(node) {
        reportIfArbitrary(context, node, node.value);
      },
      TemplateElement(node) {
        reportIfArbitrary(context, node, node.value?.raw);
      },
    };
  },
};
