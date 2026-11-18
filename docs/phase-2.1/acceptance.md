# Phase 2.1 acceptance report

The suite ran on November 18, 2026 with Node 24.12.0 and PostgreSQL 18.6 in a newly initialized local cluster. It exercised Express over HTTP and used temporary private disk storage. All records, names, images, and credentials used by the tests were synthetic. TypeScript checks passed for the backend and for the existing core and scanner workspaces. The existing Vitest suite passed all 143 tests.

**Result.** 14 Node test results passed, comprising 9 integration subtests, their parent suite, 3 unit tests, and 1 OpenAPI validation test. The suite exited successfully and the disposable PostgreSQL cluster stopped.

- Test command `npm.cmd run test:postgres -w @tala/backend`
- [Integration assertions](../../apps/backend/tests/integration.test.ts) and [unit assertions](../../apps/backend/tests/unit.test.ts)
- [OpenAPI validation and drift test](../../apps/backend/tests/openapi.test.ts)
- Local run log `.cache/phase-2.1-postgres.log`

## Acceptance criteria

1. **PASS — PostgreSQL schema and migrations work.** P21-01 applied the migration in an empty database, reapplied it with zero changes, and repeated template seeding.
2. **PASS — Essential relations are implemented.** The migration defines 12 application tables. P21-01 seeds related rows, P21-05 checks composite references, and P21-06 reads verification and audit history.
3. **PASS — The backend starts in a clean environment.** P21-01 starts the standalone server using a fresh database and explicit test configuration, then receives HTTP 200 from health.
4. **PASS — Authentication and authorization work.** P21-02 checks native login, bearer authentication, credential rotation, refresh reuse rejection, and role restrictions. P21-09 checks browser Origin and secure cookie behavior, deactivation, and logout.
5. **PASS — Templates and fields can be retrieved.** P21-01 seeds 143 field definitions. P21-03 queries both template versions, reads the 136-field SSS mapping, and rejects an unknown version.
6. **PASS — The API receives mobile-compatible submissions.** P21-03 accepts a client UUID, pinned template version, and capture timestamp. P21-05 and P21-08 accept confirmed field snapshots using the mobile model’s keys.
7. **PASS — A submission can store at least two pages.** P21-04 and P21-05 commit and retrieve BEEF pages 1 and 2 with intact checksums and order. P21-08 verifies SSS E-1 pages 1 and 3 when the additional sheet is used.
8. **PASS — Original OCR values are preserved.** P21-06 distinguishes raw `OO123456789O`, mobile `001234567890`, verifier `001234567891`, and final `001234567891`. P21-05 confirms that direct changes to raw evidence fail.
9. **PASS — Retries avoid duplicates.** P21-03 sends three concurrent creates with repeated and distinct keys and finds one database row. P21-04 aborts a page request mid-body, retries successfully, and tests identical and conflicting replays. P21-06 replays completion after finalization and reads the record through a second API instance.
10. **PASS — Uploaded files stay private.** P21-04 rejects unauthenticated requests, another encoder, and verifier access to an incomplete submission. P21-05 retrieves exact image bytes after intake and verifies that the status omits the private storage key.
11. **PASS — Submission statuses follow valid transitions.** P21-04 and P21-05 reject premature completion and check the receipt. P21-06 and P21-07 cover claim, correction, verification, finalization, return, and rejection. P21-09 covers expiry.
12. **PASS — Verification permissions are enforced.** P21-06 rejects encoder review, mutation by an unassigned verifier, stale revisions, and invalid LRN corrections.
13. **PASS — Database relationships maintain integrity.** P21-05 rejects a page slot outside the template, tests evidence immutability, and confirms that a failed OCR snapshot leaves zero field rows. P21-04 confirms that a simulated storage failure leaves neither a page row nor an idempotency success.
14. **PASS — API documentation is complete.** The OpenAPI 3.1 document covers all 24 implemented HTTP operations, credentials, parameters, payloads, responses, and error codes. The OpenAPI test checks syntax and drift from its generator.
15. **PASS — Relevant backend integration tests pass.** P21-01 through P21-09 completed without failures or skips. The tests use a real PostgreSQL process and an isolated local store.
16. **PASS — Phase 2.2 handoff is provided.** The guide specifies native credentials, offline queue state, field and image mapping, retries, durable receipt handling, and physical-device acceptance cases. See [the mobile integration guide](mobile-handoff.md).

## Verification boundaries

- **NOT TESTED — Android-to-API synchronization on the Samsung Galaxy A53 5G.** The integration suite sent mobile-shaped requests from a test client. Device integration is Phase 2.2.
- **NOT TESTED — Production TLS deployment and browser UI.** Tests covered HTTPS configuration guards and cookie and Origin behavior through the loopback proxy contract. Production certificate issuance, network access and the verification website are separate deployment or implementation work.
- **Dependency audit.** The backend validates transport requests with patched Zod 4.6.7. npm still flags Zod 4.1.12 through the existing shared core dependency. The BEEF validator receives a field map produced by the bounded backend parser, and the SSS validator uses existing fixed-form rules. A shared dependency upgrade would require a separate mobile regression check. See the [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
