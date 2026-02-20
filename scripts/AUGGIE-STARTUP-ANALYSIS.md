# Auggie Startup Time Analysis

## Summary

Auggie (`@augmentcode/auggie`) takes approximately **600-700ms** to start up and respond to the first request. This is the irreducible minimum time from process spawn to first response.

## Benchmark Results

```
📊 Results (5 successful runs):

┌─────────────────────────┬─────────┬─────────┬─────────┐
│ Phase                   │   Avg   │   Min   │   Max   │
├─────────────────────────┼─────────┼─────────┼─────────┤
│ Process spawn           │     2ms │     1ms │     4ms │
│ First byte from auggie  │   619ms │   593ms │   684ms │
│ Initialize req/resp     │   616ms │   591ms │   680ms │
│ Authenticate req/resp   │     1ms │     1ms │     2ms │
│ Session/new req/resp    │     1ms │     1ms │     1ms │
│ TOTAL                   │   621ms │   595ms │   686ms │
└─────────────────────────┴─────────┴─────────┴─────────┘
```

## Timeline Breakdown

| Time | Event |
|------|-------|
| 0-2ms | Process spawn |
| 2-13ms | Request sent |
| 13-165ms | Node.js startup, built-in module loading |
| 165-600ms | Auggie internal initialization (bundled code execution) |
| 600ms+ | Response received |

## Root Cause Analysis

### What's NOT the bottleneck:
- ❌ Process spawn (~2ms) - Very fast
- ❌ Protocol handshake after init (~2-4ms) - Authenticate + session/new are instant
- ❌ Network/IPC overhead (~1ms) - Negligible

### What IS the bottleneck:
- ✅ **Auggie internal initialization (~600ms)** - This is the time for:
  1. Node.js runtime initialization (~150ms)
  2. Module resolution & loading (~100ms)
  3. Bundled code execution (~350ms)
  4. Internal service initialization (part of above)

### Configuration Flags Tested

| Configuration | Result |
|---------------|--------|
| `--acp` | ~629ms (baseline) |
| `--acp --allow-indexing` | ~619ms (slightly faster) |
| `AUGMENT_DISABLE_INDEXING=1` | ~636ms (no improvement) |
| `--acp --no-warmup` | Failed (not supported) |
| No workspace path | High variance, timeouts |

## What Intent App Can Do

### Already Implemented ✅
1. **Agent Pre-warming** - Spawn auggie when workspace opens
2. **Fire-and-forget setMode** - Don't block on auggie response

### Potential Further Optimizations 🔄

1. **Increase idle timeout** (currently 5 minutes)
   - Keep warm agents alive for 15-30 minutes
   - Reduces frequency of cold starts

2. **Pre-warm second agent after first is consumed**
   - When user creates first agent, immediately start warming a second
   - Maintains a "hot spare" pool

3. **Warm multiple agents per workspace**
   - For power users who frequently create new agents
   - Trade memory for instant agent creation

## Recommendations for Auggie Team

The following could reduce startup time from ~600ms to ~100-200ms:

1. **V8 Snapshot/Startup Snapshot**
   - Use `v8.startupSnapshot` to serialize initialized state
   - Eliminates code parsing/execution time on startup
   - Potential savings: 300-400ms

2. **Lazy Loading**
   - Defer loading of non-essential modules
   - Only load what's needed for ACP protocol immediately
   - Load LLM integrations, tool handlers on first use

3. **Consider Bun Runtime**
   - Bun has significantly faster startup than Node.js
   - Would require testing for compatibility

4. **Optimized Bundle**
   - Current bundle appears to be esbuild output
   - Could try bundling with tree-shaking for unused code paths

## Scripts Created

- `scripts/benchmark-auggie.ts` - Measure auggie startup time
- `scripts/profile-auggie-startup.ts` - Compare different configurations
- `scripts/trace-auggie-startup.ts` - Trace startup timeline
- `scripts/deep-profile-auggie.ts` - Deep profiling with V8 flags

## Conclusion

The ~600ms auggie startup time is **external to the Intent app** and can only be optimized by the Auggie team. The Intent app has already implemented the most effective mitigation (agent pre-warming), which makes the startup time invisible to users in most cases.

For users who create agents faster than pre-warming can keep up, the only visible delay will be the ~600-700ms auggie startup time.
