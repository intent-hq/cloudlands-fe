// TEST ONLY append-owned capture. A deadline is not physical IO settlement.
async function captureIntoPrivateStore({ capture, store, marker, signal }) {
  const { clip, dpr } = marker;
  if (
    dpr !== 1 ||
    !Object.values(clip).every(Number.isInteger) ||
    clip.x < 0 ||
    clip.y < 0 ||
    clip.width < 1 ||
    clip.width > 256 ||
    clip.height < 1 ||
    clip.height > 64
  )
    throw new Error('Invalid bounded test capture');
  signal.throwIfAborted();
  const image = await capture(clip); // Actual underlying Promise stays owned until settlement.
  signal.throwIfAborted();
  const size = image.getSize();
  if (size.width !== clip.width || size.height !== clip.height)
    throw new Error('Capture profile mismatch');
  const decoded = image.toBitmap().length;
  if (decoded !== size.width * size.height * 4 || decoded > 65536)
    throw new Error('Decoded capture exceeds budget');
  const png = image.toPNG();
  if (png.length > 65536) throw new Error('Encoded capture exceeds fixture budget');
  let chunkStart,
    chunks = 0;
  for (let at = 0; at < png.length; at += 6144) {
    signal.throwIfAborted();
    const ordinal = await store.append('tile-chunk', {
      base64: png.subarray(at, at + 6144).toString('base64'),
    });
    chunkStart ??= ordinal;
    chunks++;
  }
  signal.throwIfAborted();
  await store.append('tile', {
    ...marker,
    chunkStart,
    chunks,
    pngBytes: png.length,
    decodedBytes: decoded,
    size,
  });
  return { pngBytes: png.length, decodedBytes: decoded, chunks };
}
module.exports = { captureIntoPrivateStore };
