import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import { claudeBase, codexBase } from './profile-kinds/profile-kind.preview-fixtures';

/** Add profile, step 1: the four kind cards for each provider (`remote-*`: with remote marks). */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-kind-picker',
  title: 'Provider profile: kind picker',
  defaultState: 'claude',
  states: {
    claude: { props: { ...claudeBase, mode: 'add', step: 'pick' } },
    codex: { props: { ...codexBase, mode: 'add', step: 'pick' } },
    'remote-claude': { props: { ...claudeBase, mode: 'add', step: 'pick', remoteMarks: true } },
    'remote-codex': { props: { ...codexBase, mode: 'add', step: 'pick', remoteMarks: true } },
  },
});

export default ProviderProfileKindDialog;
