// TEST ONLY private disk artifact. No daemon/provider capability or canonical wire schema.
const fs = require('node:fs/promises');
const { join } = require('node:path');
const RECORD_BYTES = 12288;
const PAGE_BYTES = 16384;
const ENTRY_BYTES = 12;
const validKind = (kind) => /^[a-z][a-z-]{0,31}$/.test(kind);
async function createTestPaintStore(root, { beforeDataWrite } = {}) {
  await fs.mkdir(root, { recursive: true });
  const writers = new Map();
  let sealed = false;
  let busy = false;
  async function close() {
    for (const item of writers.values()) {
      await item.data.close();
      await item.index.close();
    }
    writers.clear();
  }
  return {
    async append(kind, value) {
      if (sealed || busy || !validKind(kind)) throw new Error('Invalid private artifact write');
      busy = true;
      try {
        const bytes = Buffer.from(JSON.stringify(value));
        if (bytes.length > RECORD_BYTES) throw new Error('Private record exceeds budget');
        let writer = writers.get(kind);
        if (!writer) {
          if (writers.size >= 16) throw new Error('Too many private record kinds');
          writer = {
            data: await fs.open(join(root, kind + '.data'), 'wx'),
            index: await fs.open(join(root, kind + '.index'), 'wx'),
            count: 0,
            offset: 0,
          };
          writers.set(kind, writer);
        }
        const ordinal = writer.count;
        const index = Buffer.alloc(ENTRY_BYTES);
        index.writeBigUInt64LE(BigInt(writer.offset), 0);
        index.writeUInt32LE(bytes.length, 8);
        // Test scheduler barrier can hold a real disk write before it starts.
        // The append remains busy until both physical data and index writes settle.
        await beforeDataWrite?.();
        await writer.data.writeFile(bytes);
        await writer.index.writeFile(index);
        writer.offset += bytes.length;
        writer.count++;
        return ordinal;
      } finally {
        busy = false;
      }
    },
    async seal(identity) {
      if (busy || sealed) throw new Error('Private artifact is not sealable');
      const manifest = {
        identity,
        counts: Object.fromEntries([...writers].map(([kind, value]) => [kind, value.count])),
        sizes: Object.fromEntries(
          [...writers].map(([kind, value]) => [
            kind,
            {
              dataBytes: value.offset,
              indexBytes: value.count * ENTRY_BYTES,
            },
          ]),
        ),
      };
      const bytes = Buffer.from(JSON.stringify(manifest));
      if (bytes.length > RECORD_BYTES) throw new Error('Private manifest exceeds budget');
      for (const writer of writers.values()) {
        await writer.data.sync();
        await writer.index.sync();
      }
      await close();
      await fs.writeFile(join(root, 'manifest.json'), bytes, { flag: 'wx' });
      sealed = true;
      return manifest;
    },
    async abort() {
      if (busy) throw new Error('Capture/write must physically settle before abort');
      await close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function openTestPaintReader(root) {
  const manifestFile = await fs.open(join(root, 'manifest.json'), 'r');
  let manifest;
  try {
    if ((await manifestFile.stat()).size > RECORD_BYTES)
      throw new Error('Private manifest exceeds budget');
    manifest = JSON.parse(await manifestFile.readFile('utf8'));
  } finally {
    await manifestFile.close();
  }
  let active = false;
  return {
    manifest,
    async read(kind, start, limit = 16) {
      if (
        active ||
        !validKind(kind) ||
        !Number.isInteger(start) ||
        start < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 16
      )
        throw new Error('Invalid private artifact query');
      active = true;
      let data, index;
      try {
        const count = manifest.counts[kind] ?? 0;
        const page = {
          records: [],
          next: start,
          done: start >= count,
          indexBytes: 0,
          dataBytes: 0,
        };
        if (start >= count) return page;
        data = await fs.open(join(root, kind + '.data'), 'r');
        index = await fs.open(join(root, kind + '.index'), 'r');
        for (let ordinal = start; ordinal < Math.min(count, start + limit); ordinal++) {
          const entry = Buffer.alloc(ENTRY_BYTES);
          if (
            (await index.read(entry, 0, ENTRY_BYTES, ordinal * ENTRY_BYTES)).bytesRead !==
            ENTRY_BYTES
          )
            throw new Error('Truncated private index');
          page.indexBytes += ENTRY_BYTES;
          const offset = Number(entry.readBigUInt64LE(0)),
            size = entry.readUInt32LE(8);
          if (!Number.isSafeInteger(offset) || size > RECORD_BYTES)
            throw new Error('Invalid private index');
          const buffer = Buffer.alloc(size);
          if ((await data.read(buffer, 0, size, offset)).bytesRead !== size)
            throw new Error('Truncated private record');
          page.dataBytes += size;
          const record = JSON.parse(buffer.toString('utf8'));
          const next = {
            ...page,
            records: [...page.records, record],
            next: ordinal + 1,
            done: ordinal + 1 === count,
          };
          if (Buffer.byteLength(JSON.stringify(next)) > PAGE_BYTES) break;
          Object.assign(page, next);
        }
        if (!page.records.length) throw new Error('Private record cannot fit response');
        return page;
      } finally {
        await data?.close();
        await index?.close();
        active = false;
      }
    },
  };
}
module.exports = { createTestPaintStore, openTestPaintReader, RECORD_BYTES, PAGE_BYTES };
