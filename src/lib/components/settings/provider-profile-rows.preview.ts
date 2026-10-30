import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProfileRowsMock from './profile-kinds/ProfileRowsMock.svelte';
import { claudeRows, codexRows, FAKE_EMAIL } from './profile-kinds/profile-kind.preview-fixtures';

const claude = {
  provider: 'claude',
  providerName: 'Claude Code',
  defaultEmail: 'me@personal.dev',
  rows: claudeRows.map((row) => ({ ...row })),
} as const;
const codex = {
  provider: 'codex',
  providerName: 'Codex',
  rows: codexRows.map((row) => ({ ...row })),
} as const;

/** Profile rows: Signed in as <email>, signed-out row, and ⋯ → Log In (Different login only). */
export const preview = definePreview<ComponentProps<typeof ProfileRowsMock>>({
  id: 'provider-profile-rows',
  title: 'Provider profile: rows and ⋯ menu',
  defaultState: 'claude',
  states: {
    claude: { props: { ...claude } },
    'claude-menu-different-login': {
      props: { ...claude, menuOpenFor: 'work', staticMenus: true },
    },
    'claude-menu-signed-out': { props: { ...claude, menuOpenFor: 'side', staticMenus: true } },
    'claude-menu-api-key': { props: { ...claude, menuOpenFor: 'key', staticMenus: true } },
    'claude-default-signed-in': {
      props: { ...claude, defaultEmail: FAKE_EMAIL },
    },
    codex: { props: { ...codex } },
    'codex-menu-different-login': {
      props: { ...codex, menuOpenFor: 'openai-key', staticMenus: true },
    },
    'codex-menu-token': { props: { ...codex, menuOpenFor: 'team', staticMenus: true } },
  },
});

export default ProfileRowsMock;
