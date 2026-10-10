# Recorded native marker source operation

These two files preserve original Store JSON bytes:

- `marker-source.capture.txt`: six source/context responses, SHA-256 `76a5751059c0e4c7795b5f0ab2405e51a2d122891accd0fe6d6f0f6661a016e6`.
- `marker-output.capture.txt`: seventeen staged operation responses, SHA-256 `b2ad1ec675f6169ed02582c9206cca29406463bb4abde73e16bb5efe80dd4503`.

The producer is intentd commit `b8639c40c5e84e84c0be0653b528185449e96bd3`, with runtime at `f7f46558df371fc3731fefdd5f4f4880baaba7b8`. The original Store writer and comment insertion created the source and non-orphan root. The configured frontend editor consumed the full source/context capture and produced twelve owned text resources plus two live descriptors. Those exact uploads were replayed against the retained Store database before the original snapshot expired. The Store verified the original occurrence and root, then emitted the recorded source output and cancellation response.

`note-marker-store-replay.test.ts` reconstructs that configured native capture and compares every outgoing request with the original seventeen requests. It uses the recorded clock; identities, cursors, response objects and deadlines remain unchanged. The begin deadline's millisecond precision is no later than the original snapshot deadline. The test separately checks cancellation during held reads and callbacks, resource retention until settlement, and the original typed Store expiry refusal. Internal Store witness fields are an independent producer oracle, not wire fields or frontend authority. Typed Store refusals are not JSON-RPC error envelopes.

The source capture includes a complete paragraph boundary and its text/marker spans. The consumer retains those entries and verifies a bounded own-data witness without invoking context getters or serializers. This closes callback mutation of context after native mapping validation.

This evidence covers a clean original marker occurrence and source output through recorded transport. It does not establish live authentication, native clipboard behavior, dirty marker restoration, marker-specific selection/rendered output, or normal-route/capability activation.
