# Captured Store rendered-search replay

These fixtures retain original Store response bytes, including opaque identities,
references, cursors and deadlines. The test uses the recorded clock; it does not
rewrite expired identities or represent recorded transport as live authentication.

The Store producer is intentd commit
`c9ccd2119e23e283efeb62843a40b0c8d1b443ff`, over runtime
`80060e1e48e3a01ba99e7cc7eb7535c3d4164891`:

- `crates/intent-store/src/tests/note_pages/rendered_source_capture.rs`
- `crates/intent-store/src/tests/note_pages/rendered_upload_capture.rs`

The source fixture supplies six original source/context responses and a retained
database. The frontend at `52ebf37ae20bd78a1db2116b82ec1a77fe1684e4`
used these responses through the reader, prepared paragraph context, Redux,
configured native view and Live operation adapter to capture its actual uploads.
The Store then executed those unchanged uploads against the retained database.
The output fixture contains 286 original calls, including two search pages,
every reached hit-detail resource, and the final cancellation acknowledgement.

| Raw file                      | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `rendered-source.capture.txt` | `eb3a3b4b6604872acc4956b47bfad5b3e3f582aefca65c5febb4692fd80fa37d` |
| `rendered-output.capture.txt` | `04367dd4b6fa33933bf8bdf592730b9453fbf8d217c2822bb38129c6fcddc2c5` |

The source is `prefix😀\n\n` followed by eighteen repetitions of `Straße `
and a trailing emoji. The actual backward selection spans source UTF-16 offsets
10 through 129. The literal, case-insensitive rendered query `STRASSE` returns
17 distinct original spans, on pages of 16 and 1. Every resolved whole-leaf
detail preserves the excluded eighteenth match and emoji. Expected spans are
calculated independently of the Store responses; native positions and upload
descriptors come from the configured capture, not that arithmetic oracle.

The native upload probe used controlled stage acknowledgements and an empty
controlled search response solely to record requests. Those responses are not
Store matcher evidence. The committed replay instead checks exact request order
and parameters against the actual Store output and validates it through the real
frontend consumer. Negative controls retain context and DATA through held reads
and callbacks, and inject the recorded typed Store expiry refusal without
inventing a JSON-RPC error envelope. The wrong-selector refusal is retained as
Store evidence; it is not claimed as a separate frontend refusal test.

Producer logs, original requests and source hashes are retained under
`.intent/artifacts/note-reading/rendered-store-replay-20261005/attempt-1/`.
Backend attribution is in
`.intent/artifacts/bounded-note-reads/delivery-20261005/rendered-native-published-evidence.json`.
The earlier backend helper assertion that incorrectly expected a seal `viewId`
is retained as a failed predecessor; the corrected helper checks the actual
persisted view. No production code changed for that fixture correction.

This proves the admitted single-paragraph producer/consumer subset with recorded
transport. It does not establish live authorization, OS integration, richer
rendered contexts, or normal-route/capability activation.
