import type { QueuedMessage } from '$shared/types';
import { definePreview } from '$lib/component-catalog/preview-definition';
import type {
  DockConversationAgent,
  DockConversationMessage,
} from '$store/renderer/slices/dock-conversation/dock-conversation-types';

export interface DockConversationPreviewProps {
  agent?: DockConversationAgent;
  agents?: DockConversationAgent[];
  workspaceTitle?: string;
  messages?: DockConversationMessage[];
  queuedMessages?: QueuedMessage[];
  initialDraft?: string;
  width?: number;
  height?: number;
  loading?: boolean;
  running?: boolean;
  sending?: boolean;
  loadError?: string;
  sendError?: string;
  blocked?: boolean;
  attention?: string;
  theme?: 'light' | 'dark';
}

export const conversationAgents: DockConversationAgent[] = [
  { id: 'dock-conversation-coordinator', name: 'Design companion', isMain: true },
  { id: 'dock-conversation-implementor', name: 'Polish navigation', isMain: false },
  { id: 'dock-conversation-verifier', name: 'Review keyboard access', isMain: false },
];

export const conversationMessages: DockConversationMessage[] = [
  {
    id: 'request',
    role: 'user',
    timestamp: '2026-10-22T00:00:00Z',
    contentBlocks: [
      { type: 'text', text: 'Make it easier to move between workspaces without losing my place.' },
    ],
  },
  {
    id: 'response',
    role: 'assistant',
    timestamp: '2026-10-22T00:00:00Z',
    contentBlocks: [
      {
        type: 'text',
        text: 'I’ll keep the conversation close to the dock, with a clear way back to your workspaces.',
      },
    ],
  },
  {
    id: 'activity',
    role: 'user',
    metadata: {
      type: 'script_monitor_wake',
      source: 'system',
      scriptName: 'Review navigation',
      scriptId: 'preview-script',
      runId: 'preview-run',
      monitorId: 'preview-monitor',
      workspaceId: 'preview-workspace',
      reason: 'finished',
    },
    timestamp: '2026-10-22T00:00:00Z',
    contentBlocks: [
      {
        type: 'text',
        text: 'Read navigation components\nDockRail.svelte\nAdaptiveDockShell.svelte\nCompared keyboard focus and panel placement.',
      },
    ],
  },
  {
    id: 'result',
    role: 'assistant',
    timestamp: '2026-10-22T00:00:00Z',
    contentBlocks: [
      {
        type: 'text',
        text: 'The panel now **keeps its place** while you read.\n\n- New replies collect below.\n- Jump to them when you’re ready.\n- Press `Shift Enter` for a new line.\n\nWould you like the same behavior for the Assistant?',
      },
    ],
  },
];

const longMessages: DockConversationMessage[] = Array.from(
  { length: 8 },
  (_, index): DockConversationMessage[] => [
    {
      id: `question-${index}`,
      role: 'user' as const,
      timestamp: '2026-10-22T00:00:00Z',
      contentBlocks: [
        {
          type: 'text',
          text: `Review ${index + 1}: keep the current reply and make the keyboard path easier to follow.`,
        },
      ],
    },
    {
      id: `answer-${index}`,
      role: 'assistant' as const,
      timestamp: '2026-10-22T00:00:00Z',
      contentBlocks: [
        {
          type: 'text',
          text: 'I checked the compact view with a longer workspace title and a narrow window. The transcript stays readable, and the reply field grows without covering the header.\n\nDrafts belong to each conversation, so switching agents does not mix up your messages.',
        },
      ],
    },
  ],
).flat();

