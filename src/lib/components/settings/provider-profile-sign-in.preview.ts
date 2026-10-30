import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import {
  claudeAddDetails,
  claudeEdit,
  codexAddDetails,
  codexEdit,
  FAKE_EMAIL,
} from './profile-kinds/profile-kind.preview-fixtures';

/** Terminal sign-in progress after Create & sign in (add) or Log In (edit). */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-sign-in',
  title: 'Provider profile: sign-in states',
  defaultState: 'claude-waiting',
  states: {
    'claude-waiting': { props: { ...claudeAddDetails, signIn: { status: 'waiting' } } },
    'claude-signed-in': {
      props: { ...claudeAddDetails, signIn: { status: 'signedIn', email: FAKE_EMAIL } },
    },
    'claude-still-waiting': { props: { ...claudeAddDetails, signIn: { status: 'stillWaiting' } } },
    'codex-waiting': { props: { ...codexAddDetails, signIn: { status: 'waiting' } } },
    'codex-device-auth': {
      props: {
        ...codexAddDetails,
        remoteDaemon: true,
        signIn: { status: 'waiting', deviceAuth: true },
      },
    },
    'codex-signed-in': { props: { ...codexAddDetails, signIn: { status: 'signedIn' } } },
    'codex-still-waiting': { props: { ...codexAddDetails, signIn: { status: 'stillWaiting' } } },
    'claude-edit-log-in-waiting': {
      props: { ...claudeEdit, signIn: { status: 'waiting' } },
    },
    'claude-edit-signed-in': {
      props: { ...claudeEdit, signIn: { status: 'signedIn', email: FAKE_EMAIL } },
    },
    'codex-edit-chatgpt-device-auth': {
      props: {
        ...codexEdit,
        remoteDaemon: true,
        signIn: { status: 'waiting', deviceAuth: true },
      },
    },
    'codex-edit-api-key-waiting': {
      props: { ...codexEdit, signInMethod: 'apiKey', signIn: { status: 'waiting' } },
    },
  },
});

export default ProviderProfileKindDialog;
