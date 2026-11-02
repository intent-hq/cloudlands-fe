import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { m } from '$shared/paraglide/messages.js';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import {
  claudeTokenAdd,
  claudeTokenEdit,
  codexTokenAdd,
  codexTokenEdit,
  FAKE_JWT,
  FAKE_SECRET,
} from './profile-kinds/profile-kind.preview-fixtures';

/** Token (add + edit): Claude `claude setup-token`, Codex Business/Enterprise access token. */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-token',
  title: 'Provider profile: Token',
  defaultState: 'claude-add',
  states: {
    'claude-add': { props: { ...claudeTokenAdd } },
    'claude-empty-error': {
      props: {
        ...claudeTokenAdd,
        secretError: m.settings_providerProfileKinds_tokenRequired_error(),
      },
    },
    'claude-checking': {
      props: { ...claudeTokenAdd, secret: FAKE_SECRET, signIn: { status: 'checkingKey' } },
    },
    'claude-key-works': {
      props: { ...claudeTokenAdd, secret: FAKE_SECRET, signIn: { status: 'keyWorks' } },
    },
    'claude-key-rejected': {
      props: { ...claudeTokenAdd, secret: FAKE_SECRET, signIn: { status: 'keyRejected' } },
    },
    'claude-edit': { props: { ...claudeTokenEdit } },
    'claude-edit-replacing': {
      props: { ...claudeTokenEdit, replacingSecret: true, secret: FAKE_SECRET },
    },
    'codex-add': { props: { ...codexTokenAdd } },
    'codex-not-jwt-error': {
      props: {
        ...codexTokenAdd,
        secret: 'not-a-token',
        secretError: m.settings_providerProfileKinds_tokenNotJwt_error(),
      },
    },
    'codex-empty-error': {
      props: {
        ...codexTokenAdd,
        secretError: m.settings_providerProfileKinds_tokenRequired_error(),
      },
    },
    'codex-key-works': {
      props: { ...codexTokenAdd, secret: FAKE_JWT, signIn: { status: 'keyWorks' } },
    },
    'codex-key-rejected': {
      props: { ...codexTokenAdd, secret: FAKE_JWT, signIn: { status: 'keyRejected' } },
    },
    'codex-edit': { props: { ...codexTokenEdit } },
    'codex-edit-replacing': {
      props: { ...codexTokenEdit, replacingSecret: true, secret: FAKE_JWT },
    },
  },
});

export default ProviderProfileKindDialog;
