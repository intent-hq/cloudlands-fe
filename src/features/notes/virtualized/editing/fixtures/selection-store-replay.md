# Recorded native selection and Store output

`selection-source.capture.txt` and `selection-output.capture.txt` are unchanged
original Store captures. The source is `prefix😀\n\n` followed by 2,050 ASCII
`a` characters. The paragraph starts at UTF-16 offset 10; the full source extent
is 2,060. Selection output starts at offset zero and spans 2,050 characters.

The frontend generated the upload by feeding the six original source/context
responses through `NotePageReader`, the prepared-context saga and Redux reducer,
the configured `NoteWindowView`, and its native selection capture. A separate
configured editor's Markdown serializer produced the expected output. The exact
begin, eight append and seal requests were then executed against the retained
Store database. Store returned three original selection pages (1,024, 1,024 and
two bytes) and the original cancellation acknowledgement. The test recreates and
compares all 14 staged-operation requests, including the actual Store cursors.

The source capture records normalized Store page selectors. The test separately
checks the frontend's first-read revision/incarnation/snapshot fences against the
unchanged captured response. It uses the original `capturedAtMs` test clock;
identities, expiry, source data, response objects and cursors are not rewritten.
These expired captures are replay evidence, not permission for a new live read.

The recorded wrong-selector and post-cancel errors are typed **Store** outcomes,
not serialized JSON-RPC errors. The refusal test forwards the recorded post-cancel
object at the identical read selector. It proves fail-closed frontend cleanup,
not service error-code serialization or live authorization.

Producer attribution:

- Backend commit: `6df193b932115638c8f28b50cf30ed214d4fb6ab`.
- Producer: `crates/intent-store/src/tests/note_pages/selection_upload_capture.rs`,
  `replay_actual_frontend_selection_upload_and_capture_output`.
- Backend evidence: `.intent/artifacts/bounded-note-reads/delivery-20261005/selection-complete-published-evidence.json`.
- Frontend native-upload evidence: `.intent/artifacts/note-reading/selection-store-replay-20261005/successor-2/native-producer-result.json`.
- Source capture SHA-256: `f2f064134081cb3b4113472c3e18a513b861dfe53e5a139726acff6d9dc55587`.
- Output capture SHA-256: `ededde5f429f9abef996c515475b0ae51616e11b2edcbe220372c3359edc6705`.

The predecessor 13-response capture lacks cancellation and remains separate in
the workspace evidence. No result from it is substituted into this fixture.
The tests inject the sink and backend transport; they do not launch Electron,
write the OS clipboard, prove live Services authorization, or enable normal routes.
