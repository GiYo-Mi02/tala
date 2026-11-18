# Phase 2.4 verification workflow handoff

The current portal displays records and evidence in read-only mode. Its query keys distinguish submission status, templates and the server UUID, and its viewer accesses one private page at a time. Keep original OCR, confirmed mobile values, reviewer corrections and final values independently visible when introducing edit controls.

1. Use the existing verifier session and extend the typed detail read to return the quoted `ETag` response header next to its JSON data. Claim the record through `POST /submissions/{id}/review/claim`. Expose edits only when the server reports an in-review record assigned to the signed-in verifier.
2. Extend the field display with inputs driven by type, rules and stable field ID. Retain strings for identifiers, original OCR, confirmed snapshots and blanks. Submit only explicit corrections through `review/correct`. Display backend field validation errors and preserve the reviewer's unsaved input on recoverable errors.
3. Send the latest `If-Match` and a new idempotency key per logical decision. For a lost response, retry with the same payload and key. On 412, reread server state and ask the reviewer to reconcile differences. Refresh detail, status, queue, and summary queries after successful decisions.
4. Follow the existing transitions for verify, return, reject, and finalize. Return and reject require notes. Finalization follows verification and freezes final values. Present the state, note, and time from the API and prevent editing terminal records.
5. Use the submission detail's verifier history for actions, reviewer IDs, revisions and notes. If the website needs the exact per-field corrections associated with each historical action, inspect the existing `verification_changes` records and add an authorized read calculation or projected response. Keep audit data and scans in the private, online-only path.

See the [review endpoints and errors](../phase-2.1/openapi.json) and [database dictionary](../phase-2.1/data-dictionary.md) before changing workflow behavior.
