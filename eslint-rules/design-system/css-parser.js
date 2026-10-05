// CSS declarations are inspected by the design-system rule using PostCSS.
// Supply an empty ESTree root so ESLint can report against the original CSS source.
export default {
  meta: { name: 'intent-design-system-css', version: '1.0.0' },
  parseForESLint(text) {
    const lines = text.split('\n');
    return {
      ast: {
        type: 'Program',
        body: [],
        sourceType: 'module',
        tokens: [],
        comments: [],
        range: [0, text.length],
        loc: {
          start: { line: 1, column: 0 },
          end: { line: lines.length, column: lines.at(-1).length },
        },
      },
    };
  },
};
