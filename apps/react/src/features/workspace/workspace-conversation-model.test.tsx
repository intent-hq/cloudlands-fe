import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceConversationModel } from './workspace-conversation-model';
import type { ModelPickerProps } from '@/components/chat/input/model-picker';
import type { ModelSwitchConfirmDialogProps } from '@/components/chat/model-switch-confirm-dialog';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
const ui = vi.hoisted(() => ({
  picker: undefined as ModelPickerProps | undefined,
  dialog: undefined as ModelSwitchConfirmDialogProps | undefined,
}));
vi.mock('@/components/chat/input/model-picker', () => ({
  ModelPicker: (props: ModelPickerProps) => {
    ui.picker = props;
    return <div />;
  },
}));
vi.mock('@/components/chat/model-switch-confirm-dialog', () => ({
  ModelSwitchConfirmDialog: (props: ModelSwitchConfirmDialogProps) => {
    ui.dialog = props;
    return <div />;
  },
}));
let root: ReturnType<typeof createRoot>, container: HTMLDivElement, dispose: () => void;
const workspaceId = WorkspaceId('model-test'),
  agentId = AgentId('model-agent');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity({ id: workspaceId, myRole: 'owner' } as Workspace));
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId,
        provider: 'codex',
        model: 'gpt-5.5',
        status: AgentStatus.RuntimeIdle,
        messages: [{ id: 'm', role: 'user', content: 'hi' }],
        name: 'Test',
        createdAt: '2026-10-15',
        updatedAt: '2026-10-15',
      } as unknown as AgentSession,
    ]),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  dispose();
  vi.unstubAllGlobals();
  ui.picker = undefined;
  ui.dialog = undefined;
});
async function render(disabled = false, responding = false, agent = agentId) {
  await act(async () =>
    root.render(
      <WorkspaceConversationModel
        workspaceId={workspaceId}
        agentId={agent}
        disabled={disabled}
        responding={responding}
      />,
    ),
  );
}
it('uses the canonical session picker without global default writes and defers streaming choices', async () => {
  await render(false, true);
  expect(ui.picker).toMatchObject({
    workspaceId,
    agentId,
    selectedModel: 'gpt-5.5',
    providerId: 'codex',
    updateGlobalStore: true,
    updateGlobalDefault: false,
    deferUpdate: true,
    showReasoning: true,
  });
});
it('requires an explicit decision after conversation starts and preserves provider identity', async () => {
  await render();
  let decision: boolean | Promise<boolean> | undefined;
  await act(async () => {
    decision = ui.picker!.confirmModelChange!('gpt-5.5', 'gpt-6-sol', {
      from: '5.5',
      to: '6 Sol',
      fromProviderId: 'codex',
      toProviderId: 'codex',
    });
  });
  expect(ui.dialog).toMatchObject({
    open: true,
    isProviderChange: false,
    fromModelLabel: '5.5',
    toModelLabel: '6 Sol',
  });
  await act(async () => ui.dialog!.onCancel!());
  expect(await decision).toBe(false);
});
it('accepts a confirmed model change and cancels an abandoned confirmation', async () => {
  await render();
  let decision: boolean | Promise<boolean> | undefined;
  await act(async () => {
    decision = ui.picker!.confirmModelChange!('old', 'new');
  });
  await act(async () => ui.dialog!.onConfirm!());
  expect(await decision).toBe(true);
  await act(async () => {
    decision = ui.picker!.confirmModelChange!('old', 'new');
  });
  await render(false, false, AgentId('different-agent'));
  expect(await decision).toBe(false);
});
it('locks both model and effort controls while the host is not ready', async () => {
  await render(true);
  expect(ui.picker).toMatchObject({ isLocked: true, reasoningDisabled: true });
  expect(await ui.picker!.confirmModelChange!('old', 'new')).toBe(false);
});
it('opens an actual bounded provider settings view', async () => {
  await render();
  await act(async () => ui.picker!.onOpenProviderSettings());
  expect(container.ownerDocument.body.textContent).toContain(
    'Configure providers in the desktop app',
  );
});
