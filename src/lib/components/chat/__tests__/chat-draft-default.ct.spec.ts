import { expect, test } from '../../../../test/ct-test';
import ChatDraftDefaultHost from './ChatDraftDefaultHost.svelte';

// A chat host that never starts the draft saga left the composer behind the
// draft loading gate until its 5 s fallback; removing the gate shrank the
// composer and moved every message row by about 30 px (cloudlands-fe#4160).
// The CT bootstrap answers draft restores for every host, so a bare host
// restores a saved draft without opting in.
for (const ownsStoreLifecycle of [false, true]) {
  test(`restores a saved draft in a host that starts no draft saga (${
    ownsStoreLifecycle ? 'own store lifecycle' : 'bootstrap store'
  })`, async ({ mount }) => {
    const scope = {
      workspaceId: `chat-draft-default-${ownsStoreLifecycle ? 'owned' : 'bootstrap'}`,
      agentId: 'chat-draft-default-agent',
    };
    const component = await mount(ChatDraftDefaultHost, {
      props: { ...scope, ownsStoreLifecycle },
      hooksConfig: { chatDrafts: [{ ...scope, text: 'Saved before the host mounted' }] },
    });
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await expect(editor).toHaveText('Saved before the host mounted');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(component.getByTestId('chat-draft-loading-gate')).toHaveCount(0);
  });
}
