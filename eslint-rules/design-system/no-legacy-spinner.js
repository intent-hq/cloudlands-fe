import { isWithin, relativeFilename, svelteElementName } from './common.js';

const allowedDirectory = 'src/lib/components/ui/indicators';
const spinClass = /(?:^|[\s"'`])(?:[^\s:"'`]+:)*animate-spin(?=$|[\s"'`])/;

function importedName(specifier) {
  return specifier.imported?.name ?? specifier.imported?.value;
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use the shared Intent loading indicator' },
    schema: [],
    messages: {
      legacyIcon: 'Use `IntentMarkLoader` instead — /sandbox/spinner',
      legacyComponent: 'Use `IntentMarkLoader` instead — /sandbox/spinner',
      spinClass: 'Use `IntentMarkLoader` instead — /sandbox/spinner',
    },
  },
  create(context) {
    const filename = relativeFilename(context);
    if (
      !filename.startsWith('src/') ||
      !filename.endsWith('.svelte') ||
      isWithin(filename, allowedDirectory)
    ) {
      return {};
    }

    const spinnerComponentNames = new Set(['SpinnerIcon']);
    const reportSpinClass = (node, value) => {
      if (typeof value === 'string' && spinClass.test(value)) {
        context.report({ node, messageId: 'spinClass' });
      }
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const spinnerModule =
          typeof source === 'string' && /(?:^|\/)SpinnerIcon(?:\.svelte)?$/.test(source);
        for (const specifier of node.specifiers) {
          if (importedName(specifier) === 'faSpinner') {
            context.report({ node: specifier, messageId: 'legacyIcon' });
          }
          if (
            spinnerModule ||
            importedName(specifier) === 'SpinnerIcon' ||
            specifier.local?.name === 'SpinnerIcon'
          ) {
            spinnerComponentNames.add(specifier.local.name);
            context.report({ node: specifier, messageId: 'legacyComponent' });
          }
        }
      },
      SvelteElement(node) {
        if (spinnerComponentNames.has(svelteElementName(node))) {
          context.report({ node, messageId: 'legacyComponent' });
        }
      },
      SvelteDirective(node) {
        if (
          node.kind === 'Class' &&
          /^class:animate-spin(?:=|$)/.test(context.sourceCode.getText(node))
        ) {
          context.report({ node, messageId: 'spinClass' });
        }
      },
      Literal(node) {
        reportSpinClass(node, node.value);
      },
      SvelteLiteral(node) {
        reportSpinClass(node, node.value);
      },
      TemplateElement(node) {
        reportSpinClass(node, node.value?.raw);
      },
    };
  },
};
