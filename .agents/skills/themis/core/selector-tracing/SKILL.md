---
name: core/selector-tracing
description: >-
  Diagnose Store-created selector performance from opt-in interval aggregates
  and privacy-safe lifetime summaries. Covers the flat traceSelectors contract,
  execution, cache, invalidation, argument, result, cadence, and Redux action records,
  bounded p95 interpretation, lifecycle, and production safety across all Store
  families.
type: sub-skill
requires:
  - core
triggers:
  - selector tracing
  - selector performance diagnosis
  - selector trace summary
  - selector cache hit
  - selector invalidation
  - selector cadence
---
# Selector tracing — evidence-oriented performance diagnosis

Use this skill when an agent must explain selector recomputation, output-cache
reuse, invalidation, scheduling, or selector duration. The authoritative public
reference is `@augmentcode/themis/docs/SELECTORS.md`; selector tracing types and
runtime behavior are implementation evidence, not a second public API.

## 1. Scope and safety rules

- Tracing is an opt-in diagnostic and is disabled by default in every build. Enable it only
  for a focused reproduction, then remove it or set it back to `false`.
- Tracing never provides selector argument values, selector result values, or
  Redux state values. Do not ask a user to capture them from logs, infer them
  from path names, or paste them into a report.
- Treat `selectorSource` as callback identity only. It is limited to the first
  five source lines and 500 characters; it is not a state snapshot.
- Trace counts describe the observed Store instance and selector identity. Do
  not compare counts from unrelated runs or Store instances without recording
  that boundary.
- Prefer the smallest event-category set that answers the question. A broad
  `true` preset is useful for a short reproduction, not a permanent setting.

## 2. Configure the Store

Tracing is configured as the third constructor argument of `Store`,
`ReactStore`, or `StreamingStore`; pass `undefined` for middleware when there is
no middleware configuration.

```ts
const store = new Store(reducers, undefined, {
  traceSelectors: {
    traceExecution: true,
    traceInvalidation: true,
    traceResults: true,
    minDurationMs: 2,
    minRecomputationCount: 3,
    minCacheMissCount: 1,
    summaryEnabled: true,
  },
});
```

The public contract is flat and accepts only `undefined`, `false`, `true`, or a
single object. The object is not nested; arrays and unknown properties are
rejected. Its eleven fields are:

| Field | Default | Meaning |
| --- | ---: | --- |
| `traceExecution` | `false` | Execution counts, recomputation counts, and duration aggregates in period rows. |
| `traceCache` | `false` | Direct output-cache request, hit, miss, and ratio metrics in period rows. |
| `traceInvalidation` | `false` | Counts for each selector invalidation reason in period rows. |
| `traceArguments` | `false` | Argument-computation and changed-argument counts in period rows. |
| `traceResults` | `false` | Counts for initial, changed, and retained-reference outcomes in period rows. |
| `traceCadence` | `false` | Store selector-cadence subscription and tick messages. |
| `minDurationMs` | `0` | Inclusive threshold for period maximum duration on execution rows. |
| `minRecomputationCount` | `0` | Inclusive threshold for period recomputation count on execution rows. |
| `minCacheMissCount` | `0` | Inclusive threshold for period cache-miss count on cache rows. |
| `summaryEnabled` | `false` | Retains a lifetime, non-resetting `getSelectorTraceSummary()` snapshot. |
| `summaryIntervalMs` | `1000` | Automatic period-aggregate interval in milliseconds. |

`traceSelectors: true` enables all six event categories with zero thresholds but
does not allocate summaries. Set `summaryEnabled: true` to allocate the bounded
collector and publish period aggregates while retaining lifetime snapshots.
`undefined` and `false` disable every category and aggregate timer. Object fields are independent: enabling invalidation does not enable
execution, arguments, results, cache, or cadence. All threshold fields must be
finite and non-negative; category and `summaryEnabled` fields must be boolean.

## 2a. Store-owned logging streams

Every Store family exposes the same read-only `traceStreams` collection. The
public `StoreTraceStreams` and `StoreLoggerFactory` types are available from
`@augmentcode/themis/types` and re-exported by each Store-family entrypoint.
The collection contains six Kefir observables: `selectorDetail`,
`selectorSummary`, `selectorCadence`, `sagaMonitor`, `runtimeError`, and
`reduxAction`. It does not expose emitters or permit consumers to publish events.

When `logReduxActions: true`, Store-owned Redux middleware produces one
`reduxAction` event only after `next(action)` succeeds. The event contains the
action plus previous/next state references and a `stateChanged` flag; it does not
eagerly compute a diff. StoreRuntime's default logger renders that stream with
the existing legend, grouped titles, action record, and lazy path-keyed state
diff. A `loggerFactory` replaces the default logger while still receiving all
six streams. Action and state payloads may contain application data; redact
secrets before sharing them.

