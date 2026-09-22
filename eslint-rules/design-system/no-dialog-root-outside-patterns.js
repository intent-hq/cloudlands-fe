import { isWithin, relativeFilename, svelteElementName } from './common.js';

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep feature dialogs behind the confirm composition patterns' },
    schema: [],
    messages: { dialogRoot: 'Use `FormDialog` or `ContentDialog` instead — /sandbox/confirm' },
  },
  create(context) {
    const filename = relativeFilename(context);
    if (
      !['src/features', 'src/lib/components', 'src/routes'].some((dir) => isWithin(filename, dir))
    )
      return {};
    if (
      ['src/lib/components/ui', 'src/lib/components/patterns', 'src/routes/sandbox'].some((dir) =>
        isWithin(filename, dir),
      ) ||
      /(?:__tests__|\.test\.|\.spec\.|Harness\.svelte|\.preview\.svelte)/.test(filename)
    )
      return {};
    const roots = new Set(['Dialog.Root']);
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === 'bits-ui') {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'Dialog') {
              roots.add(`${specifier.local.name}.Root`);
            }
          }
          return;
        }
        if (typeof source !== 'string' || !source.includes('components/ui/dialog')) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier')
            roots.add(`${specifier.local.name}.Root`);
          if (
            specifier.type === 'ImportSpecifier' &&
            ['Root', 'Dialog'].includes(specifier.imported.name)
          )
            roots.add(specifier.local.name);
          if (specifier.type === 'ImportDefaultSpecifier' && source.endsWith('/dialog.svelte'))
            roots.add(specifier.local.name);
        }
      },
      SvelteElement(node) {
        const name = svelteElementName(node);
        // These are deliberate non-form modal owners, with dedicated interaction contracts.
        const specialized = [
          'src/lib/components/CommandPalette.svelte',
          'src/features/stats/StatsOverlay.svelte',
          'src/features/daemon-status/DaemonStoppedOverlay.svelte',
          'src/features/daemon-status/DaemonUpdatingOverlay.svelte',
        ].includes(filename);
        const nativeModal =
          /^[a-z]/.test(name ?? '') &&
          !specialized &&
          node.startTag.attributes.some(
            (attribute) =>
              attribute.type === 'SvelteAttribute' &&
              attribute.key.name === 'aria-modal' &&
              attribute.value.some(
                (value) => value.type === 'SvelteLiteral' && value.value === 'true',
              ),
          );
        if (roots.has(name) || nativeModal) {
          context.report({ node, messageId: 'dialogRoot' });
        }
      },
    };
  },
};
