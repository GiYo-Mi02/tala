# Phase 2.3 acceptance report

The production web bundle ran in Chromium over HTTPS against the existing Express API, an isolated PostgreSQL 18.6 database, and private file storage. The browser run used 12 fictional acknowledged records, including both BEEF and SSS E-1, submitted through the real native intake routes using the scanner's payload mapper. The Kotlin mobile protocol regression ran separately in the same disposable cluster.

- **PASS** 16 backend, Kotlin host, browser, and contract test results. See [P23-01](../../apps/backend/tests/web.test.ts) and the local log `.cache/phase-2.3-final.log`.
- **PASS** 145 scanner and core tests. TypeScript checks passed for the web, backend, core, and scanner.
- **PASS** The Vite production build emitted the portal, manifest, service worker, and three manifest icons. The packaged PNG dimensions match their declarations.
- Reviewed the local [dashboard](../../.cache/tala-backend-tests/run-Fc0XCs/web-qa/dashboard.png), [desktop review](../../.cache/tala-backend-tests/run-Fc0XCs/web-qa/review.png), and [mobile review](../../.cache/tala-backend-tests/run-Fc0XCs/web-qa/review-mobile.png) captures from the isolated run.

## Authentication

1. **PASS — Authorized login.** A verifier signs in with a real browser-mode backend session and reaches the protected list.
2. **PASS — Unauthorized resources.** An encoder is sent to the restricted screen. The backend rejects that account on verifier overview and unrelated scans.
3. **PASS — Safe expiry.** The browser refreshes after an access-token expiry and shows the session-expired screen after refresh expiry.
4. **PASS — Logout.** The UI signs out, returns to login, and clears the refresh cookie.
5. **PASS — Backend authorization.** The same test confirms HTTP 401 without a token, 403 on the verifier summary with an encoder token, and 404 for another account's scan.

## Dashboard

1. **PASS — Real counts.** Chromium displayed 12 total, 11 pending, and one in review after real submissions and a backend claim.
2. **PASS — Recent records.** The refreshed dashboard displayed acknowledged template names, references, submitters, dates, statuses, and links.
3. **PASS — Correct status totals.** The figures reflect the isolated PostgreSQL records and its actual verification transition.
4. **PASS — Empty state.** The initially empty database shows zero counts and an empty recent list.
5. **PASS — Failed API requests.** An injected HTTP 503 showed an actionable dashboard error. Retrying read the real database again.

## Submissions

1. **PASS — Synchronized records appear.** BEEF and SSS E-1 records posted through the native intake routes appear after receipt.
2. **PASS — Correct identifiers.** Search accepts the server reference prefix and opens the matching full identifier.
3. **PASS — Pagination.** The browser moved through rows 1–10 and 11–12 using server offsets.
4. **PASS — Search.** Reference lookup succeeded and a learner surname returned no results. Template names and IDs are supported.
5. **PASS — Filters and ordering.** The browser used status, template, and received-date filters and verified oldest-first ordering. The backend rejected a reversed date range.
6. **PASS — Open details.** Both BEEF and SSS E-1 were opened successfully. Direct navigation and the no-selected-record view were also exercised.

## Document viewer

1. **PASS — Original scans.** The browser loaded the stored JPEG/PNG response path with an authenticated PNG fixture. An independent read matched the uploaded bytes.
2. **PASS — Page order.** BEEF showed pages 1 and 2 in order. The SSS fixture showed its single captured page.
3. **PASS — Zoom and fit.** The browser zoomed to 125% and fit the viewer again at 100%.
4. **PASS — Display-only rotation.** A 90-degree display rotation left the stored bytes intact.
5. **PASS — Access is enforced.** Requests with no credential or an unrelated encoder credential were rejected.
6. **PASS — Missing files.** Removing an isolated fixture image showed a scan-unavailable message. Restoring it allowed a retry.

## Extracted information

1. **PASS — Original OCR.** The screen displayed raw `OO123456789O` under the LRN field.
2. **PASS — Confirmed mobile value.** The same field displayed `001234567890` independently.
3. **PASS — Template mapping.** Actual BEEF and SSS E-1 field IDs resolved to their labels and sections.
4. **PASS — Empty values.** The fixture's empty middle name was represented explicitly.
5. **PASS — Leading zeros.** The browser preserved the complete learner reference string.
6. **PASS — Unknown types.** An isolated `future_enum` field definition displayed safely as submitted text. Supported confidence and OCR warning metadata were also visible.

## PWA and layout

1. **PASS — Build.** The production Vite build completed.
2. **PASS — Manifest.** Chromium retrieved the standalone manifest and the bundled icon files match their dimensions.
3. **PASS — Worker behavior.** Chromium installed the worker, activated a test update, reloaded, and opened the offline shell.
4. **PASS — Private content stays out of the cache.** Browser cache inspection found only the public shell assets. Offline reload showed the connection notice and cleared private values from the page.
5. **PASS — Layout.** Chromium passed viewport checks at 1440, 1280, 768, and 390 pixels wide. Mobile panels stacked within the viewport, and Escape closed the navigation drawer.

## Regression

1. **PASS — Backend operation.** The Phase 2.1 integration and OpenAPI tests passed against fresh PostgreSQL.
2. **PARTIAL — Android operation.** The existing Kotlin protocol scenario passed against the updated API, and scanner/core tests passed. An installed Android device was outside this run.
3. **PASS — Read-only browsing.** Submission IDs, states, revisions, and update times matched the database snapshot taken before browser review.
4. **PASS — Duplicate prevention.** The backend and Kotlin host suites verified idempotent create and retry. Browser review preserved the original row set.

Physical Android, Safari, and Firefox checks remain pending. The browser run used a test HTTPS certificate and the workspace's Chromium executable. The portal depends on a trusted HTTPS certificate in deployment. The development build tool's resolved glob dependency remains flagged by npm, and the registry reported no newer patch at verification time. It is used by Vite during development and the build. The built portal is served by Express or a production HTTPS proxy. [Dependency advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
