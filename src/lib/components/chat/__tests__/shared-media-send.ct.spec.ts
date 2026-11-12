import { expect, test } from '../../../../test/ct-test';
import SharedMediaSendHarness from './SharedMediaSendHarness.svelte';
for (const mode of ['direct', 'queued', 'invalid', 'unavailable', 'retired']) {
  test(`shared capture main send ${mode} preserves prepared media or retains draft`, async ({
    mount,
    page,
  }, info) => {
    const component = await mount(SharedMediaSendHarness);
    const root = page.getByTestId('shared-media-send');
    await expect(root).toHaveAttribute('data-ready', 'true');
    await component.getByLabel('Send scenario').selectOption(mode);
    await component.getByRole('button', { name: 'Send prepared draft' }).click();
    if (mode === 'retired') {
      await expect
        .poll(async () => JSON.parse((await root.getAttribute('data-native'))!))
        .toContain('export');
      await component.getByRole('button', { name: 'Type during preparation' }).click();
    }
    await expect(root).toHaveAttribute(
      'data-result',
      mode === 'direct' || mode === 'queued' ? 'admitted' : 'retained',
    );
    const calls = async () => JSON.parse((await root.getAttribute('data-calls'))!);
    if (mode === 'direct' || mode === 'queued') {
      const method = mode === 'direct' ? 'agent.sendMessage' : 'agent.queueMessage';
      await expect
        .poll(
          async () =>
            (await calls()).filter((row: { method: string }) => row.method === method).length,
        )
        .toBe(1);
      const request = (await calls()).find(
        (row: { method: string }) => row.method === method,
      ).params;
      expect(request.fileBlocks.map((b: { attachmentId: string }) => b.attachmentId)).toEqual([
        'prepared-video',
      ]);
      expect(request.imageBlocks).toHaveLength(1);
      expect(JSON.stringify([request.imageBlocks, request.fileBlocks])).not.toContain('raw-');
      expect(request.messageMetadata.picked_mentions.agentIds).toEqual(['mentioned-agent']);
      expect(request.messageMetadata.edited_captures).toHaveLength(2);
      expect(request.messageMetadata.images[0]).toMatchObject({
        id: 'image-one',
        width: 32,
        height: 32,
        attachment_id: request.imageBlocks[0].attachmentId,
      });
      const screenshot = request.messageMetadata.edited_captures.find(
        (row: { id: string }) => row.id === 'image-one',
      );
      expect(screenshot.marks).toEqual([
        expect.objectContaining({
          n: 1,
          id: 'saved-mark',
          kind: 'box',
          label: 'Inspect this control',
          note: 'Saved screenshot annotation',
          context: { selector: '#synthetic-control', text: 'Synthetic control', url: null },
        }),
      ]);
      expect(String(request.content ?? request.message)).toContain('Review [[mark:1]]');
      expect(String(request.content ?? request.message)).toContain('[Edited capture outputs]');
      const exported = JSON.parse((await root.getAttribute('data-export'))!);
      expect(exported.media.saved.voice).toBe('off');
      expect(exported.media.saved.trim).toEqual({ startMs: 100, endMs: 900 });
      expect(exported.media.saved.cuts).toEqual([{ startMs: 400, endMs: 500 }]);
      const png = (await root.getAttribute('data-png'))!;
      const size = await root.evaluate(async (_node, base64) => {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        );
        const size = [image.width, image.height];
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const g = canvas.getContext('2d')!;
        g.drawImage(image, 0, 0);
        const pixels = g.getImageData(0, 0, image.width, image.height).data;
        let colored = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
              Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
            30
          )
            colored++;
        image.close();
        return { size, colored };
      }, png);
      expect(size.size).toEqual([32, 32]);
      expect(size.colored).toBeGreaterThan(0);
      await component.getByRole('button', { name: 'Acknowledge send' }).click();
      await expect(component.getByLabel('Draft')).toHaveValue('');
    } else {
      expect(
        (await calls()).filter((row: { method: string }) =>
          ['agent.sendMessage', 'agent.queueMessage'].includes(row.method),
        ),
      ).toEqual([]);
      await expect(component.getByLabel('Draft')).toHaveValue(
        mode === 'retired' ? 'New typing survives' : 'Review [[mark:1]] in edited captures',
      );
    }
    const native = JSON.parse((await root.getAttribute('data-native'))!);
    if (mode === 'direct' || mode === 'queued')
      expect(native).toEqual(['begin', 'export', 'release', 'close']);
    await info.attach('shared-media-send-receipt', {
      body: JSON.stringify(
        { mode, calls: await calls(), native, export: await root.getAttribute('data-export') },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}
