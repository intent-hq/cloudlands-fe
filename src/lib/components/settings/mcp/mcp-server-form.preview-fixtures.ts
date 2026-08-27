import type { ComponentProps } from 'svelte';
import {
  PREVIEW_FIXTURE_IDS,
  PREVIEW_FIXTURE_TIMESTAMPS,
  definePreviewFixture,
} from '$lib/component-catalog/preview-fixtures';
import type McpServerForm from './McpServerForm.svelte';
import type { McpServerFormState } from './types';

const formState = definePreviewFixture<McpServerFormState>({
  name: 'preview-filesystem',
  type: 'stdio',
  command: 'npx',
  args: '-y @modelcontextprotocol/server-filesystem /preview/project',
  url: '',
  authType: 'none',
  envPairs: [],
  headerPairs: [],
});

const submit = async () => undefined;
const cancel = () => undefined;
const formProps = definePreviewFixture<ComponentProps<typeof McpServerForm>>({
  initialValues: formState(),
  existingServerNames: [],
  onSubmit: submit,
  onCancel: cancel,
});

export const MCP_SERVER_FORM_PREVIEW_FIXTURES = Object.freeze({
  empty: formProps({ initialValues: formState({ name: '', command: '', args: '' }) }),
  validation: formProps({
    initialValues: formState({ name: PREVIEW_FIXTURE_IDS.agent }),
    existingServerNames: [PREVIEW_FIXTURE_IDS.agent],
  }),
  'configured-http': formProps({
    initialValues: formState({
      name: 'preview-http-server',
      type: 'http',
      command: '',
      args: '',
      url: 'https://mcp.preview.invalid/rpc',
      authType: 'header',
      headerPairs: [
        {
          id: `${PREVIEW_FIXTURE_IDS.session}-header`,
          key: 'X-Preview-Mode',
          value: 'deterministic',
        },
      ],
    }),
  }),
  'long-content': formProps({
    initialValues: formState({
      name: 'preview-long-context-server',
      args:
        '--workspace /preview/a-deliberately-long-workspace-name --updated-at ' +
        PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
      envPairs: [
        {
          id: `${PREVIEW_FIXTURE_IDS.message}-environment`,
          key: 'PREVIEW_CONTEXT_DESCRIPTION',
          value: 'Deterministic long content for compact settings layout verification',
        },
      ],
    }),
  }),
});
