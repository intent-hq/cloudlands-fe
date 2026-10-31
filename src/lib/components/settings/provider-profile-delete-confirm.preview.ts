import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProfileDeleteConfirm from './profile-kinds/ProfileDeleteConfirm.svelte';

/** Remove confirmation: Different login names the folder left on disk; other kinds unchanged. */
export const preview = definePreview<ComponentProps<typeof ProfileDeleteConfirm>>({
  id: 'provider-profile-delete-confirm',
  title: 'Provider profile: delete confirmation',
  defaultState: 'claude-different-login',
  states: {
    'claude-different-login': {
      props: {
        open: true,
        static: true,
        profileName: 'Work account',
        folderPath: '~/intent/profiles/claude/work-account-k3f9',
      },
    },
    'codex-different-login': {
      props: {
        open: true,
        static: true,
        profileName: 'Personal',
        folderPath: '~/intent/profiles/codex/personal-7h2m',
      },
    },
    'other-kind': { props: { open: true, static: true, profileName: 'Anthropic key' } },
  },
});

export default ProfileDeleteConfirm;
