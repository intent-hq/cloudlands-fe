import { relativeFilename, svelteElementName } from './common.js';

const rowElements = new Set(['Button', 'button', 'div']);
const rowRoles = new Set(['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option']);

function staticAttributeValue(attribute) {
  if (attribute?.type !== 'SvelteAttribute' || !Array.isArray(attribute.value)) return undefined;
  if (attribute.value.length !== 1 || attribute.value[0].type !== 'SvelteLiteral') return undefined;
  return attribute.value[0].value;
}

function findAttribute(node, name) {
  return node.startTag.attributes.find(
    (attribute) => attribute.type === 'SvelteAttribute' && attribute.key?.name === name,
  );
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Require the shared menu row recipe for menu and listbox rows' },
    schema: [],
    messages: { rawMenuRow: 'Use `menuItem()` instead — /sandbox/menu' },
  },
  create(context) {
    if (!relativeFilename(context)?.endsWith('.svelte')) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      SvelteElement(node) {
        if (!rowElements.has(svelteElementName(node))) return;
        const role = findAttribute(node, 'role');
        if (!rowRoles.has(staticAttributeValue(role))) return;
        const classAttribute = findAttribute(node, 'class');
        if (classAttribute && /\bmenuItem\s*\(/.test(sourceCode.getText(classAttribute))) return;
        context.report({ node: role, messageId: 'rawMenuRow' });
      },
    };
  },
};
