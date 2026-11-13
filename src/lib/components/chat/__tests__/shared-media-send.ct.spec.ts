import { expect, test, pauseClock } from '../../../../test/ct-test';
import SharedMediaSendHarness from './SharedMediaSendHarness.svelte';
for (const mode of [
  'direct',
  'queued',
  'invalid',
  'unavailable',
  'retired',
  'missing-preload',
  'browser-mock',
]) {
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
    if (mode === 'missing-preload' || mode === 'browser-mock') {
      expect(native).toEqual([]);
      expect(JSON.parse((await root.getAttribute('data-platform-probe'))!)).toEqual([
        'media-export-unavailable',
        'media-export-unavailable',
      ]);
    }
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

for (const transcriptCase of ['full', 'trim'] as const) {
  test(`shared transcript timing ${transcriptCase} preserves speech policy at the real send boundary`, async ({
    mount,
    page,
  }, info) => {
    const component = await mount(SharedMediaSendHarness, { props: { transcriptCase } });
    const root = page.getByTestId('shared-media-send');
    await expect(root).toHaveAttribute('data-ready', 'true');
    await component.getByLabel('Draft').fill('Review this recording');
    await component.getByRole('button', { name: 'Send prepared draft' }).click();
    await expect(root).toHaveAttribute(
      'data-result',
      transcriptCase === 'full' ? 'admitted' : 'retained',
    );
    const calls = JSON.parse((await root.getAttribute('data-calls'))!);
    const native = JSON.parse((await root.getAttribute('data-native'))!);
    const sends = calls.filter((row: { method: string }) =>
      ['agent.sendMessage', 'agent.queueMessage'].includes(row.method),
    );
    if (transcriptCase === 'full') {
      expect(sends).toHaveLength(1);
      expect(sends[0].params.messageMetadata.edited_captures[0].transcript).toBe(
        'First middle last',
      );
      expect(sends[0].params.fileBlocks[0].attachmentId).toBe('prepared-video');
      expect(native.filter((action: string) => action === 'export')).toHaveLength(1);
      expect(JSON.parse((await root.getAttribute('data-export'))!).media.saved.voice).toBe(
        'transcript',
      );
    } else {
      expect(sends).toEqual([]);
      expect(native).not.toContain('export');
      expect(
        calls.filter((row: { method: string }) => row.method === 'file.placeAttachment'),
      ).toEqual([]);
      await expect(component.getByLabel('Draft')).toHaveValue('Review this recording');
    }
    await info.attach('transcript-send-boundary', {
      body: JSON.stringify({ transcriptCase, calls, native }),
      contentType: 'application/json',
    });
  });
}

for (const mode of [
  'direct',
  'queued',
  'warm-pending',
  'warm-pending-failure',
  'warm-failed',
  'warm-expired',
  'warm-ttl',
  'retired',
]) {
  test(`owner-local recording preparation ${mode} keeps placement at Send`, async ({
    mount,
    page,
  }, info) => {
    if (mode === 'warm-ttl') await page.clock.install();
    const component = await mount(SharedMediaSendHarness);
    const root = page.getByTestId('shared-media-send');
    await expect(root).toHaveAttribute('data-ready', 'true');
    await component.getByLabel('Send scenario').selectOption(mode);
    await component.getByRole('button', { name: 'Prepare while reviewing' }).click();
    await expect(root).toHaveAttribute('data-exports', '1');
    const native = async (): Promise<string[]> =>
      JSON.parse((await root.getAttribute('data-native'))!);
    const calls = async (): Promise<Array<{ method: string; params: any }>> =>
      JSON.parse((await root.getAttribute('data-calls'))!);
    if (mode === 'warm-failed') await expect.poll(native).toContain('release');
    if (mode === 'warm-ttl') {
      await pauseClock(page);
      await page.clock.fastForward(30_001);
      await expect.poll(native).toContain('release');
      await page.clock.resume();
    }
    expect(
      (await calls()).filter((row) =>
        ['file.placeAttachment', 'agent.sendMessage', 'agent.queueMessage'].includes(row.method),
      ),
    ).toEqual([]);
    await expect(component.getByLabel('Draft')).toHaveValue('Review [[mark:1]] in edited captures');
    if (mode === 'retired') {
      await component.getByRole('button', { name: 'Cancel preparation' }).click();
      await component.getByRole('button', { name: 'Type during preparation' }).click();
      await expect.poll(native).toContain('close');
      expect(
        (await calls()).filter((row) =>
          ['file.placeAttachment', 'agent.sendMessage', 'agent.queueMessage'].includes(row.method),
        ),
      ).toEqual([]);
      await expect(component.getByLabel('Draft')).toHaveValue('New typing survives');
    } else {
      await component.getByRole('button', { name: 'Send prepared draft' }).click();
      if (mode === 'warm-pending' || mode === 'warm-pending-failure') {
        await expect(root).toHaveAttribute('data-result', 'preparing');
        await component.getByRole('button', { name: 'Finish held export' }).click();
      }
      await expect(root).toHaveAttribute(
        'data-result',
        mode === 'warm-pending-failure' ? 'retained' : 'admitted',
      );
      if (mode === 'warm-pending-failure') {
        await expect(root).toHaveAttribute('data-exports', '1');
        expect((await calls()).filter((row) => row.method === 'agent.sendMessage')).toEqual([]);
        await expect(component.getByLabel('Draft')).toHaveValue(
          'Review [[mark:1]] in edited captures',
        );
      } else {
        const count =
          mode === 'warm-failed' || mode === 'warm-expired' || mode === 'warm-ttl' ? '2' : '1';
        await expect(root).toHaveAttribute('data-exports', count);
        const method = mode === 'queued' ? 'agent.queueMessage' : 'agent.sendMessage';
        await expect
          .poll(async () => (await calls()).filter((row) => row.method === method).length)
          .toBe(1);
        const sent = (await calls()).find((row) => row.method === method)!.params;
        expect(sent.fileBlocks.map((row: { attachmentId: string }) => row.attachmentId)).toEqual([
          'prepared-video',
        ]);
        expect(sent.messageMetadata.picked_mentions.agentIds).toEqual(['mentioned-agent']);
        expect(sent.messageMetadata.edited_captures).toHaveLength(2);
        if (mode !== 'warm-failed' && mode !== 'warm-ttl')
          expect(await native()).toContain('adopt');
      }
      await expect.poll(native).toContain('close');
    }
    await info.attach('owner-local-preparation-receipt', {
      body: JSON.stringify({ mode, native: await native(), calls: await calls() }, null, 2),
      contentType: 'application/json',
    });
  });
}

test('recording editor review prepares once and ordinary or peer text stays current at Send', async ({
  mount,
  page,
}, info) => {
  const component = await mount(SharedMediaSendHarness);
  const root = page.getByTestId('shared-media-send');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await component.getByLabel('Send scenario').selectOption('warm-review');
  await component.getByRole('button', { name: /^Clip, 0:01/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(root).toHaveAttribute('data-exports', '1');
  const calls = async (): Promise<Array<{ method: string; params: any }>> =>
    JSON.parse((await root.getAttribute('data-calls'))!);
  expect(
    (await calls()).filter((row) =>
      ['file.placeAttachment', 'agent.sendMessage', 'agent.queueMessage'].includes(row.method),
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await component.getByLabel('Draft').fill('Typed after review [[mark:1]]');
  await expect(root).toHaveAttribute('data-exports', '1');
  await component.getByRole('button', { name: 'Receive peer text' }).click();
  await expect(component.getByLabel('Draft')).toHaveValue('Peer text [[mark:1]] remains current');
  await component.getByRole('button', { name: 'Send prepared draft' }).click();
  await expect(root).toHaveAttribute('data-result', 'admitted');
  await expect(root).toHaveAttribute('data-exports', '1');
  await expect
    .poll(async () => (await calls()).filter((row) => row.method === 'agent.sendMessage').length)
    .toBe(1);
  const sent = (await calls()).find((row) => row.method === 'agent.sendMessage')!.params;
  expect(String(sent.content ?? sent.message)).toContain('Peer text [[mark:1]] remains current');
  expect(sent.fileBlocks[0].attachmentId).toBe('prepared-video');
  expect(sent.messageMetadata.edited_captures).toHaveLength(2);
  await info.attach('review-typing-preparation-receipt', {
    body: JSON.stringify(
      { calls: await calls(), native: await root.getAttribute('data-native') },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
