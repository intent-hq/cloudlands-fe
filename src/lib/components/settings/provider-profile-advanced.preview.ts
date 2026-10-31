import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import {
  claudeAdvancedEdit,
  claudeApiKeyEdit,
  claudeBase,
  claudeEdit,
  codexAdvancedEdit,
  codexBase,
} from './profile-kinds/profile-kind.preview-fixtures';

const errorRows = [
  { rowId: 'row-1', key: 'ANTHROPIC_MODEL', mode: 'value', value: '' },
  { rowId: 'row-2', key: 'INTENT_MARKER', mode: 'value', value: 'x' },
] as const;

/** Advanced: today's env editor inside the new shell, plus Switch to Advanced from Edit. */
export const preview = definePreview<ComponentProps<typeof ProviderProfileKindDialog>>({
  id: 'provider-profile-advanced',
  title: 'Provider profile: Advanced',
  defaultState: 'claude-add',
  states: {
    'claude-add': {
      props: { ...claudeBase, mode: 'add', step: 'details', kind: 'advanced', name: 'Bedrock' },
    },
    'codex-add': {
      props: { ...codexBase, mode: 'add', step: 'details', kind: 'advanced', name: 'Gateway' },
    },
    'claude-edit': { props: { ...claudeAdvancedEdit } },
    'codex-edit': { props: { ...codexAdvancedEdit } },
    'field-errors': {
      props: {
        ...claudeBase,
        mode: 'add',
        step: 'details',
        kind: 'advanced',
        name: 'Work account',
        nameError: 'Another Claude Code profile already uses this name.', // i18n-ignore (fake preview data)
        envRows: errorRows.map((row) => ({ ...row })),
        envErrors: {
          'row-1.value': 'Enter a value, or choose Empty or Unset.', // i18n-ignore (fake preview data)
          'row-2.key': 'INTENT_ keys are reserved.', // i18n-ignore (fake preview data)
        },
      },
    },
    'edit-restart-warning': {
      props: {
        ...claudeAdvancedEdit,
        envRows: [
          { rowId: 'row-1', key: 'CLAUDE_CODE_USE_BEDROCK', mode: 'value', value: '1' },
          { rowId: 'row-2', key: 'AWS_REGION', mode: 'value', value: 'eu-west-1' },
        ],
      },
    },
    'switched-from-different-login': {
      props: {
        ...claudeEdit,
        kind: 'advanced',
        name: 'Work account (renamed)',
        backup: true,
        savedEnv: [
          {
            key: 'CLAUDE_CONFIG_DIR',
            kind: 'set',
            value: '~/intent/profiles/claude/work-account-k3f9',
          },
          { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
          { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
          { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
        ],
      },
    },
    'switched-from-api-key': {
      props: { ...claudeApiKeyEdit, kind: 'advanced', name: 'Anthropic key (unsaved)' },
    },
  },
});

export default ProviderProfileKindDialog;
