import { parsePatternMetadata } from '../pattern-metadata';
import { actionMenuFixtures } from './action-menu.fixtures';

export const actionMenuMetadata = parsePatternMetadata({
  id: 'action-menu',
  source: 'src/lib/components/patterns/action-menu/index.ts',
  publicImport: '$lib/components/patterns/action-menu',
  exports: ['ActionBar', 'ActionMenu', 'defineActions', 'resolveActions', 'splitActions'],
  owner: 'design-system',
  fixtures: actionMenuFixtures,
  useWhen: [
    'One command definition must drive inline, overflow, and context menu presentations.',
    'Actions need declarative visibility, grouping, shortcuts, disabled reasons, or submenus.',
  ],
  dontUseWhen: [
    'Choosing a persisted value from a form control.',
    'Rendering navigation whose destinations are the primary content.',
  ],
  replaces: ['Callback-bearing menu arrays and duplicated inline/overflow action markup.'],
});
