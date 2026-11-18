# Phase 2.2 test and acceptance report

The November 18, 2026 run used a real temporary PostgreSQL 18.6 cluster, the existing Express API, and private disk file storage. The Kotlin protocol and OkHttp client ran on the host JVM against an isolated loopback API. Android Kotlin source compiled against Android SDK 36, Expo Modules Core, React Native, WorkManager 2.10.5, and Room 2.7.2. The actual Room annotation processor validated the DAO and generated its database code. Expo autolinking resolved the new module and the existing OCR module. No Android package or backend distribution was rebuilt. ADB listed no connected device.

- **PASS** 145 TypeScript unit tests across scanner and core, including two new snapshot mapping cases.
- **PASS** 15 Node test results on PostgreSQL, including Phase 2.1 regressions and the Kotlin-to-API Sync P22-01 scenario.
- **PASS** TypeScript checks for scanner, shared core and backend, plus the isolated Room annotation processing and Kotlin Android source compile.
- **Evidence** [Kotlin host assertions](../../apps/scanner/tests/SyncHost.kt), [PostgreSQL and storage assertions](../../apps/backend/tests/mobile-sync.test.ts), [mapping tests](../../apps/scanner/src/syncSnapshot.test.ts), and the local run log `.cache/phase-2.2-host.log`.

Reproduce the host API test from the workspace root using the installed Windows toolchain and cached dependencies. The script compiles Kotlin protocol classes for the JVM and starts the existing disposable PostgreSQL test runner.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-sync-host.ps1
npm.cmd test -- --reporter=default
npm.cmd run typecheck
npm.cmd run typecheck -w @tala/backend
```

## Acceptance criteria

1. **PARTIAL — Offline scanning.** The existing capture path and its unit tests passed. Live camera capture with networking disabled awaits a device run.
2. **PARTIAL — Offline OCR.** The bundled OCR pipeline and extraction tests remain in place and passed. A new airplane-mode OCR run awaits a device.
3. **PARTIAL — Local scan persistence.** Existing draft storage tests passed. Native Keystore page staging and recovery need an installed device test.
4. **PASS — Local corrections persist.** The existing draft save tests passed, and new mapping tests verified that saved confirmed values survive independently of mismatched raw readings.
5. **PASS — Multiple pages.** The two-page BEEF protocol run stored both pages in order. The SSS mapper also verified conditional slots 1 and 3 and exclusion of the reference sheet.
6. **NOT TESTED — Offline entries reach the Android outbox.** SQLite and the native bridge compiled. The device acceptance case needs a signed-in encoder with the network disconnected.
7. **NOT TESTED — Android starts queued work when connectivity returns.** WorkManager constrained scheduling was compiled. The host replay test does not run Android network constraints.
8. **PASS — Page upload.** The Kotlin transport uploaded both original fictional PNG byte streams. Server-side byte equality and SHA-256 checks passed.
9. **PASS — Field association.** Retrieval confirms the LRN raw result, corrected value, crop region, page image UUID, and owning record.
10. **PASS — PostgreSQL structured data.** Tests verified the submission row, template, page order, receipt and field values through the real database and API.
11. **PASS — Private document storage.** All expected page bytes were found through the private storage adapter. The backend regression suite also rejects unauthenticated and unrelated access.
12. **PASS — Duplicate prevention.** A successful create response was dropped and replayed with the original key. One server row was retained for that client UUID.
13. **PASS — Interrupted protocol recovery.** Successful page 1 and completion responses were dropped. The restarted protocol read server progress and confirmed the original receipt without resending page 1 or completing twice. Android network-loss behavior remains a separate device test.
14. **PASS — Authentication failures.** The API expired the active token and the same client refreshed it. Revoking the refresh credential caused an authentication block and retained progress. A different encoder could not use the queued account binding.
15. **PASS — Validation failures.** An invalid birthdate returned `INVALID_FIELDS` with its field key and no receipt. The protocol classified the error as permanent.
16. **PARTIAL — Acknowledgment updates Android status.** The Kotlin protocol persisted `SYNCED` only after matching the server receipt. The test persisted progress to a host fixture file. Android SQLite and screen behavior need device acceptance.
17. **NOT TESTED — User-facing status on a handset.** The controls and labels typechecked. Their states need a mounted Android run.
18. **PARTIAL — Process termination and restart.** The host test recreated client sessions and reloaded the serialized checkpoint between retries. Killing and reopening the installed app is pending.
19. **NOT TESTED — Pending work survives a phone reboot.** The boot manifest and recovery code compiled. No physical reboot was performed.
20. **PARTIAL — Existing mobile functions.** All 145 scanner and core tests passed, and autolinking still found `tala-ocr`. Native capture, review and sync need a smoke test together.
21. **PASS — Retrieve the completed submission.** A real verifier read the submitted record and returned it for correction. The encoder then read the newer decision while retaining the original receipt and local `SYNCED` state.

## Required scenario coverage

- **PARTIAL** Online scan and sync, offline scan and reconnect, and two-page BEEF capture. The host sent a reviewed two-page fixture using the same mapper and client. Device camera, airplane mode, and scheduling remain unverified.
- **PARTIAL** Disconnect during upload and terminate the app. The host dropped the response after the server had stored page 1. The backend regression also disconnected mid-body and recovered. The host restored a saved checkpoint before replay. Android process termination remains unverified.
- **NOT TESTED** A phone reboot with pending work. Start with a queued fictional draft and confirm recovery after unlock and reconnection.
- **PASS** Repeated logical submission, expired credentials, invalid confirmed data, and a simulated HTTP 503. The test verified recovery from the same keys and checked the server-provided 90-second retry delay in the retry deadline calculation.
- **PASS** Retrieve an acknowledged submission and verify retained raw and corrected OCR. The API returned raw `OO123456789O` and mobile-confirmed `001234567890` in separate fields with the correct image reference.

## Remaining device acceptance

- The current Android APK predates the new native module. A separately authorized app build and a connected Samsung Galaxy A53 5G are required to exercise the installation, runtime credentials, and WorkManager network and boot scenarios.
- Test both templates with fictional printed records. Verify history states at each transition, disable connectivity after page 1, relaunch after an ordinary process kill, reboot with a queued scan, and verify the same receipt and distinct raw and confirmed values through the API.
- Use an HTTPS endpoint trusted by the handset. The isolated host tests use a loopback-only HTTP mode available to the JVM fixture. The production Android client requires HTTPS. Device-side certificate trust and background scheduling remain unverified.
- The encrypted outbox keeps a separate accepted copy of each page to preserve immutable evidence through retries or later draft edits. It uses additional local storage. A retention or export policy for acknowledged copies is a future decision.
