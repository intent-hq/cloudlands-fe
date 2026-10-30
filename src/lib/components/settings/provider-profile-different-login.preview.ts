import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import {
  claudeAddDetails,
  claudeEdit,
  codexAddDetails,
  codexEdit,
} from './profile-kinds/profile-kind.preview-fixtures';

/** Different login: add (live folder preview), edit (saved folder) and error states. */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-different-login',
  title: 'Provider profile: Different login',
  defaultState: 'claude-add',
  states: {
    'claude-add': { props: { ...claudeAddDetails } },
    'codex-add': { props: { ...codexAddDetails } },
    'claude-add-empty-name': { props: { ...claudeAddDetails, name: '' } },
    'claude-add-accented-name': {
      props: { ...claudeAddDetails, name: 'Équipe — produit & design (été 2026)!!' },
    },
    'claude-edit': { props: { ...claudeEdit } },
    'codex-edit': { props: { ...codexEdit } },
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
