// TEST ONLY composition of the frozen public host and private disk artifact.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { StringDecoder } = require('node:string_decoder');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { createTestPaintStore, openTestPaintReader } = require('./test-paint-store.cjs');
const { captureIntoPrivateStore } = require('./test-paint-capture.cjs');
const [managerEntry, rendererRoot, root] = process.argv.slice(-3);
app.setPath('userData', join(root, 'profile'));
app.setPath('sessionData', join(root, 'session'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app
  .whenReady()
  .then(async () => {
    const { PrimitiveConstructionHost } = await import(pathToFileURL(managerEntry).href);
    const source = await fs.open(join(root, 'source.txt'), 'r');
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(join(root, 'source.txt'))) hash.update(bytes);
    const options = JSON.parse(await fs.readFile(join(root, 'options.json'), 'utf8'));
    const identity = {
      backendId: 'test',
      workspaceId: 'test',
      noteId: 'test',
      noteInstanceId: 'test',
      ownerRef: 'test-native-mermaid-scene',
      sourceRef: hash.digest('hex'),
      profileId: 'test-mermaid-paint/v1',
      jobId: 'test-' + Date.now(),
      source: { kind: 'snapshot', snapshotId: 'test-snapshot', sourceRevision: 'test-revision' },
    };
    const profile = {
      width: 640,
      height: 320,
      theme: options.dark ? 'dark' : 'light',
      font: '"Inter Variable", sans-serif',
      fontSize: 14,
      devicePixelRatio: 1,
    };
    const state = {
      status: 'pending',
      released: false,
      aborted: false,
      captureCount: 0,
      maxPngBytes: 0,
      maxDecodedBytes: 0,
      pngBytesWritten: 0,
      decodedCaptureBytes: 0,
      liveCaptures: 0,
      peakCaptures: 0,
      rendererPid: 0,
      retired: false,
      current: true,
      writeHeld: false,
      oracleCount: 0,
      maxOracleDecodedBytes: 0,
      maxOraclePngBytes: 0,
      conservativeDecodedCopyBytes: 0,
      conservativeEncodedOverlapBytes: 0,
      maxChunkBase64Units: 8192,
      maxPrivateRecordBytes: 12288,
      queryCount: 0,
      maxQueryBytes: 0,
    };
    const privateRoot = join(root, 'private-artifact');
    let releaseWrite,
      holdNextWrite = false;
    const store = await createTestPaintStore(privateRoot, {
      beforeDataWrite: async () => {
        if (!holdNextWrite) return;
        holdNextWrite = false;
        state.writeHeld = true;
        await new Promise((resolve) => {
          releaseWrite = resolve;
        });
        state.writeHeld = false;
      },
    });
    const manager = new PrimitiveConstructionHost({
      entry: join(rendererRoot, 'index.html'),
      preload: join(rendererRoot, 'preload.cjs'),
      adapters: ['test-mermaid-paint'],
    });
    let reader, consumer;
    const decoder = new StringDecoder('utf8');
    const handle = manager.submit({
      identity,
      profile,
      adapter: 'test-mermaid-paint',
      resources: {
        isCurrent: (candidate) => state.current && isDeepStrictEqual(candidate, identity),
        async read(sequence, maxBytes, signal) {
          signal.throwIfAborted();
          const buffer = Buffer.alloc(maxBytes - 4);
          const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
          return {
            data: bytesRead ? decoder.write(buffer.subarray(0, bytesRead)) : decoder.end(),
            done: bytesRead === 0,
          };
        },
        async append(_sequence, data, signal) {
          signal.throwIfAborted();
          const record = JSON.parse(data);
          if (!isDeepStrictEqual(record.value.identity, identity))
            throw new Error('Record identity mismatch');
          if (record.kind !== 'test-capture') {
            await store.append(record.kind, record.value);
            return;
          }
          const active = manager.inspect().active;
          if (
            !active ||
            active.identity.jobId !== identity.jobId ||
            !isDeepStrictEqual(record.value.identity, identity) ||
            !active.windowId ||
            active.retiring
          )
            throw new Error('Capture owner mismatch');
          const window = BrowserWindow.fromId(active.windowId);
          if (
            !window ||
            window.isDestroyed() ||
            window.webContents.getZoomFactor() !== 1 ||
            record.value.dpr !== profile.devicePixelRatio
          )
            throw new Error('Capture profile mismatch');
          const clip = record.value.clip;
          if (clip.x + clip.width > profile.width || clip.y + clip.height > profile.height)
            throw new Error('Capture outside construction viewport');
          state.rendererPid = window.webContents.getOSProcessId();
          state.liveCaptures++;
          state.peakCaptures = Math.max(state.peakCaptures, state.liveCaptures);
          try {
            if (record.value.band === 0) {
              // Independent full native compositor oracle, private construction evidence only.
              // This oracle is never returned from the indexed consumer API.
              const oracle = await window.webContents.capturePage(
                { x: 0, y: 0, width: 256, height: 256 },
                { stayHidden: true, stayAwake: true },
              );
              signal.throwIfAborted();
              const size = oracle.getSize();
              const decoded = oracle.toBitmap().length;
              if (size.width !== 256 || size.height !== 256 || decoded !== 262144)
                throw new Error('Native full-frame oracle dimensions mismatch');
              const encoded = oracle.toPNG();
              if (encoded.length > 1048576)
                throw new Error('Native oracle encoding exceeds budget');
              state.maxOracleDecodedBytes = Math.max(state.maxOracleDecodedBytes, decoded);
              state.maxOraclePngBytes = Math.max(state.maxOraclePngBytes, encoded.length);
              await fs.writeFile(join(root, 'oracle-' + record.value.camera + '.png'), encoded, {
                flag: 'wx',
              });
              signal.throwIfAborted();
              state.oracleCount++;
            }
            if (options.holdWrite && state.captureCount === 0) holdNextWrite = true;
            const cost = await captureIntoPrivateStore({
              capture: (rect) =>
                window.webContents.capturePage(rect, { stayHidden: true, stayAwake: true }),
              store,
              marker: record.value,
              signal,
            });
            state.captureCount++;
            state.maxPngBytes = Math.max(state.maxPngBytes, cost.pngBytes);
            state.maxDecodedBytes = Math.max(state.maxDecodedBytes, cost.decodedBytes);
            state.pngBytesWritten += cost.pngBytes;
            state.decodedCaptureBytes += cost.decodedBytes;
            // Payload/copy accounting only: NativeImage storage, GC and GPU residency are unmeasured.
            // Conservatively charge oracle+band NativeImages AND copied RGBA buffers together.
            state.conservativeDecodedCopyBytes =
              2 * (state.maxOracleDecodedBytes + state.maxDecodedBytes);
            state.conservativeEncodedOverlapBytes = state.maxOraclePngBytes + state.maxPngBytes;
          } finally {
            state.liveCaptures--;
          }
        },
        async seal() {
          await store.seal(identity);
          return { artifactRef: 'test-only-private-paint' };
        },
        async abort() {
          await store.abort();
          state.aborted = true;
        },
        async release() {
          await source.close();
          state.released = true;
        },
      },
    });
    globalThis.persistedPaint = {
      cancel() {
        state.current = false;
        return handle.cancel();
      },
      releaseWrite() {
        releaseWrite?.();
      },
      state,
      identity,
      profile,
      manager,
      handle,
      async openConsumer() {
        if (state.status !== 'resolved' || !state.retired || !state.released || state.liveCaptures)
          throw new Error('Artifact not physically ready');
        if (!consumer) {
          consumer = new BrowserWindow({
            width: 640,
            height: 320,
            useContentSize: true,
            show: false,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              backgroundThrottling: false,
              partition: 'test-reader-' + identity.jobId,
            },
          });
          await consumer.loadURL(
            'data:text/html,' +
              encodeURIComponent(
                '<body style="margin:0;background:' +
                  (profile.theme === 'dark' ? '#171717' : '#ffffff') +
                  '"></body>',
              ),
          );
        }
        return consumer.webContents.id;
      },
      async read(kind, start, limit) {
        if (!reader || !state.retired || state.status !== 'resolved')
          throw new Error('Private artifact unavailable');
        const page = await reader.read(kind, start, limit);
        state.queryCount++;
        state.maxQueryBytes = Math.max(
          state.maxQueryBytes,
          Buffer.byteLength(JSON.stringify(page)),
        );
        return page;
      },
      async compareOracle(camera) {
        if (!consumer || !state.retired || ![0, 1].includes(camera))
          throw new Error('Invalid oracle comparison');
        // Test supervisor only. Neither full oracle nor constructor is exposed to the reader.
        const captured = await consumer.webContents.capturePage(
          { x: 0, y: 0, width: 256, height: 256 },
          { stayHidden: true, stayAwake: true },
        );
        const encoded = await fs.readFile(join(root, 'oracle-' + camera + '.png'));
        const expectedImage = nativeImage.createFromBuffer(encoded);
        const expected = expectedImage.toBitmap(),
          actual = captured.toBitmap();
        if (expected.length !== 262144 || actual.length !== expected.length)
          throw new Error('Oracle comparison size mismatch');
        let total = 0,
          different = 0;
        for (let i = 0; i < actual.length; i += 4) {
          let max = 0;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(actual[i + c] - expected[i + c]);
            total += delta;
            max = Math.max(max, delta);
          }
          if (max > 8) different++;
        }
        await fs.writeFile(join(root, 'replayed-' + camera + '.png'), captured.toPNG());
        return {
          meanChannelError: total / actual.length,
          differentFraction: different / (256 * 256),
          decodedBytes: actual.length,
        };
      },
      inspect() {
        return {
          state,
          manager: manager.inspect(),
          counts: reader?.manifest.counts,
          sizes: reader?.manifest.sizes,
        };
      },
    };
    handle.result
      .then(async (result) => {
        await manager.dispose();
        try {
          process.kill(result.rendererPid, 0);
          throw new Error('Construction process remains alive');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        state.retired = true;
        reader = await openTestPaintReader(privateRoot);
        state.result = result;
        state.status = 'resolved';
      })
      .catch(async (error) => {
        await manager.dispose();
        if (state.rendererPid) {
          try {
            process.kill(state.rendererPid, 0);
          } catch (retired) {
            if (retired.code === 'ESRCH') state.retired = true;
            else throw retired;
          }
        }
        state.status = 'rejected';
        state.error = String(error.stack || error);
      });
  })
  .catch((error) => {
    globalThis.persistedPaintError = String(error.stack || error);
  });
app.on('window-all-closed', () => {
  /* Construction can retire before the new reader opens. */
});
