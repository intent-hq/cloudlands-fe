import { relativeFilename } from './common.js';
import { attribute, menuContract } from './menu-contract.js';

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Require the canonical shell for renderer-owned command menus' },
    schema: [],
    messages: { rawMenuSurface: 'Use `Menu.Content or menuOverlay()` instead — /sandbox/menu' },
  },
  create(context) {
    if (!relativeFilename(context)?.endsWith('.svelte')) return {};
    const contract = menuContract(context);
    return {
      SvelteElement(node) {
        if (contract.canonical(node, 'surface')) return;
        const isMenu = contract.values(attribute(node, 'role')).includes('menu');
        if (!isMenu && !contract.primitiveSurface(node)) return;
        if (!contract.containsRecipe(attribute(node, 'class'), 'menuOverlay')) {
          context.report({ node, messageId: 'rawMenuSurface' });
        }
      },
    };
  },
};