export const dockConversationPreview = definePreview<DockConversationPreviewProps>({
  id: 'dock-conversation',
  title: 'Dock conversation',
  defaultState: 'workspace',
  states: {
    workspace: { props: {} },
    structured: {
      props: {
        messages: [
          ...conversationMessages.slice(0, 3),
          {
            id: 'workspace-event',
            role: 'user',
            timestamp: '2026-10-22T00:00:00Z',
            metadata: {
              type: 'event_notification',
              eventCount: 1,
              eventTypes: ['agent:completed'],
              events: [
                {
                  type: 'agent:completed',
                  data: { agentName: 'Review keyboard access' },
                  timestamp: '2026-10-22T00:00:00Z',
                },
              ],
            },
            contentBlocks: [
              {
                type: 'text',
                text: '[WORKSPACE EVENTS]\n1. [agent:completed] Review keyboard access completed.',
              },
            ],
          },
          {
            id: 'structured-response',
            role: 'assistant',
            timestamp: '2026-10-22T00:00:00Z',
            contentBlocks: [
              {
                type: 'thinking',
                text: 'Check the navigation structure before changing the focus path.',
              },
              {
                type: 'tool_use',
                id: 'preview-read',
                name: 'read_file',
                input: { path: 'src/navigation.ts' },
              },
              {
                type: 'tool_result',
                tool_use_id: 'preview-read',
                content: 'The navigation keeps the active workspace and focused panel together.',
              },
              {
                type: 'text',
                text: 'The existing navigation keeps **workspace and focus** together. I’ll preserve that behavior in the compact conversation.',
              },
            ],
          },
        ],
        queuedMessages: [
          {
            id: 'structured-queued',
            content: 'Keep the keyboard behavior consistent with the main conversation.',
            queuedAt: '2026-10-22T00:00:00Z',
            position: 0,
          },
        ],
      },
    },
    assistant: {
      props: {
        agent: { id: 'assistant', name: 'Assistant', isMain: true },
        agents: [],
        workspaceTitle: 'Your personal assistant',
        messages: [
          {
            id: 'assistant-question',
            role: 'user',
            timestamp: '2026-10-22T00:00:00Z',
            contentBlocks: [{ type: 'text', text: 'What should I pick up next?' }],
          },
          {
            id: 'assistant-response',
            role: 'assistant',
            timestamp: '2026-10-22T00:00:00Z',
            contentBlocks: [
              {
                type: 'text',
                text: 'The navigation work is ready for a look. The release notes can wait until you’ve tried the new flow.',
              },
            ],
          },
        ],
      },
    },
    running: {
      props: {
        running: true,
        messages: [
          ...conversationMessages.slice(0, 3),
          {
            id: 'streaming',
            role: 'assistant',
            isStreaming: true,
            timestamp: '2026-10-22T00:00:00Z',
            contentBlocks: [
              { type: 'text', text: 'I’m checking how the panel responds when you switch agents' },
            ],
          },
        ],
      },
    },
    queued: {
      props: {
        queuedMessages: [
          {
            id: 'preview-queued',
            content: 'Keep the navigation changes and check the keyboard path next.',
            queuedAt: '2026-10-22T00:00:00Z',
            position: 0,
          },
        ],
      },
    },
    loading: { props: { loading: true, messages: [] } },
    empty: { props: { messages: [] } },
    'load-error': {
      props: { messages: [], loadError: 'The conversation could not be loaded. Try again.' },
    },
    'send-error': {
      props: {
        initialDraft: 'Yes, keep the same reading position for the Assistant.',
        sendError: 'Your reply could not be sent. Your draft is still here.',
      },
    },
    sending: {
      props: {
        initialDraft: 'Yes, keep the same reading position for the Assistant.',
        sending: true,
      },
    },
    unavailable: {
      props: {
        blocked: true,
        attention: 'This agent is no longer available. Open the workspace to continue.',
        initialDraft: 'Please keep this draft.',
      },
    },
    long: { props: { messages: longMessages } },
    narrow: {
      props: {
        width: 320,
        height: 460,
        workspaceTitle: 'Design the workspace navigation and conversation experience',
        running: true,
        initialDraft:
          'Keep the header visible while I write a longer reply.\nThe keyboard path should feel immediate.',
        messages: longMessages,
      },
    },
    dark: { props: { theme: 'dark', running: true } },
    markdown: {
      props: {
        messages: [
          {
            id: 'formatted',
            role: 'assistant',
            timestamp: '2026-10-22T00:00:00Z',
            contentBlocks: [
              {
                type: 'text',
                text: '## Reading position\n\nKeep **new replies** nearby without interrupting the reader.\n\n```ts\nconst label = \"this_is_a_deliberately_long_unbroken_identifier_for_narrow_panel_containment\";\n```\n\n1. Read at your pace.\n2. Jump to the latest update.',
              },
            ],
          },
        ],
      },
    },
  },
});
