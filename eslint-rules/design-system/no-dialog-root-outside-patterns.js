import { isWithin, relativeFilename, svelteElementName } from './common.js';

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep feature dialogs behind the confirm composition patterns' },
    schema: [],
    messages: { dialogRoot: 'Use `FormDialog` instead — /sandbox/confirm' },
  },
  create(context) {
    if (!isWithin(relativeFilename(context), 'src/features')) return {};
    return {
      SvelteElement(node) {
        if (svelteElementName(node) === 'Dialog.Root') {
          context.report({ node, messageId: 'dialogRoot' });
        }
      },
    };
  },
};
