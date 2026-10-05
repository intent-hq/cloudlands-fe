import { relativeFilename } from './common.js';
import { attribute, menuContract } from './menu-contract.js';

const rowRoles = new Set(['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option']);

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Require semantic menu rows and a canonical row recipe binding' },
    schema: [],
    messages: {
      rawMenuRow: 'Use `menuItem()` instead — /sandbox/menu',
      semanticMenuRow:
        'Use `Menu.Item, Menu.CheckboxItem or Menu.RadioItem` instead — /sandbox/menu',
    },
  },
  create(context) {
    if (!relativeFilename(context)?.endsWith('.svelte')) return {};
    const contract = menuContract(context);
    return {
      SvelteElement(node) {
        if (contract.canonical(node, 'row')) return;
        const role = attribute(node, 'role');
        const roles = contract.values(role).filter((value) => rowRoles.has(value));
        // The canonical collection host delegates row presentation to CollectionRow.
        // Its selectable list items are not compact picker options or menu commands.
        if (
          relativeFilename(context) === 'src/lib/components/patterns/collection/ListView.svelte' &&
          roles.length === 1 &&
          roles[0] === 'option' &&
          contract.values(attribute(node, 'data-slot')).includes('list-view-item')
        )
          return;
        if (!roles.length) {
          if (contract.insideMenu(node) && contract.interactive(node)) {
            context.report({ node, messageId: 'semanticMenuRow' });
          }
          return;
        }
        if (!contract.containsRecipe(attribute(node, 'class'), 'menuItem')) {
          context.report({ node: role, messageId: 'rawMenuRow' });
        }
        if (
          roles.some((value) => value === 'menuitemradio' || value === 'menuitemcheckbox') &&
          !attribute(node, 'aria-checked')
        ) {
          context.report({ node: role, messageId: 'semanticMenuRow' });
        }
      },
    };
  },
};
