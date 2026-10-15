import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopMessageContent } from './desktop-message-content';
import { OperationalPanelProvider } from '@/features/chat/components/operational-panel';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentMessages } from '@/store/agent-session/agent-session-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type ContentBlock } from '$shared/types';
// The DOM window scheduler is controlled here; canonical grouping/pairing and row controls remain real.
vi.mock('@/features/chat/components/operational-window', () => ({
  OperationalWindow: ({
    items,
    row,
  }: {
    items: any[];
    row: (item: any, admitted: boolean) => React.ReactNode;
  }) => (
    <>
      {items.map((item) => (
        <div key={item.key}>{row(item, true)}</div>
      ))}
    </>
  ),
}));
const agent = AgentId('paired-tools'),
  workspace = WorkspaceId('tool-workspace');
let dispose: () => void, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1000, 1000),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(blocks: ContentBlock[], onUnavailable = vi.fn()) {
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agent,
        workspaceId: workspace,
        name: 'Fixture',
        backendSessionId: null,
        status: AgentStatus.Active,
        createdAt: '2026-10-15',
        updatedAt: '2026-10-15',
        messages: [{ id: 'm', role: 'assistant', timestamp: '2026-10-15', contentBlocks: blocks }],
      },
    ]),
  );
  await act(async () =>
    root.render(
      <OperationalPanelProvider getScrollRoot={() => host}>
        <DesktopMessageContent
          blocks={selectAgentMessages.select(store.state, agent)[0].contentBlocks!}
          agentId={agent}
          messageId="m"
          isStreaming={false}
          isLastConversationMessage
          isCurrent={() => true}
          renderText={(text) => <span>{text}</span>}
          onUnavailable={onUnavailable}
        />
      </OperationalPanelProvider>,
    ),
  );
}
it('preserves interleaved prose and pairs result by tool ID, with no duplicate standalone body', async () => {
  await render([
    { id: 'm:0', type: 'text', text: 'Before read' },
    {
      id: 'm:1',
      type: 'tool_use',
      toolCallId: 'provider-read',
      name: "Read file '/fixture/a.txt'",
      input: { _acpTitle: "Read file '/fixture/a.txt'" },
    },
    { id: 'm:2', type: 'tool_result', tool_use_id: 'provider-read', output: { exit_code: 0 } },
    { id: 'm:3', type: 'text', text: 'After read' },
  ]);
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(
    [...host.querySelectorAll('[data-message-content-block]')].map((el) =>
      el.getAttribute('data-message-content-block'),
    ),
  ).toEqual(['text', 'tool_use', 'text']);
  expect(host.textContent).toContain('Before read');
  expect(host.textContent).toContain('After read');
  expect(host.querySelectorAll('[data-tool-result-payload]')).toHaveLength(0);
  const row = host.querySelector<HTMLElement>('[data-testid=tool-call-disclosure]')!;
  await act(async () => row.click());
  expect(host.querySelector('[data-tool-detail-section=output] pre')?.textContent).toBe(
    '{\n  "exit_code": 0\n}',
  );
});
it('renders unpaired legacy text exactly once rather than assigning it to the nearest call', async () => {
  await render([
    { id: 'm:0', type: 'text', text: 'Before' },
    {
      id: 'm:1',
      type: 'tool_result',
      tool_use_id: 'absent',
      output: [{ type: 'text', text: 'Unpaired Ω' }],
    },
  ]);
  expect(host.querySelectorAll('[data-tool-result-payload]')).toHaveLength(1);
  expect(host.querySelector('[data-tool-result-payload]')?.textContent).toBe('Unpaired Ω');
});

it.each(['click', 'Enter', ' '] as const)(
  'filename %s handles its own scope action without toggling the parent disclosure',
  async (key) => {
    const notice = vi.fn();
    await render(
      [
        {
          id: 'm:0',
          type: 'tool_use',
          toolCallId: 'file-1',
          name: "Read file '/fixture/a.txt'",
          input: { _acpTitle: "Read file '/fixture/a.txt'" },
        },
        { id: 'm:1', type: 'tool_result', tool_use_id: 'file-1', output: { exit_code: 0 } },
      ],
      notice,
    );
    const file = host.querySelector<HTMLElement>('[data-testid=tool-call-file-link]')!;
    const row = host.querySelector<HTMLElement>('[data-testid=tool-call-disclosure]')!;
    expect(file.tagName).toBe('BUTTON');
    expect(file.closest('[data-testid=tool-call-disclosure]')).toBeNull();
    await act(async () => {
      if (key === 'click') file.click();
      else
        file.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    expect(notice).toHaveBeenCalledTimes(1);
    expect(row.getAttribute('aria-expanded')).toBe('false');
  },
);
