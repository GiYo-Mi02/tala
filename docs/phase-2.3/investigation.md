# Phase 2.3 inspection

The repository contains the Expo Android scanner, shared BEEF and SSS E-1 definitions, and the Express/PostgreSQL API. There is no existing web application. I found the Phase 2.1 and Phase 2.2 reports and OpenAPI contract in the checkout. No separate project charter, requirements specification, or user stories were available in the workspace.

Phase 2.2 sends the existing draft UUID, pinned template/version, upright page bytes with a SHA-256 digest, and confirmed values with image-linked OCR evidence. The backend commits a receipt and makes a completed record visible to verifiers. The last Phase 2.2 host run passed 15 test results against an isolated PostgreSQL cluster. It used the Kotlin mobile protocol and verified the stored page bytes and distinct original and corrected values. Physical-device synchronization remained pending.

The browser login route issues an opaque access token and an HttpOnly, Secure, SameSite Strict refresh cookie. Login, refresh, and logout in browser mode require HTTPS and an allowlisted Origin. The website can share the backend's HTTPS origin, keep the access token in memory, and send a bearer token for protected requests. Verifiers can read completed submissions. Encoders can read their own submissions, and administrators manage accounts.

The existing API already provides template versions, submission details, receipt and verification status, and authenticated binary images. The template fields expose stable IDs, labels, types, order, and rules. SSS E-1 includes its own sections. BEEF version 1 maps seven fields. The list currently supports status filtering and offset pagination. It lacks aggregate counts, document-type and date filtering, identifier search, sorting, and submitting-user and page-count data. Phase 2.3 adds those read capabilities while retaining the existing intake contract. No database migration or Android build is required.

The website will serve a public app shell and fetch private records online. The shell can use the existing Express server or a same-origin HTTPS reverse proxy. Editing and reviewer decisions remain outside the website scope for Phase 2.3.
