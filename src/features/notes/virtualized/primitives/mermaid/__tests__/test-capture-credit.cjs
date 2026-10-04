// TEST ONLY logical admission credits. Release is not proof of GC/GPU reclamation.
const dimensions = [
  'markerBytes',
  'nativeImageBytes',
  'bitmapBytes',
  'encodedBytes',
  'pendingCaptures',
  'pendingWrites',
  'storageBytes',
  'indexBytes',
  'manifestBytes',
  'oracleBytes',
];
function createCaptureCredit(limits) {
  const live = Object.fromEntries(dimensions.map((k) => [k, 0]));
  const peak = { ...live },
    leases = new Map();
  let sequence = 0,
    refused = 0;
  for (const k of dimensions)
    if (!Number.isSafeInteger(limits[k]) || limits[k] < 0)
      throw new Error('Invalid test credit limit');
  function vector(cost) {
    if (Object.keys(cost).some((k) => !dimensions.includes(k)))
      throw new Error('Unknown credit dimension');
    return Object.fromEntries(
      dimensions.map((k) => {
        const n = cost[k] ?? 0;
        if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid test credit');
        return [k, n];
      }),
    );
  }
  return {
    reserve(owner, cost) {
      if (!owner) throw new Error('Missing credit owner');
      const held = vector(cost);
      if (dimensions.some((k) => held[k] > limits[k] - live[k])) {
        refused++;
        throw new Error('Test capture credit refused');
      }
      const id = ++sequence;
      leases.set(id, { owner, held });
      for (const k of dimensions) {
        live[k] += held[k];
        peak[k] = Math.max(peak[k], live[k]);
      }
      let released = false;
      return {
        shrink(cost) {
          if (released) throw new Error('Released credit');
          const next = vector(cost);
          if (dimensions.some((k) => next[k] > held[k]))
            throw new Error('Credit cannot grow after admission');
          for (const k of dimensions) {
            live[k] -= held[k] - next[k];
            held[k] = next[k];
          }
        },
        release() {
          if (released) return;
          released = true;
          for (const k of dimensions) live[k] -= held[k];
          leases.delete(id);
        },
      };
    },
    inspect() {
      return {
        live: { ...live },
        peak: { ...peak },
        refused,
        owners: [...leases.values()].map((v) => ({ owner: v.owner, held: { ...v.held } })),
        limitation:
          'Logical ownership credits; native allocation/GC/GPU physical retirement unmeasured',
      };
    },
  };
}
const defaultCaptureLimits = Object.fromEntries(
  dimensions.map((k) => [
    k,
    k === 'pendingCaptures' ? 1 : k === 'pendingWrites' ? 1 : 32 * 1024 * 1024,
  ]),
);
function captureCreditCost(clip, dpr, oracle) {
  if (
    ![1, 2].includes(dpr) ||
    ![clip.width, clip.height].every((n) => Number.isInteger(n) && n > 0)
  )
    throw new Error('Invalid test capture profile');
  const band = clip.width * clip.height * dpr * dpr * 4;
  const frame = oracle ? 256 * 256 * dpr * dpr * 4 : 0;
  const png = 65536 * dpr * dpr;
  const oraclePng = oracle ? 1048576 * dpr * dpr : 0;
  // Bounds are reserved before capture/encoding, not derived from completed counters.
  return {
    pendingCaptures: 1,
    nativeImageBytes: band + frame,
    bitmapBytes: band + frame,
    encodedBytes: 2 * (png + oraclePng) + 16384,
    // Generated capture output has credit before capture begins. Per-write credits
    // deliberately overlap this envelope until actual durable records are retained.
    storageBytes: (Math.ceil(png / 6144) + 3) * 12288,
    indexBytes: (Math.ceil(png / 6144) + 3) * 12,
  };
}
module.exports = { createCaptureCredit, defaultCaptureLimits, captureCreditCost };
