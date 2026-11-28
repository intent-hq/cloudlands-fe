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

/** Different login: add (live folder preview), edit (saved folder) and error states. */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-different-login',
  title: 'Provider profile: Different login',
  defaultState: 'claude-add',
  states: {
    'claude-add': { props: { ...claudeAddDetails } },
    'claude-add-backup-off': { props: { ...claudeAddDetails, backup: false } },
    'claude-add-folder-open': { props: { ...claudeAddDetails, detailsOpen: true } },
    'codex-add': { props: { ...codexAddDetails } },
    'claude-add-empty-name': { props: { ...claudeAddDetails, name: '' } },
    'claude-add-accented-name': {
      props: { ...claudeAddDetails, name: 'Équipe — produit & design (été 2026)!!' },
    },
    'claude-edit': {
      props: { ...claudeEdit, signInStatus: 'ready', signInEmail: FAKE_EMAIL },
    },
    'claude-edit-backup-on': {
      props: { ...claudeEdit, backup: true, signInStatus: 'ready', signInEmail: FAKE_EMAIL },
    },
    'claude-edit-signed-out': { props: { ...claudeEdit, signInStatus: 'error' } },
    'claude-edit-checking': { props: { ...claudeEdit, signInStatus: 'checking' } },
    'claude-edit-unchecked': { props: { ...claudeEdit } },
    'claude-edit-folder-open': {
      props: { ...claudeEdit, signInStatus: 'ready', signInEmail: FAKE_EMAIL, detailsOpen: true },
    },
    'codex-edit': { props: { ...codexEdit, signInStatus: 'ready' } },
    'claude-edit-hand-made-folder': {
      props: { ...claudeEdit, savedFolderPath: '~/.claude-work' },
    },
    'claude-duplicate-name': {
      props: {
        ...claudeAddDetails,
        nameError: 'Another Claude Code profile already uses this name.', // i18n-ignore (fake preview data)
      },
    },
    'codex-duplicate-name': {
      props: {
        ...codexAddDetails,
        nameError: 'Another Codex profile already uses this name.', // i18n-ignore (fake preview data)
      },
    },
    'claude-folder-failed': {
      props: {
        ...claudeAddDetails,
        setupError: { kind: 'folderFailed', path: '~/intent/profiles/claude/work-account-k3f9' },
      },
    },
    'codex-folder-failed': {
      props: {
        ...codexAddDetails,
        setupError: { kind: 'folderFailed', path: '~/intent/profiles/codex/work-account-k3f9' },
      },
    },
    'claude-terminal-failed': {
      props: { ...claudeAddDetails, setupError: { kind: 'terminalFailed' } },
    },
    'codex-terminal-failed': {
      props: { ...codexAddDetails, setupError: { kind: 'terminalFailed' } },
    },
  },
});

export default ProviderProfileKindDialog;
