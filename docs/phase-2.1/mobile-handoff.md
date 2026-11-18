# Phase 2.2 Android synchronization handoff

This is the contract for the future Android client. The existing application has no network sync adapter. The versioned server endpoints and example response fields are defined in [OpenAPI](openapi.json).

## Authentication and ownership

Use the device-trusted HTTPS endpoint under `/api/v1`. Send `POST /auth/login` with an authorized encoder’s `email`, `password`, and `mode: "native"`. Keep the short-lived access token in memory and the refresh token in Android Keystore-backed secure storage. Send `Authorization: Bearer <accessToken>` to protected endpoints. Check the account with `GET /auth/me`.

On a protected request’s 401, let one refresh request run for the account. Send `{ "refreshToken": "…" }` to `POST /auth/refresh`. Atomically replace the stored refresh token with the returned token and retry the original request. If refresh fails or its response is lost and the old credential is rejected, sign in again as the same encoder. The session’s refresh window is seven days from sign-in. Logout calls `POST /auth/logout` with the refresh token and clears credentials on-device. Scope saved sync work to the server account ID. The existing fictional local profile is useful for local draft compatibility.

## Prepare a durable upload snapshot

- Start after the encoder explicitly confirms every applicable field and requests submission. Keep the app's capture, OCR, review, and local save workflow available offline.
- Freeze the local draft ID as `clientSubmissionId`, the pinned template ID and version, accepted image IDs and bytes, capture time, confirmed values, and selected OCR evidence. Use the primary accepted capture time for `capturedAt` and preserve it throughout retries. Persist an operation UUID for each create, page upload, field snapshot, and completion. Store the server UUID and receipt additively alongside the existing SQLite draft.
- Create the record with `POST /submissions` and a UUIDv4 `Idempotency-Key`. Example below. The same account and client UUID recover the same server UUID. Keep request identity and body stable across reconnects.

```json
{
  "clientSubmissionId": "3e591d50-de59-4f44-be1b-6a8ed4f13529",
  "templateId": "beef-sy-2024-2025",
  "templateVersion": 1,
  "capturedAt": "2026-11-18T00:00:00Z"
}
```

## Upload the accepted pages and field snapshot

1. Read `GET /submissions/{id}/status` to discover committed page slots. Use `PUT /submissions/{id}/pages/{pageNumber}` for each missing page with its own `Idempotency-Key`, `X-Image-Id`, `X-Content-SHA256`, and JPEG or PNG `Content-Type`. The body contains the binary image. Use upright private, accepted capture files. Calculate SHA-256 over the exact bytes being uploaded. Preserve the accepted image UUID even if an app-private file path changes. Page filenames and device URIs stay on the phone. A committed slot matches only its existing digest and image UUID.
2. Upload BEEF pages 1 and 2. SSS E-1 `sss-e1-cov01214-09-2015` requires page 1 and adds page 3 when `sss_additional_sheet_used` equals `Yes`. Its page 2 is a reference sheet. Use `GET /templates/{id}/versions/{version}` to inspect capture flags, conditional rules, and field identifiers.
3. Send one `PUT /submissions/{id}/fields` with the full active confirmed snapshot. Use the seven BEEF keys `school_year`, `grade_level`, `lrn`, `learner_last_name`, `learner_first_name`, `learner_middle_name`, and `birth_date`. Send optional blanks as empty strings. SSS E-1 uses the IDs returned by `activeFixedFields(draft)` and the draft's exact confirmed values. Represent LRN, SS numbers, and other identifiers as strings so leading zeros survive. Send actual calendar dates as `YYYY-MM-DD`. Use the legacy readiness checks to confirm the data before upload.
4. On BEEF, use the latest matching `ocrHistory` run for page 1. Map its `RawField.text` to `ocr.original`, `run.id` to `runId`, `run.engine` to `engine`, and exact `regions` to `regions` when available. On SSS E-1, use the latest matching per-page `history` run. Supply the raw `FixedReading.text` from the selected recognition result, its supported confidence, and its `region`. The mobile-confirmed value comes independently from `draft.values`. Missing readings and manual-only fields use `ocr: null`. Keep raw blank strings and optional confidence as recorded, and keep alternate preprocessing results in local diagnostic history. The API accepts only one canonical OCR reading per field and anchors it to the accepted image. All coordinates are fractional relative to that upright image.

This excerpt shows one item inside the complete `fields` array.

```json
{
  "key": "lrn",
  "mobileValue": "001234567890",
  "confirmed": true,
  "ocr": {
    "original": "OO123456789O",
    "imageId": "cf276c41-c9f3-47b9-9a29-c79a0dd7269d",
    "engine": "mlkit-bundled-latin-16.0.1",
    "regions": [{ "x": 0.57, "y": 0.18, "width": 0.28, "height": 0.025 }]
  }
}
```

## Recover, acknowledge, and display review status

- After every applicable upload and the field snapshot commit, call `POST /submissions/{id}/complete` with its persisted request key. Call `GET /submissions/{id}/status` to confirm `receipt.submissionId` and `receipt.acknowledgedAt`. Write that receipt durably before marking the local queue item synchronized. The current server status might already have advanced if a verifier picked it up. A successful completion retry returns the original acknowledgment revision and state.
- On a dropped connection, 429, or transient 503, use bounded exponential backoff with jitter, honor `Retry-After`, and replay the same logical request. Recover stage progress from status after the app or network restarts. Page data is retried as a whole image. A server can commit immediately before the phone loses the response. Keep original bytes, locally confirmed values, and idempotency keys until a matching receipt is stored.
- On 400, 413, 415, or 422, show the validation error and any `error.fields` keys. Route a corrected intake through the existing review workflow. Conflicts such as `IDEMPOTENCY_CONFLICT`, `PAGE_CONFLICT`, or `FIELD_SNAPSHOT_CONFLICT` need user review with progress fetched first. Use a fresh operation UUID for a changed request. An intake whose immutable page or field snapshot has already committed needs a reviewed replacement draft with a new client UUID. Retain the original local draft and status history.
- Local queue states such as ready, uploading, retryable error, and synchronized describe device work. Server review states are independent. `DRAFT` and `UPLOADING` have no receipt. `PENDING_VERIFICATION` enters the queue, `IN_REVIEW` is assigned, `VERIFIED` awaits finalization, and `FINALIZED` freezes results. `NEEDS_CORRECTION`, `REJECTED`, and `EXPIRED` are terminal for that submission. A returned record includes the verifier reason. Keep the prior record and capture any corrected replacement under a fresh client UUID.
- The verifier flow uses the separate verifier role, the returned ETag in `If-Match`, and its own per-action idempotency keys. A 412 means the verifier must fetch the current record before deciding whether to apply the change. The server applies the latest verified correction or the confirmed mobile value at finalization.

Phase 2.2 device checks should use fictional BEEF and SSS E-1 records on the Samsung Galaxy A53 5G. Cover offline capture, deletion prevention while waiting for a receipt, process restart after page 1, duplicate prevention after a dropped completion response, refresh rotation, account switching, and display of a real backend verification decision. Device testing and the verification website are separate from the Phase 2.1 API evidence.
