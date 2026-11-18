# T.A.L.A. - Phase 1 Android pilot

Text Acquisition and Local Automation. This repository currently implements **Phase 1 only** of [the supplied build prompt](docs/master-build-prompt.md). The desktop portal, API, PostgreSQL, staff authentication, and sync start in later phases, after mandatory acceptance and explicit approval.

The Android app captures **both** BEEF pages, automatically detects/captures/crops documents with CameraX and OpenCV, offers optional crop adjustment and independent retake, runs bundled Latin ML Kit OCR on seven mapped page 1 fields, preserves raw OCR separately from edited values, and stores unfinished or ready drafts in SQLite with private image files. It uses an isolated fictional local profile. A ready draft is available for future sync; it is not a Verified enrollment record.

New fixed template: [SSS E-1 implementation, coverage, tests and phone checks](docs/sss-e1-template.md). SSS adds 127 typed regions and nine manual/visual controls, with optional additional-sheet capture. Open **SSS E-1 · template and local drafts** from the home screen. BEEF drafts retain their existing workflow. PhilHealth/Pag-IBIG and mobile-to-web integration remain pending.

Earlier [native field ROI extraction](docs/ocr-roi-investigation.md) and [processing-loop recovery](docs/scanner-recovery-fix.md) remain in place.

See the [E-1 print alignment fix](docs/sss-e1-alignment-fix.md) for saved-photo recovery, review zoom, and camera retests.

## Install and test

Use `output/android/TALA-Phase1-0.3.1.apk` (version code 10). Install it **as an update** to preserve drafts; do not uninstall or clear storage. The build checks that its signing certificate matches the earlier APK. Follow [the phone acceptance instructions](docs/phase-1-phone-tests.md). Use a separate disposable installation for the fresh first-launch test, with airplane mode enabled **before its first launch** and Wi-Fi off. Expo Go and a Metro-connected development build do not qualify for P1-01.

The native scanner uses a full-screen portrait preview, a live detected polygon, automatic capture after a stable readable view, and high-resolution OpenCV correction. Successful captures run offline OCR and open **Continue / Retake / Adjust Crop**, without requiring corner placement. See [implementation and dependencies](docs/intelligent-scanner.md) and [criterion-by-criterion acceptance](docs/intelligent-scanner-acceptance.md).

For an existing unaligned legacy photo, optional recovery remains available: open its draft and select **Align saved page 1**. Mark the four paper corners, select **Straighten & preview**, and check that the green regions cover the answer boxes below the labels. Accept the page and run OCR again. Previous raw OCR remains saved; realigning page 1 clears confirmations and readiness. Use **View area read** to inspect each result. Legacy results and replaced photos cannot show an exact reading area and explain why.

Printed BEEF labels are rejected as proposed values and flagged for review; the original text remains visible. Enter the correct value or explicitly confirm an optional blank. This guard does not establish that every other OCR result is correct.

Field OCR decodes exact regions from the corrected file without field downscaling. It compares original crops with narrowly grid-cleaned crops, adds white margins and only enlarges small inputs. Disagreement is visible; unresolved alternatives stay blank and changed readings remain uncertain proposals requiring confirmation. Matching detections inside an overlapping larger detection are deduplicated using their text and image coordinates. Complete original OCR is retained separately from this reading; proposed names use the BEEF form's capital-letter convention. No dictionary or expected fixture value fills a field.

Print the three fictional pairs in `output/pdf/` at actual size on A4 paper. The expected values are separate JSON files under `fixtures/expected/`. The two-page clean pair is the first camera test. Names on the forms are fictional; the guardian deliberately differs from the learner.

For SSS physical tests, print the fictional files `output/pdf/SSS-E1-*-fictional.pdf` on **US Letter at actual size**. Page 2 of the supplied original is instructions; the optional additional sheet keeps source page ID 3. These are local review drafts, not agency submissions.

For development-only inspection, use `output/android/TALA-Phase1-0.3.1-diagnostics.apk` as an update. Open **Development: OCR diagnostics** on scan review, or **Development: inspect saved-page OCR** in a draft. The release APK hides these diagnostics and does not retain diagnostic PNGs. Both variants include the JS bundle and OCR model for offline use. Build the diagnostic variant with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Diagnostics`.

## Release version checks

The build validates `app.json`, the root/scanner package versions, and the lockfile before Gradle runs. For changed app source, increment the app version and Android `versionCode`; this release is **0.3.1 / code 10**. Rebuilding an already recorded version is allowed only when the authored source fingerprint is unchanged. The build checks the packaged identity and upgrade signing certificate, then confirms source did not change during packaging. Run `node scripts/check-android-version.cjs` to check without building, and `node --test scripts/check-android-version.test.cjs` to test the guard.

## Development setup on Windows

Required: supported Node.js LTS (tested with 24.12.0), npm, JDK 17 or 21, and Android SDK with platform 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, and accepted SDK licenses. Package versions and the npm lockfile are pinned. JDK 25 is not used with this Gradle version.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
$env:TALA_JAVA_HOME = 'C:\path\to\jdk-21'
$env:ANDROID_HOME = 'C:\AndroidSDK\Sdk'
npm.cmd run build:android
```

