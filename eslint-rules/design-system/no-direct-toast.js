import { isWithin, relativeFilename } from './common.js';

const allowedDirectories = ['src/lib/components/patterns/notify', 'src/lib/components/ui/toast'];

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Route toast notifications through the notify pattern' },
    schema: [],
    messages: { directToast: 'Use `notify` instead — /sandbox/notify' },
  },
  create(context) {
    const filename = relativeFilename(context);
    if (allowedDirectories.some((directory) => isWithin(filename, directory))) return {};
    const reportSource = (node, source) => {
      if (source === 'svelte-sonner') context.report({ node, messageId: 'directToast' });
    };
    return {
      ImportDeclaration(node) {
        reportSource(node, node.source.value);
      },
      ImportExpression(node) {
        reportSource(node, node.source.value);
      },
    };
  },
};
