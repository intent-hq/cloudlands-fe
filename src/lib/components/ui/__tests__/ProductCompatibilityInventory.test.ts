import { describe, expect, it } from 'vitest';
import { buildUiComponentInventory } from '../../../../../scripts/ui-component-inventory';

const reconciledImports = [
  '$lib/components/ui/FileActionsDropdown.svelte',
  '$lib/components/ui/OpenComboButton.svelte',
  '$lib/components/ui/ProviderIcon.svelte',
  '$lib/components/ui/ViewSettingsDropdown.svelte',
  '$lib/components/ui/WorkspaceActionsMenu.svelte',
  '$lib/components/ui/agent-avatar/AgentAvatar.svelte',
  '$lib/components/ui/agent-avatar/AgentAvatarWithState.svelte',
  '$lib/components/ui/agent-avatar/avatar-state',
  '$lib/components/ui/content-header',
  '$lib/components/ui/diff',
] as const;

describe('product compatibility inventory', () => {
  it('removes every reconciled B8 shim from the public UI inventory', () => {
    const components = buildUiComponentInventory().components;

    for (const publicImport of reconciledImports) {
      expect(
        components.some((entry) => entry.publicImport === publicImport),
        publicImport,
      ).toBe(false);
    }
  });
});