The build script runs Expo prebuild, pins the generated wrapper to checksum-verified Gradle 8.14.3, uses the **release** task to embed the JavaScript and reference images, builds ARM64 and ARMv7, and copies the APK into `output/android/`. Keep this Gradle version with the pinned SDK and JDK; avoid IDE upgrades of the generated wrapper. The APK uses the generated Android debug signing identity for this fictional capstone pilot. This is a local build, not a cloud build or a production distribution identity. Do not uninstall or clear app data when preserving drafts.

The local Expo plugin shortens generated CMake paths for Windows Ninja. `npm.cmd run build:android -- -VerboseGradle` records detailed dependency/build diagnostics in `docs/evidence/android-build.log`. The final package inspection compares embedded template image content, since Android renames packaged resources.

Native instrumentation tests include actual CameraX preview/manual capture/reopen, OpenCV contour and quality scenarios, perspective content landmarks, stability/coordinate checks, and actual bundled ML Kit recognition. The clean OCR baseline is a separate test-only copy of the committed fixture, preserving a locally modified working image. With the native project prepared, one test device connected, airplane mode on and Wi-Fi off, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-android.ps1`. For an x86_64 emulator, add `-Architectures x86_64`. Reports are under `apps/scanner/modules/tala-ocr/android/build/reports/androidTests/connected/debug/`. Emulator results supplement the mandatory physical-phone tests. Fixture images and labels are included only in the instrumentation APK, never the release app.

After the release build has prepared the native project, `npm.cmd run start:android` uses Expo's Android debug build workflow and starts Metro for a connected phone or emulator. Expo Go cannot load the local OCR module. Use the standalone release APK for acceptance, and rebuild it after changes. No remote OCR, runtime model download, Expo Update, backend, analytics, or automatic upload is implemented.

## Repository layout

- `apps/scanner`: Expo Android app, private SQLite/files adapter, camera/crop/review screens, and local native OCR module.
- `packages/core`: field keys, Zod rules, template mapping, draft state, and testable save protocol.
- `references`: the supplied blank BEEF PDF, preserved unchanged.
- `fixtures/expected`: independently labeled fictional values and source-position regression fixtures; never imported into app runtime.
- `fixtures/images` and `output/pdf`: generated fictional forms for printing and inspection.
- `docs/evidence`: test output, source PDF placement, mapping overlay, and build evidence.

## Recreate reference images and fixtures

Use a Python 3.14 environment with `scripts/requirements-pdf.txt`, or install the packages into the ignored `.tools/python` directory. The scripts also work with a normal virtual environment. On this laptop pip's global CA path was stale; use a valid certificate bundle if pip reports that error rather than disabling certificate validation.

```powershell
python -m pip install --target .tools/python -r scripts/requirements-pdf.txt
python scripts/prepare_template.py
python scripts/create_fixtures.py
```

`prepare_template.py` renders the **entire PDF page**. Its embedded images are sideways and extend outside the paper bounds; extracted image ratios alone are unsuitable for full-page camera mapping. `template.ts` transforms measured input boxes through the PDF's actual image placement. See `docs/evidence/mapping-overlay.png` for a visual check.

## Limits and phase gate

BEEF extracts numeric grades 1-12 and typed English values in its seven mapped fields. SSS E-1 has separate versioned mappings and validation; see its coverage and measured OCR limitations above. OpenCV detects and corrects the paper automatically while preserving estimated document proportions. Manual corner adjustment is optional. Keep the whole paper visible and review the corrected image; retake or adjust an unreliable crop. Legacy four-corner images remain readable. Crossed, degenerate, outside, and undersized selections are rejected. Grid lines, glare, blur, and letter spacing can affect actual OCR; every field needs human comparison and confirmation, including optional blanks. Physical-phone accuracy remains subject to acceptance testing.

SQLite and private files provide local persistence, not app-level encryption or protection from a compromised/rooted device. Android backup is disabled for this pilot. Only fictional test data should be used. Raw OCR is retained locally for review and is not written to logs. A retake clears readiness; a page 1 retake also clears field confirmations. Failed file or database writes do not acknowledge success. Unreferenced files left by an interrupted save are cleaned on the next startup.

The earlier M01-M04 stories and SC01 document were not supplied; the master prompt supplies the implemented workflow. Obtain those documents before claiming independent story/charter traceability.

See [Phase 1 acceptance evidence](docs/phase-1-checklist.md). **Do not begin Phase 2 until every mandatory Phase 1 check passes and the user explicitly approves it.**

Implementation references: [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/), [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [Expo Modules](https://docs.expo.dev/modules/get-started/), and [bundled ML Kit Latin recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2/android). Installed package types and source were used for SDK 54 API checks.
