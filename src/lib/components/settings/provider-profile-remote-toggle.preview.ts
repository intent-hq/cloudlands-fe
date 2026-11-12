import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProfileRemoteToggle from './profile-kinds/ProfileRemoteToggle.svelte';

type Row = ComponentProps<typeof ProfileRemoteToggle>['rows'][number];
const row = (key: string, value: string): Row => ({ rowId: key, key, mode: 'value', value });

/** Advanced profiles: "Use on remote machines" and its warnings. */
export const preview = definePreview<ComponentProps<typeof ProfileRemoteToggle>>({
  id: 'provider-profile-remote-toggle',
  title: 'Provider profile: Use on remote machines (Advanced)',
  defaultState: 'on',
  states: {
    on: {
      props: {
        rows: [row('ANTHROPIC_BASE_URL', 'https://llm.example.com')],
        checked: true,
      },
    },
    warnings: {
      props: {
        rows: [
          row('GOOGLE_APPLICATION_CREDENTIALS', '~/gcp/key.json'),
          row('AWS_PROFILE', 'work'),
          row('CLAUDE_CODE_API_KEY_HELPER_TTL_MS', '60000'),
          row('ANTHROPIC_BASE_URL', 'http://localhost:4000'),
        ],
        checked: true,
      },
    },
    off: {
      props: { rows: [row('GOOGLE_APPLICATION_CREDENTIALS', '~/gcp/key.json')], checked: false },
    },
    'account-folder': { props: { rows: [row('CODEX_HOME', '~/.codex-second')], checked: true } },
  },
});

export default ProfileRemoteToggle;
