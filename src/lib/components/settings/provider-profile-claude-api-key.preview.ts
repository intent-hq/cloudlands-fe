import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { m } from '$shared/paraglide/messages.js';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import {
  claudeApiKeyAdd,
  claudeApiKeyEdit,
  claudeApiKeyEditWithEndpoint,
  FAKE_SECRET,
} from './profile-kinds/profile-kind.preview-fixtures';

const GATEWAY_URL = 'https://llm-gateway.acme.internal'; // i18n-ignore (fake preview data)

/** Claude API key (add + edit): masked key, steps, optional Custom endpoint, key check. */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-claude-api-key',
  title: 'Provider profile: Claude API key',
  defaultState: 'add',
  states: {
    add: { props: { ...claudeApiKeyAdd } },
    'add-filled': { props: { ...claudeApiKeyAdd, secret: FAKE_SECRET } },
    'add-custom-endpoint': {
      props: {
        ...claudeApiKeyAdd,
        secret: FAKE_SECRET,
        customEndpointOpen: true,
        baseUrl: GATEWAY_URL,
      },
    },
    'empty-key-error': {
      props: {
        ...claudeApiKeyAdd,
        secretError: m.settings_providerProfileKinds_keyRequired_error(),
      },
    },
    'checking-key': {
      props: { ...claudeApiKeyAdd, secret: FAKE_SECRET, signIn: { status: 'checkingKey' } },
    },
    'key-works': {
      props: { ...claudeApiKeyAdd, secret: FAKE_SECRET, signIn: { status: 'keyWorks' } },
    },
    'key-rejected': {
      props: { ...claudeApiKeyAdd, secret: FAKE_SECRET, signIn: { status: 'keyRejected' } },
    },
    edit: { props: { ...claudeApiKeyEdit } },
    'edit-replacing': {
      props: { ...claudeApiKeyEdit, replacingSecret: true, secret: FAKE_SECRET },
    },
    'edit-endpoint-saved': { props: { ...claudeApiKeyEditWithEndpoint } },
    'edit-endpoint-replacing': {
      props: { ...claudeApiKeyEditWithEndpoint, baseUrlAction: 'replace', baseUrl: GATEWAY_URL },
    },
    'edit-endpoint-removed': {
      props: { ...claudeApiKeyEditWithEndpoint, baseUrlAction: 'remove' },
    },
    'edit-key-works': {
      props: {
        ...claudeApiKeyEdit,
        replacingSecret: true,
        secret: FAKE_SECRET,
        signIn: { status: 'keyWorks' },
      },
    },
  },
});

export default ProviderProfileKindDialog;
