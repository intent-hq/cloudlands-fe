import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import { codexApiKeyAdd } from './profile-kinds/profile-kind.preview-fixtures';

/** Codex API key (add): a folder profile signed in with `codex login --with-api-key`. */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-codex-api-key',
  title: 'Provider profile: Codex API key',
  defaultState: 'add',
  states: {
    add: { props: { ...codexApiKeyAdd } },
    waiting: { props: { ...codexApiKeyAdd, signIn: { status: 'waiting' } } },
    'still-waiting': { props: { ...codexApiKeyAdd, signIn: { status: 'stillWaiting' } } },
    'checking-key': { props: { ...codexApiKeyAdd, signIn: { status: 'checkingKey' } } },
    'key-works': { props: { ...codexApiKeyAdd, signIn: { status: 'keyWorks' } } },
    'key-rejected': { props: { ...codexApiKeyAdd, signIn: { status: 'keyRejected' } } },
    'duplicate-name': {
      props: {
        ...codexApiKeyAdd,
        nameError: 'Another Codex profile already uses this name.', // i18n-ignore (fake preview data)
      },
    },
    'terminal-failed': {
      props: { ...codexApiKeyAdd, setupError: { kind: 'terminalFailed' } },
    },
  },
});

export default ProviderProfileKindDialog;
