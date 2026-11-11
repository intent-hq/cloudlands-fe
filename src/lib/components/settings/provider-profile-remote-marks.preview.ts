import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProfileKindPicker from './profile-kinds/ProfileKindPicker.svelte';

/** Add profile, step 1, with remote-ready marks: which kinds work on remote machines. */
export const preview = definePreview<ComponentProps<typeof ProfileKindPicker>>({
  id: 'provider-profile-remote-marks',
  title: 'Provider profile: remote marks on the kind cards',
  defaultState: 'claude',
  states: {
    claude: { props: { provider: 'claude', remoteMarks: true, onPick: () => {} } },
    codex: { props: { provider: 'codex', remoteMarks: true, onPick: () => {} } },
  },
});

export default ProfileKindPicker;
