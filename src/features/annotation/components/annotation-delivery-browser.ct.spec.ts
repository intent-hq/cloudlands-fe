import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/AnnotationDeliveryBrowserHarness.svelte';

type Evidence = {
  requests: { method: string; params: { messageId?: string } }[];
  outcomes: string[];
  voiceStatus: string;
  voiceReplies: number;
  transcriptActions: number;
  draftMessage: string;
  messageId: string;
};

for (const scenario of ['retired', 'duplicate', 'uncertain', 'voice'] as const) {
  test(`real feedback delivery boundary: ${scenario}`, async ({ mount, page }, testInfo) => {
    await mount(Harness, { props: { scenario } });
    const host = page.getByTestId('delivery-boundary');
    await expect(host).toHaveAttribute('data-ready', 'true');
    const evidence = async (): Promise<Evidence> =>
      JSON.parse((await host.getAttribute('data-evidence'))!);
    const sends = async () =>
      (await evidence()).requests.filter((row) => row.method === 'agent.sendMessage');

    if (scenario === 'voice') {
      await page.getByRole('button', { name: 'Start voice', exact: true }).click();
      await expect.poll(async () => (await evidence()).voiceStatus).toBe('recording');
      await page.getByRole('button', { name: 'Stop voice', exact: true }).click();
      await expect
        .poll(async () =>
          (await evidence()).requests.some((row) => row.method === 'voice:transcribe-local'),
        )
        .toBe(true);
      await page.getByRole('button', { name: 'Cancel voice', exact: true }).click();
      await page.getByRole('button', { name: 'Deliver late voice', exact: true }).click();
      await expect.poll(async () => (await evidence()).voiceReplies).toBe(1);
      expect((await evidence()).transcriptActions).toBe(0);
      expect((await evidence()).draftMessage).toBe('Draft survives cancellation.');
      expect((await evidence()).voiceStatus).toBe('cancelled');
    } else {
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      if (scenario === 'retired') {
        await expect.poll(async () => (await evidence()).outcomes).toEqual(['annotation-no-agent']);
        expect(await sends()).toHaveLength(0);
      } else if (scenario === 'duplicate') {
        await expect.poll(async () => (await sends()).length).toBe(1);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect
          .poll(async () => (await evidence()).outcomes)
          .toContain('Annotation delivery is already pending');
        await page.getByRole('button', { name: 'Release delivery', exact: true }).click();
        await expect.poll(async () => (await evidence()).outcomes).toContain('sent');
        expect(await sends()).toHaveLength(1);
      } else {
        await expect
          .poll(async () => (await evidence()).outcomes)
          .toEqual(['annotation-send-failed']);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect
          .poll(async () => (await evidence()).outcomes)
          .toEqual(['annotation-send-failed', 'sent']);
        const record = await evidence();
        expect(record.requests.map((row) => row.method)).toContain('agent.getQueue');
        expect(record.requests.map((row) => row.method)).toContain('agent.getConversation');
        expect(await sends()).toHaveLength(1);
        expect((await sends())[0].params.messageId).toBe(record.messageId);
      }
    }
    await testInfo.attach(`feedback-${scenario}-boundary.json`, {
      body: JSON.stringify(await evidence(), null, 2),
      contentType: 'application/json',
    });
  });
}
