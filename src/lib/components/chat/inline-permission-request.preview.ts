import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import InlinePermissionRequest from './InlinePermissionRequest.svelte';

// i18n-ignore (sandbox fixture: agent-supplied prompt text)
const base = {
  requestId: 'preview-request',
  workspaceId: 'preview-workspace',
  sessionId: 'preview-agent',
  title: 'Run npm test',
  description: 'Tool input: {"command":"npm test"}',
  agentName: 'Claude',
  timestamp: 0,
};

export const preview = definePreview<ComponentProps<typeof InlinePermissionRequest>>({
  id: 'inline-permission-request',
  title: 'Inline permission request',
  defaultState: 'always-allow',
  states: {
    'always-allow': {
      props: {
        request: {
          ...base,
          // i18n-ignore (sandbox fixture: agent-supplied option labels)
          options: [
            { id: 'allow-once', label: 'Yes', kind: 'allow_once' },
            {
              id: 'allow-with-updates',
              label: "Yes, and don't ask again for Bash commands",
              kind: 'allow_always',
              scope: 'workspace',
            },
            { id: 'reject', label: 'No', kind: 'reject_once', destructive: true },
          ],
        },
      },
    },
    'codex-chat': {
      props: {
        request: {
          ...base,
          agentName: 'Codex',
          // i18n-ignore (sandbox fixture: agent-supplied option labels)
          options: [
            { id: 'allow_once', label: 'Yes, proceed', kind: 'allow_once' },
            {
              id: 'allow_for_session',
              label: "Yes, and don't ask again for this command in this session",
              kind: 'allow_always',
              scope: 'chat',
            },
            {
              id: 'decline',
              label: 'No, continue without running it',
              kind: 'reject_once',
              destructive: true,
            },
          ],
        },
      },
    },
    'cursor-all-workspaces': {
      props: {
        request: {
          ...base,
          agentName: 'Cursor',
          // i18n-ignore (sandbox fixture: agent-supplied option labels)
          options: [
            { id: 'allow-once', label: 'Allow once', kind: 'allow_once' },
            {
              id: 'allow-always',
              label: 'Allow always',
              kind: 'allow_always',
              scope: 'allWorkspaces',
            },
            { id: 'reject-once', label: 'Reject', kind: 'reject_once', destructive: true },
          ],
        },
      },
    },
    'older-daemon': {
      props: {
        request: {
          ...base,
          // i18n-ignore (sandbox fixture: agent-supplied option labels)
          options: [
            { id: 'allow_once', label: 'Allow once' },
            { id: 'allow_always', label: 'Always allow' },
            { id: 'reject_once', label: 'Reject', destructive: true },
          ],
        },
      },
    },
  },
});

export default InlinePermissionRequest;
