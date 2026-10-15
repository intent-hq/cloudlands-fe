import { getPrincipalConnectionContext } from '../../../../../src/store/renderer/slices/principal/principal-context';
import { expect, it } from 'vitest';
import { store } from '@/store';
import { captureQueueRemovalRequest, captureQueueRemovalAuthority } from './queue-runtime';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { chatDraftOwnerOpened, chatDraftOwnerReleased, chatDraftRestoreRequested, chatDraftRestoreSettled } from '../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-slice';
import { replaceAgentQueue } from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-slice';

it('captured removal cannot adopt a new composer after retirement in the same workspace', () => {
  const initial=createAdmittedLegacyPrincipal();const dispose=store.init(initial);
  try {
    store.dispatch(setWorkspaceEntity({id:'ws',myRole:'owner'} as any));
    store.dispatch(bulkUpsertSessions([{id:'agent',workspaceId:'ws',messages:[]} as any]));
    store.dispatch(chatDraftOwnerOpened('old'));
    store.dispatch(chatDraftRestoreRequested('old','restore','ws','agent'));
    store.dispatch(chatDraftRestoreSettled('old','restore','restored',null));
    store.dispatch(replaceAgentQueue('agent',[{id:'q',content:'follow-up',queuedAt:'2026-10-15',position:0,author:{principalId:initial.principal.snapshot!.principal.id}} as any],'ws'));
    const view={lifetime:'restore',authority:getPrincipalConnectionContext(store.state)};
    const request=captureQueueRemovalRequest('agent','ws','old','q',view);expect(request).toBeDefined();
    const authority=captureQueueRemovalAuthority(request!)!;expect(authority.isCurrent()).toBe(true);
    store.dispatch(chatDraftOwnerReleased('old'));
    store.dispatch(chatDraftOwnerOpened('new'));
    store.dispatch(chatDraftRestoreRequested('new','new-restore','ws','agent'));
    store.dispatch(chatDraftRestoreSettled('new','new-restore','restored',null));
    expect(authority.isCurrent()).toBe(false);expect(captureQueueRemovalAuthority(request!)).toBeUndefined();
    expect(captureQueueRemovalRequest('agent','ws','new','q',{...view,lifetime:'new-restore'})).toBeDefined();
    expect(captureQueueRemovalRequest('agent','ws','new','q',view)).toBeUndefined();
    store.dispatch(chatDraftRestoreRequested('new','reconnected','ws','agent'));
    store.dispatch(chatDraftRestoreSettled('new','reconnected','restored',null));
    expect(captureQueueRemovalRequest('agent','ws','new','q',{...view,lifetime:'new-restore'})).toBeUndefined();
    expect(captureQueueRemovalRequest('agent','ws','new','q',{...view,lifetime:'reconnected'})).toBeDefined();
  } finally {dispose();}
});
