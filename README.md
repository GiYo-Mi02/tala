# T.A.L.A. - Phase 1 Android pilot

Text Acquisition and Local Automation. This repository currently implements **Phase 1 only** of [the supplied build prompt](docs/master-build-prompt.md). The desktop portal, API, PostgreSQL, staff authentication, and sync start in later phases, after mandatory acceptance and explicit approval.

The Android app captures **both** BEEF pages, provides independent crop and retake, runs bundled Latin ML Kit OCR on seven mapped page 1 fields, preserves raw OCR separately from edited values, and stores unfinished or ready drafts in SQLite with private image files. It uses an isolated fictional local profile. A ready draft is available for future sync; it is not a Verified enrollment record.

## Install and test

Use the locally built APK in `output/android/TALA-Phase1-0.1.0.apk` when present. Follow [the phone acceptance instructions](docs/phase-1-phone-tests.md). Start with a fresh installation and enable airplane mode **before its first launch**, with Wi-Fi off. Expo Go and a Metro-connected development build do not qualify for P1-01.

Print the three fictional pairs in `output/pdf/` at actual size on A4 paper. The expected values are separate JSON files under `fixtures/expected/`. The two-page clean pair is the first camera test. Names on the forms are fictional; the guardian deliberately differs from the learner.

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

Only numeric grades 1-12 and typed English values in the seven mapped fields are extracted. Full-page rectangular crop and manual rotation are supported; perspective correction and automatic document alignment are not. Keep the paper flat, square to the camera, upright, and fully inside the crop. Grid lines, glare, blur, and letter spacing can affect actual OCR; every field needs human comparison and confirmation, including optional blanks. No OCR accuracy claim is made before physical-phone results.

SQLite and private files provide local persistence, not app-level encryption or protection from a compromised/rooted device. Android backup is disabled for this pilot. Only fictional test data should be used. Raw OCR is retained locally for review and is not written to logs. A retake clears readiness; a page 1 retake also clears field confirmations. Failed file or database writes do not acknowledge success. Unreferenced files left by an interrupted save are cleaned on the next startup.

The earlier M01-M04 stories and SC01 document were not supplied; the master prompt supplies the implemented workflow. Obtain those documents before claiming independent story/charter traceability.

See [Phase 1 acceptance evidence](docs/phase-1-checklist.md). **Do not begin Phase 2 until every mandatory Phase 1 check passes and the user explicitly approves it.**

Implementation references: [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/), [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [Expo Modules](https://docs.expo.dev/modules/get-started/), and [bundled ML Kit Latin recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2/android). Installed package types and source were used for SDK 54 API checks.
