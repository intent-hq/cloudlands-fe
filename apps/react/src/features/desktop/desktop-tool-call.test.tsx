import { take } from 'typed-redux-saga';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopToolCall } from './desktop-tool-call';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  bulkUpsertSessions,
  updateSession,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { messageBlockHydrationRequested } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { selectAgentMessages } from '@/store/agent-session/agent-session-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type ContentBlock } from '$shared/types';
const row = vi.hoisted(() => ({ props: {} as Record<string, any> }));
vi.mock('@/features/chat/components/chat-operational-row', () => ({
  ChatOperationalRow: (props: any) => {
    row.props = props;
    return (
      <div>
        {props.summary}
        {props.expanded && props.details}
      </div>
    );
  },
}));
const agent = AgentId('tools-agent'),
  workspace = WorkspaceId('tools-workspace');
let dispose: () => void, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const call: ContentBlock = {
  type: 'tool_use',
  id: 'm:0',
  toolCallId: 'provider-1',
  name: 'workspace_api',
  input: {
    summary: 'Inspect fixture',
    code: 'return await ws.file.read("greeting.txt");',
    _acpTitle: 'workspace_api',
  },
};
const result: ContentBlock = {
  type: 'tool_result',
  id: 'm:1',
  tool_use_id: 'provider-1',
  output: {
    result: {
      content: [{ type: 'text', text: 'owned output Ω\n' }],
      structuredContent: null,
      _meta: null,
    },
    error: null,
  },
  is_error: false,
};
function install(blocks: ContentBlock[]) {
  if (selectAgentMessages.select(store.state, agent).length) {
    store.dispatch(
      updateSession(agent, {
        messages: [
          { id: 'm', role: 'assistant', timestamp: '2026-10-15T19:00:00Z', contentBlocks: blocks },
        ],
      }),
    );
    return;
  }
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agent,
        workspaceId: workspace,
        name: 'Fixture',
        status: AgentStatus.Active,
        backendSessionId: null,
        createdAt: '2026-10-15T19:00:00Z',
        updatedAt: '2026-10-15T19:00:00Z',
        messages: [
          { id: 'm', role: 'assistant', timestamp: '2026-10-15T19:00:00Z', contentBlocks: blocks },
        ],
      },
    ]),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  install([call, result]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function observeDispatch() {
  const observed = vi.fn();
  store.runSaga(function* observeToolHydration() {
    while (true) observed(yield* take(messageBlockHydrationRequested.type));
  });
  return observed;
}

async function render(
  options: { streaming?: boolean; current?: () => boolean; saved?: { expanded?: boolean } } = {},
) {
  const blocks = selectAgentMessages.select(store.state, agent)[0].contentBlocks!;
  await act(async () =>
    root.render(
      <DesktopToolCall
        call={blocks[0]}
        resultBlock={blocks[1]}
        agentId={agent}
        messageId="m"
        isStreaming={options.streaming ?? false}
        adjacent={false}
        saved={options.saved ?? {}}
        isCurrent={options.current ?? (() => true)}
        onUnavailable={() => {}}
      />,
    ),
  );
}
it('exposes exact stored raw input/result only after explicit expansion, without inventing a specialized result', async () => {
  await render();
  expect(host.textContent).not.toContain('owned output');
  await act(async () => row.props.onclick());
  expect(host.querySelector('[data-tool-detail-section=input] pre')?.textContent).toBe(
    JSON.stringify(call.input, null, 2),
  );
  expect(host.querySelector('[data-tool-detail-section=output] pre')?.textContent).toBe(
    JSON.stringify(result.output, null, 2).replace('owned output Ω\\n', 'owned output Ω'),
  );
});
it('keeps absent result body absent and internal-only edit noninteractive', async () => {
  install([{ ...call, name: 'Editing files', input: { _acpTitle: 'Editing files' } }]);
  await render();
  expect(row.props.interactive).toBe(false);
  await act(async () => row.props.onclick());
  expect(host.querySelector('[data-tool-detail-section]')).toBeNull();
});
it('renders exit-code-only receipt without fabricating file content', async () => {
  install([
    {
      ...call,
      name: "Read file '/fixture/greeting.txt'",
      input: { _acpTitle: "Read file '/fixture/greeting.txt'" },
    },
    { ...result, output: { exit_code: 0 } },
  ]);
  await render();
  await act(async () => row.props.onclick());
  expect(host.querySelector('[data-tool-detail-section=input]')).toBeNull();
  expect(host.querySelector('[data-tool-detail-section=output] pre')?.textContent).toBe(
    '{\n  "exit_code": 0\n}',
  );
  expect(host.textContent).toContain("greeting.txt'");
});
it('uses source running/error transitions without showing a running result', async () => {
  install([call]);
  await render({ streaming: true });
  await act(async () => row.props.onclick());
  expect(row.props.streaming).toBe(true);
  expect(host.querySelector('[data-tool-detail-section=output]')).toBeNull();
  install([call, { ...result, output: 'Permission denied Ω', is_error: true }]);
  await render();
  expect(row.props.streaming).toBe(false);
  expect(host.querySelector('[data-tool-detail-error]')?.textContent).toContain(
    'Permission denied Ω',
  );
});
it('hydrates only the canonical truncated IDs on expansion and explicit retry', async () => {
  install([
    { ...call, inputTruncated: true },
    { ...result, outputTruncated: true },
  ]);
  const dispatch = observeDispatch();
  await render();
  expect(dispatch).not.toHaveBeenCalled();
  await act(async () => row.props.onclick());
  expect(dispatch.mock.calls.map(([a]) => a)).toEqual([
    messageBlockHydrationRequested(agent, 'm', 'm:0'),
    messageBlockHydrationRequested(agent, 'm', 'm:1'),
  ]);
});
it.each(['retired', 'replaced', 'unmounted'] as const)(
  'rejects a captured activation after %s before selector emission',
  async (reason) => {
    install([{ ...call, inputTruncated: true }, result]);
    let current = true;
    await render({ current: () => current });
    const captured = row.props.onclick;
    const dispatch = observeDispatch();
    if (reason === 'retired') current = false;
    if (reason === 'replaced') store.dispatch(updateSession(agent, { messages: [] }));
    if (reason === 'unmounted') await act(async () => root.render(null));
    dispatch.mockClear();
    await act(async () => captured());
    expect(dispatch).not.toHaveBeenCalled();
  },
);
it('retains explicit disclosure state through row virtualization using the existing panel record', async () => {
  const saved = { expanded: false };
  await render({ saved });
  await act(async () => row.props.onclick());
  expect(saved.expanded).toBe(true);
  await act(async () => root.render(null));
  await render({ saved });
  expect(host.querySelector('[data-tool-detail-section=output]')).not.toBeNull();
});
