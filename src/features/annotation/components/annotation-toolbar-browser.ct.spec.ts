import { expect, test } from '../../../test/ct-test';
import type { AnnotationDestination, RequestAnnotationSendRequest } from '$shared/annotation';
import Harness from './__tests__/AnnotationToolbarBrowserHarness.svelte';

type Evidence = {
  acquisitions: number;
  voiceRequests: number;
  voiceReplies: number;
  reviewRequests: number;
  sendRequests: {
    request: RequestAnnotationSendRequest;
    destination: AnnotationDestination;
    transcripts: string[];
  }[];
  sessionStartedAt: number;
  closeRequests: number;
  transcripts: string[];
  draftMessage: string;
};

for (const scenario of ['stop-and-send', 'cancel-pending-send'] as const) {
  test(`real annotation toolbar voice: ${scenario}`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 288, height: 340 });
    await page.clock.install();
    await mount(Harness);
    const host = page.getByTestId('toolbar-browser-host');
    const panel = page.locator('.annotation-toolbar-panel');
    const evidence = async (): Promise<Evidence> =>
      JSON.parse((await host.getAttribute('data-evidence'))!);
    await expect(host).toHaveAttribute('data-ready', 'true');
    await expect(panel).toHaveAttribute('data-voice-state', 'idle');
    await expect(page.getByText('Mic off', { exact: true })).toBeVisible();
    expect((await evidence()).acquisitions).toBe(0);
    await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await expect(panel).toHaveAttribute('data-voice-state', 'requesting');
    await expect(page.locator('.voice-status')).toHaveText('Starting microphone…');
    await expect(page.locator('.elapsed')).toHaveText('');
    expect((await evidence()).acquisitions).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('annotation-test-grant-microphone')));
    await expect(panel).toHaveAttribute('data-voice-state', 'recording');
    await expect(page.locator('.elapsed')).toHaveText('0:00');
    await page.clock.runFor(5250);
    await expect(page.locator('.elapsed')).toHaveText('0:05');
    const recording = testInfo.outputPath('actual-toolbar-recording.png');
    await page.screenshot({ path: recording, animations: 'disabled' });
    await testInfo.attach('Actual toolbar recording at native size', {
      path: recording,
      contentType: 'image/png',
    });

    if (scenario === 'stop-and-send') {
      await page.getByRole('button', { name: 'Stop voice', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
    }
    await expect(panel).toHaveAttribute('data-voice-state', 'transcribing');
    await expect(page.locator('.voice-status')).toHaveText('Transcribing…');
    await expect.poll(async () => (await evidence()).voiceRequests).toBe(1);
    await expect(page.locator('.elapsed')).toHaveText('');
    expect((await evidence()).sendRequests).toEqual([]);

    if (scenario === 'cancel-pending-send') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect.poll(async () => (await evidence()).closeRequests).toBe(1);
      await expect(panel).toHaveAttribute('data-voice-state', 'idle');
    }
    await page.evaluate(() => window.dispatchEvent(new Event('annotation-test-deliver-voice')));
    await expect.poll(async () => (await evidence()).voiceReplies).toBe(1);
    await expect(panel).toHaveAttribute('data-voice-state', 'idle');
    if (scenario === 'stop-and-send') {
      await expect.poll(async () => (await evidence()).transcripts.length).toBe(1);
      await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
      await expect.poll(async () => (await evidence()).sendRequests.length).toBe(1);
      const result = await evidence();
      expect(result.transcripts).toEqual([
        expect.stringMatching(/^\[\d+:\d{2}\] Keep the navigation visible\.$/),
      ]);
      expect(result.sendRequests).toEqual([
        {
          request: { startedAt: result.sessionStartedAt },
          destination: {
            workspaceId: 'toolbar-browser',
            workspaceTitle: 'Navigation feedback',
            agentId: null,
          },
          transcripts: result.transcripts,
        },
      ]);
      expect(result.closeRequests).toBe(0);
    } else {
      // Let any resumed async continuations settle before checking the negative boundary.
      await page.clock.runFor(1000);
      expect((await evidence()).transcripts).toEqual([]);
      expect((await evidence()).sendRequests).toEqual([]);
      expect((await evidence()).draftMessage).toBe('Preserve this feedback draft.');
    }
    expect((await evidence()).reviewRequests).toBe(0);
    await testInfo.attach(`actual-toolbar-${scenario}.json`, {
      body: JSON.stringify(await evidence(), null, 2),
      contentType: 'application/json',
    });
  });
}