With no `loggerFactory`, StoreRuntime attaches the default console logger and
preserves the existing severity and `[themis]` prefixes. A custom factory
receives only this Store instance's streams and may return one disposer, so
custom logging does not duplicate default console output:

```ts
const loggerFactory: StoreLoggerFactory = (streams) => {
  const subscription = streams.runtimeError.observe(reportRuntimeError);
  return () => subscription.unsubscribe();
};
```

The returned disposer runs during `store.dispose()` and before a successful
re-initialization attaches the factory again. Dispose stream subscriptions and
the Store initializer when the owning code path ends.

The legacy `store.traceSelectors()` compatibility method can activate the same
event preset in any build when construction used omitted or `false` tracing
options. A configured object remains authoritative; do not use the method to
override it.

## 3. Read console aggregates as evidence

Selector metadata is collected without per-call console output. When
`summaryEnabled: true`, each non-empty interval emits one `console.info` call
with the `[themis] selector trace summary` prefix and the exact aggregate shape
`{ intervalMs, selectors }`. Each selector row follows
`SelectorTracePeriodSummary` exactly:

| Field | Meaning |
| --- | --- |
| `selectorSource` | Safe callback source snippet used as selector identity. |
| `executionCount` | Execution samples collected during this interval. |
| `recomputationCount` | Recomputation count during this interval; an interval delta, not a lifetime total. |
| `invalidationReasons` | Counts for all four invalidation reason labels. |
| `resultOutcomes` | Counts for `initial`, `changed`, and `retained-reference`. |
| `arguments` | `{ count, changedCount }` for argument-related computations. |
| `duration` | `{ count, totalMs, averageMs, maximumMs }` for this interval. |
| `cache` | `{ requestCount, hitCount, missCount, hitRatio }` for this interval; ratio is `null` with no requests. |

Rows are emitted when at least one enabled category qualifies. `minDurationMs`
and `minRecomputationCount` use inclusive comparisons against the interval's
maximum duration and recomputation count for execution eligibility.
`minCacheMissCount` uses an inclusive comparison against the interval miss count
for cache eligibility. Thresholds filter emitted rows, never collected samples
or lifetime snapshots. Invalidation, argument, and result categories are
represented by counts, not individual metadata records. The aggregate does not
contain accessed paths, changed-path metadata, argument types, output-cache
status, or cumulative cache counters.

Use duration and recomputation counts together. A slow callback with few
recomputations suggests expensive selector work; a high period count suggests
an active update path or unstable selector inputs. Cache request, hit, and miss
metrics are interval deltas and describe direct output reuse, not callback
recomputation. A selector label is bold only when its interval `cache.missCount`
is greater than zero; hit-only labels retain ordinary styling.

### Cadence records

Cadence diagnostics are separate scheduling messages, not selector payloads:

- `SUBSCRIBE SELECTOR CADENCE` reports the current subscriber count.
- `SELECTOR CADENCE TICK` reports the tick timestamp and listener count.

Use them to distinguish Store scheduling pressure from selector computation.
They do not expose state or selector values.

## 4. Aggregate summaries

Set `summaryEnabled: true`—the sole switch that allocates the summary collector—
for privacy-preserving per-selector aggregation, then
read a non-resetting snapshot with:

```ts
const summaries = store.getSelectorTraceSummary();
```

The lifetime snapshot is deep-frozen. With `summaryEnabled: false` or before any
lifetime data exists, it is an empty array. Each selector entry contains:

| Group | Fields and interpretation |
| --- | --- |
| Identity | `selectorSource` safe callback snippet. |
| Work | `executionCount`, `recomputationCount`. |
| Invalidation | Counts for all four invalidation reasons. |
| Results | Counts for `initial`, `changed`, and `retained-reference`. |
| Duration | `count`, `totalMs`, `averageMs`, `maximumMs`, `p95Ms`. |
| Cache | `requestCount`, `hitCount`, `missCount`, `hitRatio`; ratio is `null` with no requests. |

Duration totals, averages, maxima, and counts are lifetime aggregates. Period
rows reset after each emission and expose interval deltas for the same work and
cache metrics. `p95Ms`
is calculated from a bounded ring buffer retaining at most 64 duration samples;
it is a bounded-window percentile, not a percentile over every lifetime event.
Do not treat it as an exact long-term tail latency. Cache, invalidation, and
result summaries retain metadata only, never argument, result, or state values.

After `init()`, `summaryEnabled: true` starts one interval using
`summaryIntervalMs`. Each non-empty period emits exactly one aggregate; idle
periods are silent. Without `summaryEnabled`, no summary collector or interval
is allocated, even when detailed tracing categories are enabled. Repeated
`init()` calls do not create duplicate intervals. The initializer disposer and
`store.dispose()` stop the interval and clear pending period data. Cadence
subscribe and tick diagnostics remain immediate rather than aggregated.

## 5. Store-family symmetry and lifecycle

The tracing options, events, summary shape, privacy behavior, and
default-off/explicit-activation semantics are shared by all three Store
families:

