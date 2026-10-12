import type { AgentMessage } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

const OWNER = 'principal-owner';
const AUTHOR = {
  principalId: 'principal-member',
  login: 'octocat',
  displayName: 'The Octocat',
  avatarUrl: null,
  identity: { provider: 'github', host: 'github.com', externalUserId: '42' },
} satisfies AgentMessage['author'];
const MEMBER_HEADER =
  'Message from @octocat (The Octocat), a host member (principal principal-member; github@github.com user 42) — not the workspace owner.';
const GUEST_HEADER =
  'Message from @octocat (The Octocat), a collaborator (guest) of this workspace — not the workspace owner.';
const WAIT_NOTE =
  '[SYSTEM NOTE] This message was queued at 2026-08-17T05:00:00Z and waited 37s before delivery.';
const STALE_NOTE =
  '[SYSTEM NOTE] This message was queued before you completed; your completion report was already delivered to your parent at 2026-08-17T05:01:00Z. Only call reportToParent again if this message materially changes the outcome — do not re-send the same report.';

function message(id: string, text: string, fields: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id,
    role: 'user',
    timestamp: '2026-08-17T05:00:00Z',
    contentBlocks: [{ type: 'text', text }],
    ...fields,
  };
}

test('Up Arrow recalls the host-member prompt without changing the stored message', async ({
  mount,
}) => {
  const messages = [
    message('member', `${MEMBER_HEADER}\n\nWhat's the status on testflight today?`, {
      author: AUTHOR,
      metadata: { fromPrincipalId: AUTHOR.principalId },
    }),
  ];
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { messages, ownerPrincipalId: OWNER },
  });
  const stored = component.getByTestId('stored-messages');
  await expect(stored).toHaveText(JSON.stringify(messages));
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await expect(editor).toBeEditable();
  await editor.press('ArrowUp');
  await expect(editor).toHaveText("What's the status on testflight today?");
  await expect(stored).toHaveText(JSON.stringify(messages));
});

test('recalls guest and queued text through Up/Down navigation, skipping automated rows', async ({
  mount,
}) => {
  const messages = [
    message('guest', `${GUEST_HEADER}\n\nReview café 你好\nKeep the second line.`, {
      author: AUTHOR,
      metadata: { fromPrincipalId: AUTHOR.principalId },
    }),
    message('queued', `Ship it\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`, {
      metadata: { queueInfo: { queuedAt: '2026-08-17T05:00:00Z', waitedMs: 37_000 } },
    }),
    message('agent', '[MESSAGE FROM AGENT Research (agent-other)]\n\nAutomated agent text', {
      metadata: { type: 'agent_message', fromAgentId: 'agent-other', fromAgentName: 'Research' },
    }),
    message('system', 'Automated system text', { metadata: { source: 'system' } }),
    message('legacy', '[TASK WAKE] Legacy automated text'),
    message('assistant', 'Assistant response', { role: 'assistant' }),
  ];
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { messages, ownerPrincipalId: OWNER },
  });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await expect(editor).toBeEditable();
  await editor.fill('Unsent draft');
  await editor.press('Meta+ArrowUp');
  await editor.press('ArrowUp');
  await expect(editor).toHaveText('Ship it');
  await editor.press('Meta+ArrowUp');
  await editor.press('ArrowUp');
  await expect(editor).toHaveText('Review café 你好Keep the second line.');
  await expect(editor.locator('br')).toHaveCount(1);
  await editor.press('Meta+ArrowUp');
  await editor.press('ArrowUp');
  await expect(editor).toHaveText('Review café 你好Keep the second line.');
  await editor.press('Meta+ArrowDown');
  await editor.press('ArrowDown');
  await expect(editor).toHaveText('Ship it');
  await editor.press('ArrowDown');
  await expect(editor).toHaveText('Unsent draft');
  await expect(component.getByTestId('stored-messages')).toHaveText(JSON.stringify(messages));
});

for (const ownerPrincipalId of [AUTHOR.principalId, undefined]) {
  test(`preserves literal sender prose with ${ownerPrincipalId ? 'matching' : 'unknown'} owner identity`, async ({
    mount,
  }) => {
    const authored = `${MEMBER_HEADER}\n\n[SYSTEM NOTE] This is my own note.\n\n> ${WAIT_NOTE}`;
    const messages = [message('authored', authored, { author: AUTHOR })];
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: { messages, ownerPrincipalId },
    });
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await expect(editor).toBeEditable();
    await editor.press('ArrowUp');
    await expect(editor).toContainText('Message from @octocat (The Octocat), a host member');
    // The editor renders provider@host as a mention. Assert its serialized text,
    // including the @ and line breaks, rather than the mention's DOM label.
    await expect
      .poll(async () =>
        JSON.parse(await component.getByTestId('composer-draft-requests').innerText()),
      )
      .toContainEqual({
        method: 'drafts.set',
        params: {
          workspaceId: 'chat-panel-composer-geometry',
          agentId: 'regular-composer-agent',
          text: authored,
        },
      });
    await expect(component.getByTestId('stored-messages')).toHaveText(JSON.stringify(messages));
  });
}
