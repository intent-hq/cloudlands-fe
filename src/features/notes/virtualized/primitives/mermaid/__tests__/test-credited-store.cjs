// TEST ONLY wrapper. Durable credits remain owned until the backing store is deleted.
function creditStore(store, credit, owner) {
  const durable = [];
  return {
    async append(kind, value) {
      const lease = credit.reserve(owner + ':record:' + kind, {
        encodedBytes: 61452,
        pendingWrites: 1,
        storageBytes: 12288,
        indexBytes: 12,
      });
      let attempted = false;
      try {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes > 12288) throw new Error('Private record exceeds reserved bytes');
        attempted = true;
        durable.push(lease);
        const ordinal = await store.append(kind, value);
        lease.shrink({ storageBytes: bytes, indexBytes: 12 });
        return ordinal;
      } catch (error) {
        if (attempted) lease.shrink({ storageBytes: 12288, indexBytes: 12 });
        else lease.release();
        throw error;
      }
    },
    async seal(identity) {
      const lease = credit.reserve(owner + ':disk-manifest', {
        encodedBytes: 61452,
        pendingWrites: 1,
        manifestBytes: 12288,
      });
      durable.push(lease);
      try {
        const manifest = await store.seal(identity);
        const bytes = Buffer.byteLength(JSON.stringify(manifest));
        if (bytes > 12288) throw new Error('Manifest exceeds reserved bytes');
        lease.shrink({ manifestBytes: bytes });
        return manifest;
      } catch (error) {
        lease.shrink({ manifestBytes: 12288 });
        throw error;
      }
    },
    async abort() {
      await store.abort();
      for (const lease of durable) lease.release();
      durable.length = 0;
    },
  };
}
module.exports = { creditStore };
