import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { m } from '$shared/paraglide/messages.js';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import {
  codexApiKeyAdd,
  codexApiKeyEdit,
  FAKE_OPENAI_KEY,
} from './profile-kinds/profile-kind.preview-fixtures';

/**
 * Codex API key (add + edit): OpenAI Platform steps, masked key, key check.
 * On an orchestrator (`keyCheck: false`) the key's format is checked instead.
 */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-codex-api-key',
  title: 'Provider profile: Codex API key',
  defaultState: 'add',
  states: {
    add: { props: { ...codexApiKeyAdd } },
    'add-filled': { props: { ...codexApiKeyAdd, secret: FAKE_OPENAI_KEY } },
    'empty-key-error': {
      props: {
        ...codexApiKeyAdd,
        secretError: m.settings_providerProfileKinds_keyRequired_error(),
      },
    },
    checking: {
      props: { ...codexApiKeyAdd, secret: FAKE_OPENAI_KEY, signIn: { status: 'checkingKey' } },
    },
    'key-works': {
      props: { ...codexApiKeyAdd, secret: FAKE_OPENAI_KEY, signIn: { status: 'keyWorks' } },
    },
    'key-rejected': {
      props: { ...codexApiKeyAdd, secret: FAKE_OPENAI_KEY, signIn: { status: 'keyRejected' } },
    },
    'orchestrator-add': { props: { ...codexApiKeyAdd, keyCheck: false } },
    'orchestrator-shape-error': {
      props: {
        ...codexApiKeyAdd,
        keyCheck: false,
        secret: 'not-a-key',
        secretError: m.settings_providerProfileKinds_keyShapeCodex_error(),
      },
    },
    edit: { props: { ...codexApiKeyEdit } },
    'edit-replacing': {
      props: { ...codexApiKeyEdit, replacingSecret: true, secret: FAKE_OPENAI_KEY },
    },
  },
});

export default ProviderProfileKindDialog;