| Family | Public direct selector output |
| --- | --- |
| `Store` from `@augmentcode/themis/svelte-store` | Svelte `Readable` |
| `ReactStore` from `@augmentcode/themis/react-store` | Preact `ReadonlySignal` |
| `StreamingStore` from `@augmentcode/themis/streaming-store` | Kefir `Observable` |

Tracing observes shared selector computation and output-cache behavior behind
these adapters. Do not mix family-specific lifecycle patterns in one app.

Initialize before direct reactive selector calls and retain the returned
disposer until the Store is no longer used:

```ts
const dispose = store.init();
// Reproduce the interaction through the normal selector call path.
dispose();
```

`store.dispose()` is the equivalent explicit cleanup. It evicts direct selector
outputs, stops summary intervals, disposes cadence resources, and stops running
sagas. Do not infer a tracing failure from the absence of records before
`init()` or after disposal.

## 6. Default-off production behavior and privacy

Tracing remains disabled by default in production as well as development. When
explicitly enabled, production constructor options, the legacy activation
method, reporters, and category-specific tracing work are active. When
`summaryEnabled` is true, summary collectors, summary timers, and aggregate
output are active as well. Default and `false` configurations
are silent and should not allocate diagnostic work. Keep tracing omitted or
`false` in normal builds and remove temporary diagnostic configuration after the
investigation.

The aggregate payload never reports selector argument values, selector results,
state values, or internal path metadata. It reports only callback source
identity, interval counts, duration aggregates, cache counters and ratios, and
fixed invalidation, argument, and result labels. Treat `selectorSource` as
callback identity only; it is limited to the first five source lines and 500
characters and is not a state snapshot.

## 7. Common mistakes

- **Expecting `true` to retain lifetime summaries:** `true` enables six event
  categories only; explicitly set `summaryEnabled: true` for the collector,
  period aggregates, and lifetime collection.
- **Using nested or array configuration:** the contract is one flat object;
  unknown properties, arrays, and invalid numeric values are rejected.
- **Reading trace thresholds as global filters:** `minDurationMs` and
  `minRecomputationCount` filter execution rows in the period aggregate, while
  `minCacheMissCount` filters cache rows; lifetime snapshots retain collected
  samples and other enabled categories remain independently observable.
- **Treating a cache hit as a callback hit:** output-cache hits concern direct
  adapter reuse, while recomputation counts concern selector callback work.
- **Treating p95 as exact lifetime latency:** only the latest bounded sample
  window contributes to p95; lifetime count and totals remain separate.
- **Calling readable/signal/observable selectors before init or after dispose:**
  initialize first and use `.select(...)` for explicit state reads where the
  family lifecycle requires it.
- **Adding manual memoization, debounce, or throttle layers:** Store-owned
  selector caching and cadence already exist; diagnose first with traces.
- **Logging values to enrich a trace:** this violates the privacy contract. Use
  source identity, counts, durations, cache metrics, and fixed labels only.

## 8. Concise troubleshooting workflow

1. Confirm the Store family and the exact Store instance. Add the smallest flat
   object configuration needed, call `init()`, and reproduce through the real
   selector path.
2. Filter for `[themis] selector trace summary`. Start with period duration,
   `recomputationCount`, and the category counts; do not look for path fields,
   which are not present in the aggregate payload.
3. If recomputations are unexpected, compare invalidation and argument counts.
   The fixed invalidation labels identify recomputation reasons without exposing
   state paths or argument types/values.
4. Enable results to compare `initial`, `changed`, and `retained-reference`
   counts. Do not inspect or request the underlying result.
5. Enable cache and compare interval request, hit, miss, and ratio metrics. A
   miss may be expected for a new Store/source or unstable direct-call identity;
   verify Store/source boundaries before comparing intervals.
6. Enable cadence only when scheduling is suspected. Compare immediate
   subscription and tick messages with aggregate selector records; cadence
   messages contain no selector payload. RAF tick timestamps use the normalized
   wall-clock timestamp used by the legacy console payload.
7. For a repeatable comparison, enable summaries, capture frozen snapshots
   before and after the change, compare counts, invalidation labels, cache
   ratios, and bounded p95, then dispose and turn tracing off.

## 9. Evidence-oriented handoff

Report the exact Store family, option fields enabled, initialization/disposal
sequence, reproduction boundary, and relevant field names. Include redacted
trace metadata or aggregate counts only—never selector arguments, result/state
values, or guessed values hidden behind path markers. Record validation such as
`git diff --check` for documentation changes and focused tests or build checks
when the task also changed runtime code.

## See also

- `@augmentcode/themis/docs/SELECTORS.md` — complete selector and tracing
  reference.
- `../debugging/SKILL.md` — Store lifecycle and runtime inspection boundaries.
- `../testing/SKILL.md` — focused selector and Store verification guidance.
- The selected Store-family selector skill — family-specific call modes; keep
  one concrete Store family per app/code path.