# Local point source fixture

`plain-paragraph-ab.json` is the unchanged six-response Store lexical capture from
intentd `2c006368069967ed5714abb6216e7fb73d1cd6e0`. SHA-256:
`843c4a655667c7817813da6c38a32dac8a424d34d29421ccdc48be9c7247dcf7`.
The capture records its original identities, clock, deadline and explicit
4096 source-byte / 8192 wire-byte / 64 item requests. Tests use the recorded clock;
no identity, response or expiry is refreshed.

The configured frontend command inserts X and a real point atom into `ab`. The
production relay and local session owner publish one generated local group with
source length 59, preserve the atom for local redo, and refuse saving or receipt
adoption. The source inverse is local `[1,58)` deletion, not the canonical
Services inverse `[1,2)` deletion. The independently tested Services operation is
not this frontend operation or an uploaded transcript.

These tests run a configured editor, real prepared-context/read saga/Redux ledger,
and a controlled owner harness. They do not enable a mounted application route,
server comment ownership, canonical reconciliation, old-receipt restoration,
OS integration, or restart reconstruction of the retained native proof.
