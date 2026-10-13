# Original marker-selection capture

The paired `marker-selection-source.capture.txt` and
`marker-selection-output.capture.txt` retain original JSON bytes from intentd
`063678c89dce99708c6d7402ae9bd8b91663972d`, over the marker-selection runtime at
`df59939b44d378f5dd35eccda6c05810a08811a4`.

The Store created the note and healthy point-comment root through its normal
writers. Six source/context responses and the retained database supplied the
actual configured native frontend capture. The source contains an emoji prefix,
1,024 `A` characters, a space, one original point-marker literal, a second space,
and 1,024 `B` characters. Its extent is 2,116 UTF-16 units; the complete paragraph
is 10–2,116 and the marker literal is 1,035–1,091.

The native producer used frontend `fdc6100465153b6c8dcd9499ac10cb87b3c7ed46`.
It captured an actual backward TextSelection with the mounted view's `after`
affinities at both ends. A separately constructed configured editor and its
selection serializer independently establish the 2,050-byte copied result,
including both spaces around the omitted marker. This is not the marker's raw
source or its node-view filler.

Sixteen owned text resources, four live records and one selection record are
preserved in the upload. The Store replayed the actual begin, uploads and seal
against the retained original database. It returned three output pages of 1,024,
1,024 and 2 bytes, plus a real EOF cancellation acknowledgement: 24 responses in
all. Continuations contain the actual Store-issued cursors. The separate
wrong-selector and post-cancel failures are typed Store errors, not serialized
JSON-RPC error envelopes.

The final frontend test feeds the original source/context through the real
reader and configured mounted view, then checks every staged request and response
through the Redux owner and Live adapter under the recorded source clock. Its
sink and transport remain controlled. Scope, snapshot, digests, cursors and the
original expiry are unchanged. Internal Store ownership/witness fields in the
capture are test oracles, not new wire fields or renderer authority.

The producer's original 30-second run timed out. An instrumented run with a
120-second test budget passed in 97.017 seconds; both runs are retained. This
establishes recorded-flow behavior only, not the original time-budget or product
responsiveness claim. No production timeout was raised.

This fixture covers one clean complete paragraph and its inherited point marker.
It does not prove live authorization, OS clipboard writes, dirty/restored marker
provenance, rich paragraphs, rendered search across markers or feature activation.
Normal routes and capabilities remain disabled.

Raw SHA-256:

- Source: `906da13a8d96c8db7ce0a83f0094ec8d1d0015317883edb4c094cffffd1a4b1a`
- Output: `ffff213a4213bb769d66117f7f5d6bfaab38487896e7b79f308081b2bf2ebc46`

Workspace evidence is retained under
`.intent/artifacts/note-reading/marker-output-20261005/attempt-1/` and
`.intent/artifacts/bounded-note-reads/delivery-20261005/marker-selection-native-published-evidence.json`.
