# Phase 1 acceptance checklist

Phase 1 remains in progress. The native intelligent scanner is implemented; physical acceptance of the new APK is pending. The user confirmed processing failure on both capture paths and covered-camera false acceptance. The update is not physically accepted until retested. Phase 2 has not started.

Current app: **0.2.1 / code 7**, ph.tala.scanner.pilot. Designated phone: **Samsung Galaxy A53 5G**; Android version/build not recorded. Build: Windows, Node 24.12.0, Expo 54.0.38 / React Native 0.81.5, JDK 21, Gradle 8.14.3, AGP 8.11.0, compile/target API 36, minimum API 24. No portal/browser is in this phase.

## Mandatory checks

- **P1-01 - Not run (physical).** Expected: fresh standalone first launch offline opens both reference pages without a server/model download. Actual: bundled components are inspected and native OCR passed offline on the emulator; no A53 first-launch run. Evidence: [package inspection](evidence/apk-inspection.json). Retest P1-01 in [phone tests](phase-1-phone-tests.md).
- **P1-02 - Fail (earlier user report; updated physical retest pending).** Expected: permission recovery, live detection, automatic capture/crop, optional adjustment, independent page replacement/order. Actual: CameraX stream/manual capture/reopen and native OpenCV scenarios pass on the emulator. A53 overlay, auto shutter and touch workflow remain unverified. Evidence: [scanner acceptance](intelligent-scanner-acceptance.md). Retest P1-02.
- **P1-03 - Fail (earlier user report; updated physical retest pending).** Expected: real-camera offline OCR reads all seven clean BEEF values, excludes guardian names, preserves page 2, and reading areas match answers. Actual: 35 native fixture comparisons pass, including seven after automatic detection/warp; full multiline text also reads offline. Physical accuracy remains unmeasured. Evidence: [native tests](evidence/release-0.2.1-native-tests.json). Retest P1-03 and record raw values before correction.
- **P1-04 - Not run (physical).** Expected: optional blanks, leading zeroes, invalid/required errors and confirmations behave correctly. Actual: host validation tests pass; new capture/review UI still needs installed-app acceptance. Evidence: [116 host tests](evidence/release-0.2.1-tests.json). Retest P1-04.
- **P1-05 - Not run (physical).** Expected: saved UUID, both images, full/structured original OCR, corrections and readiness survive force-stop/offline reopen. Actual: persistence protocol and new block-text serialization pass host tests. Real SQLite/runtime test is pending. Retest P1-05.
- **P1-06 - Pass (host).** Expected: mapping/validation and missing-image/copy/write faults prevent unsafe acknowledgments/readiness. Actual: 116 tests across eight files pass; failed retakes retain previous files and metadata. Evidence: [host results](evidence/release-0.2.1-tests.json). Port tests do not replace device storage tests.

## Release checks

- **Pass:** TypeScript; six release-version guard tests; version 0.2.1/code 7 increases from 0.2.0/code 6; manifests/lockfile agree; source fingerprint stable before/after packaging.
- **Pass:** 17 offline native emulator tests, Android 16 x86_64 / BP41.250916.009.A1, airplane mode on and Wi-Fi off. Actual virtual-camera manual capture and two stream/reopen cycles, OpenCV scenarios/landmarks, stability and 35 field comparisons. See [native evidence](evidence/release-0.2.1-native-tests.json).
- **Pass:** documented release build, ARM64/ARMv7, both exact BEEF PNG payloads, offline Latin assets, native scanner/OpenCV in every packaged ABI, no instrumentation fixtures, and original signing certificate. APK: `output/android/TALA-Phase1-0.2.1.apk` (94,767,753 bytes), SHA-256 `010779fa35323e3c2c2072a63da8b1a0fda2fd2c9017162e75d13ed035b6b4f6`.
- **Not tested:** A53 live overlay/auto shutter, flashlight/focus, real glare/motion/quality thresholds, performance and real force-stop persistence. See the 17 [scanner acceptance statuses](intelligent-scanner-acceptance.md).

The supplied reference PDF/layout and expected field labels are unchanged. The two pre-existing working modifications (test report and clean fixture image) were preserved. No backend, authentication or sync implementation was added.

See [implementation/dependencies/changed files](intelligent-scanner.md), [release validation](evidence/release-0.2.1-validation.json), and [physical retest steps](phase-1-phone-tests.md). Obtain actual P1-01 through P1-05 results before requesting Phase 1 approval. Only after all mandatory checks pass, ask whether the user approves starting the capstone's Phase 2.

The 0.2.1 correction and exact failure-regression steps are in [scanner recovery](scanner-recovery-fix.md).
