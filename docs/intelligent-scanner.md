# Intelligent document scanner - 0.2.0 / Android code 6

Current update: **0.2.1 / code 7**. The user subsequently reported failures on both capture paths; see [processing recovery and retest status](scanner-recovery-fix.md). The 0.2.0 emulator evidence below is historical and does not close that phone failure.

The mobile scanner now detects paper boundaries with OpenCV, captures a stable readable document through CameraX, corrects it automatically, and runs bundled offline OCR before review. The successful path opens **Continue / Retake / Adjust Crop**, without requiring manual corner placement. Adjust Crop remains an explicit fallback.

## Existing-project assessment

The inspection found Expo 54.0.38 / React Native 0.81.5, a local Expo Kotlin module (`TalaOcr`), bundled ML Kit Latin 16.0.1, seven BEEF field mappings, SQLite draft JSON, private accepted image files, and existing image/field verification screens. The former entry point was `Capture.tsx`, using Expo Camera and always navigating to `Alignment.tsx`. No Google ML Kit Document Scanner was present.

Minimum Android API is 24. The existing build uses compile/target API 36, AGP 8.11.0, Kotlin 2.1.20, checksum-pinned Gradle 8.14.3 and JDK 21. Those constraints were retained. No portal, authentication service, API endpoints or active synchronization exist in this Phase 1 checkout. The scanner request's numbered implementation steps do not introduce the capstone's later backend phases.

The technical assessment was provided before implementation. Navigation, the isolated fictional profile, field validation, confirmations/readiness, stable draft UUIDs, private image replacement, and raw structured OCR history were retained. The scanner supports different paper proportions; structured extraction remains limited to the selected BEEF template. Other layouts retain full OCR text and require manual BEEF verification or a matching form, rather than applying unregistered field coordinates automatically.

## Runtime architecture

`Capture.tsx` opens a private native `DocumentScannerActivity` through the existing Expo module. The activity owns CameraX PreviewView, ImageAnalysis, ImageCapture, permission recovery, torch control and lifecycle binding. Auto capture starts enabled. Manual capture remains available whenever the preview stream is running.

ImageAnalysis uses KEEP_ONLY_LATEST and a single worker executor. It copies the Y plane with its row and pixel strides, applies crop/orientation information, and detects contours in reduced-resolution grayscale frames. Gaussian filtering, Canny, morphology and quadrilateral approximation select a convex exterior boundary using area, angles, edge coverage, inside/outside contrast and perspective limits. Boundary contrast reduces confusion with internal table rules. There is no A4-only detector or static framing rectangle.

The overlay converts upright detection coordinates back to the original analysis buffer, including crop offsets, then uses CameraX CoordinateTransform with the shared ViewPort and PreviewView output transform. It does not infer coordinates from screen percentages. See the official [CameraX transformations](https://developer.android.com/media/camera/camerax/transform-output) and [image analysis/backpressure](https://developer.android.com/media/camera/camerax/analyze) guidance.

CaptureStability compares corners with an anchor over a default 1,000 ms interval, requires multiple observations, resets on movement, quality failure or a frame gap, and latches after success. Blur, brightness, detected glare, completeness and document size gate automatic capture. The thresholds are kept in ScannerConfig; the React caller supplies the adjustable timing, motion and quality settings. Smoothing affects the displayed polygon, not the crop. An atomic capture guard prevents automatic and manual shutter requests from overlapping.

After ImageCapture saves the high-resolution JPEG, processing applies EXIF orientation and re-detects the paper in that photograph. Preview corners are not blindly reused on another-resolution image. OpenCV getPerspectiveTransform/warpPerspective removes background while retaining estimated document proportions, with bounded memory/resolution. It does not force arbitrary paper into a 1600 x 2263 rectangle. Geometry that is not trustworthy returns the original photo and a reason; Continue is disabled until a corrected candidate exists. A manual capture can retain a quality warning while still using a reliable geometric crop.

The camera activity then releases its camera resources and returns small file metadata to React. Bundled ML Kit reads the corrected image. Full multiline text, blocks, lines and normalized boxes are staged on the candidate. If page 1 matches the BEEF title/labels and upright proportions, the existing seven-region extraction and label guards also run. No detected label, dictionary or expected fixture value supplies a field value.

Continue copies the accepted image and commits its metadata/OCR through the existing save protocol. Original camera and normalized source files remain in cache through processing and review, including optional crop adjustment. They are discarded after acceptance/cancellation or replacement. Failed private copies or database writes retain the previous accepted page and leave the review candidate available for retry. Existing field values are replaced only after an explicit choice when the draft already contains values or OCR. New results never confirm fields or submit anything to a backend.

Full-page OCR is an optional Page.documentOcr JSON property; older drafts remain readable without a schema migration. Existing structured OcrRun data and its page-image identity remain intact. The page viewer also exposes full original OCR as unverified text. Generic full text is read-only; the existing seven BEEF fields remain editable and validated.

## Dependencies and packaging

- Added CameraX core, camera2, lifecycle and view **1.5.3**, using the compatible stable 1.5 series. See the official [CameraX release notes](https://developer.android.com/jetpack/androidx/releases/camera).
- Added official Maven Central **org.opencv:opencv:4.12.0**, loaded locally with OpenCVLoader.initLocal. See [OpenCV's Android/Maven integration](https://docs.opencv.org/4.12.0/d5/df8/tutorial_dev_with_OCV_on_Android.html). No OpenCV Manager or runtime download is required.
- Pinned Activity KTX **1.10.1** and ExifInterface **1.4.2** for the native screen and photo orientation. Added AndroidX Test core **1.6.1** for lifecycle tests.
- Retained bundled **com.google.mlkit:text-recognition:16.0.1**, SQLite, ImageManipulator, shared validation and existing OCR preprocessing.
- Removed **expo-camera 17.0.10** and its config plugin. No replacement cloud scanner or OCR service was added.
- Packaging selects one shared C++ runtime and filters all native libraries to the same requested ABIs as React Native. The compared ARM64 React/OpenCV runtimes export the same 2,336 symbols. The APK inspector checks native scanner classes, OpenCV in every packaged ABI, both reference images, bundled Latin assets and absence of instrumentation fixtures. The release contains ARM64 and ARMv7.

## Verification and limits

See [acceptance results](intelligent-scanner-acceptance.md), [release evidence](evidence/release-0.2.0-validation.json) and [physical-phone steps](phase-1-phone-tests.md). The release build and upgrade signing checks passed. TypeScript, 115 host tests, six version-guard tests and 13 offline native emulator tests passed. Native tests cover actual CameraX manual capture/reopen, detector scenarios, OpenCV content landmarks, proportion preservation, raw-buffer coordinate rotations, stability/quality gates and 35 fixture-field comparisons.

The initial synthetic camera test stretched the BEEF image to the generic test page's different proportions and produced an O/0 LRN error. The final BEEF camera fixture preserves the supplied form's proportions, without changing expected text; all comparisons then passed. The initial failure remains recorded in [scanner-initial-regression.xml](evidence/scanner-initial-regression.xml). This demonstrates OCR sensitivity, not universal accuracy. Raw text is never silently changed from O to 0, and numeric validation flags such results for correction.

The user's modified `fixtures/images/clean-page-1.png` and pre-existing test report were preserved byte-for-byte. Native clean-fixture checks use a separate test-only copy from commit a19c3fa, with provenance recorded in [the native results](evidence/release-0.2.0-native-tests.json). No expected labels were altered and test fixtures are excluded from the release APK.

The Galaxy A53 5G has not run this version. Live automatic shutter timing, overlay tracking, real focus/exposure, flashlight behavior, glare, motion, performance and force-stop persistence still need physical acceptance. Low contrast can prevent reliable boundaries; other rectangular objects can still resemble paper. Review remains necessary. No live synchronization or backend/authentication test is claimed. Phase 2 has not started.

## Install and build

Install `output/android/TALA-Phase1-0.2.0.apk` as an update, preserving app data. The package remains ph.tala.scanner.pilot; Android version code is 6. The build verifies the prior signing certificate and version/source consistency. Use the [phone instructions](phase-1-phone-tests.md) to check the new automatic path and optional adjustment.

Build: `npm.cmd run build:android`. Host checks: `npm.cmd test`, `npm.cmd run typecheck`, `node --test scripts/check-android-version.test.cjs`. Native checks, with one offline test device connected: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-android.ps1 -Architectures x86_64` for the emulator; use its actual ABI for another device.

The following changed-file list is generated from this release's working changes and excludes the two preserved user modifications.

## Changed files

- [README.md](../README.md): Integration or release documentation.
- [apps/scanner/app.json](../apps/scanner/app.json): Release version consistency and dependency/lockfile updates.
- [apps/scanner/modules/tala-ocr/android/build.gradle](../apps/scanner/modules/tala-ocr/android/build.gradle): Pin CameraX/OpenCV/activity/EXIF/test libraries and shared runtime packaging.
- [apps/scanner/modules/tala-ocr/android/src/androidTest/assets/ocr-baseline-clean-page-1.png](../apps/scanner/modules/tala-ocr/android/src/androidTest/assets/ocr-baseline-clean-page-1.png): Regression checks or test-only baseline; excluded from release runtime.
- [apps/scanner/modules/tala-ocr/android/src/androidTest/java/expo/modules/talaocr/DocumentScannerTest.kt](../apps/scanner/modules/tala-ocr/android/src/androidTest/java/expo/modules/talaocr/DocumentScannerTest.kt): Regression checks or test-only baseline; excluded from release runtime.
- [apps/scanner/modules/tala-ocr/android/src/androidTest/java/expo/modules/talaocr/PerspectiveTest.kt](../apps/scanner/modules/tala-ocr/android/src/androidTest/java/expo/modules/talaocr/PerspectiveTest.kt): Regression checks or test-only baseline; excluded from release runtime.
- [apps/scanner/modules/tala-ocr/android/src/main/AndroidManifest.xml](../apps/scanner/modules/tala-ocr/android/src/main/AndroidManifest.xml): Camera permission and private portrait scanner activity.
- [apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/DocumentDetector.kt](../apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/DocumentDetector.kt): Real OpenCV contour/quality selection and native resource cleanup.
- [apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/DocumentImages.kt](../apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/DocumentImages.kt): Private image bounds, EXIF normalization, high-resolution detection and proportion-preserving OpenCV warp.
- [apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/DocumentScannerActivity.kt](../apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/DocumentScannerActivity.kt): Native CameraX screen, permission/lifecycle, controls, overlay, shutter and image handoff.
- [apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/ScannerGeometry.kt](../apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/ScannerGeometry.kt): Corner geometry, configurable quality thresholds, orientation and stable-capture latch.
- [apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/TalaOcrModule.kt](../apps/scanner/modules/tala-ocr/android/src/main/java/expo/modules/talaocr/TalaOcrModule.kt): Native scanner result bridge, general document warp and multiline offline OCR.
- [apps/scanner/modules/tala-ocr/index.ts](../apps/scanner/modules/tala-ocr/index.ts): Typed native module methods.
- [apps/scanner/package.json](../apps/scanner/package.json): Release version consistency and dependency/lockfile updates.
- [apps/scanner/plugins/with-windows-cmake.js](../apps/scanner/plugins/with-windows-cmake.js): Retain Windows path fix; match native ABIs and select a shared C++ runtime.
- [apps/scanner/src/Alignment.tsx](../apps/scanner/src/Alignment.tsx): Optional OpenCV manual fallback with explicit cache ownership and duplicate-operation guards.
- [apps/scanner/src/App.tsx](../apps/scanner/src/App.tsx): Accept scan/OCR atomically, preserve existing values until a choice, and expose full original OCR.
- [apps/scanner/src/Capture.tsx](../apps/scanner/src/Capture.tsx): Automatic native scanner, offline processing/review and optional adjustment flow.
- [apps/scanner/src/captureSupport.test.ts](../apps/scanner/src/captureSupport.test.ts): Regression checks or test-only baseline; excluded from release runtime.
- [apps/scanner/src/captureSupport.ts](../apps/scanner/src/captureSupport.ts): Staged scan contracts, BEEF identification and non-mutating acceptance data.
- [apps/scanner/src/ocr.test.ts](../apps/scanner/src/ocr.test.ts): Regression checks or test-only baseline; excluded from release runtime.
- [apps/scanner/src/ocr.ts](../apps/scanner/src/ocr.ts): Preserve existing extraction and block BEEF regions on incompatible orientations.
- [docs/camera-alignment-fix.md](../docs/camera-alignment-fix.md): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/evidence/apk-badging.txt](../docs/evidence/apk-badging.txt): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/evidence/apk-inspection.json](../docs/evidence/apk-inspection.json): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/evidence/build-result.json](../docs/evidence/build-result.json): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/evidence/release-0.2.0-native-tests.json](../docs/evidence/release-0.2.0-native-tests.json): Regression checks or test-only baseline; excluded from release runtime.
- [docs/evidence/release-0.2.0-native-tests.xml](../docs/evidence/release-0.2.0-native-tests.xml): Regression checks or test-only baseline; excluded from release runtime.
- [docs/evidence/release-0.2.0-tests.json](../docs/evidence/release-0.2.0-tests.json): Regression checks or test-only baseline; excluded from release runtime.
- [docs/evidence/release-0.2.0-validation.json](../docs/evidence/release-0.2.0-validation.json): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/evidence/scanner-initial-regression.xml](../docs/evidence/scanner-initial-regression.xml): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/intelligent-scanner-acceptance.md](../docs/intelligent-scanner-acceptance.md): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/intelligent-scanner-request.md](../docs/intelligent-scanner-request.md): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/intelligent-scanner.md](../docs/intelligent-scanner.md): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/ocr-fix-notes.md](../docs/ocr-fix-notes.md): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/phase-1-checklist.md](../docs/phase-1-checklist.md): Requirements, release evidence, acceptance status or device retest instructions.
- [docs/phase-1-phone-tests.md](../docs/phase-1-phone-tests.md): Regression checks or test-only baseline; excluded from release runtime.
- [docs/phase-1-results.json](../docs/phase-1-results.json): Requirements, release evidence, acceptance status or device retest instructions.
- [package-lock.json](../package-lock.json): Release version consistency and dependency/lockfile updates.
- [package.json](../package.json): Release version consistency and dependency/lockfile updates.
- [packages/core/src/alignment.test.ts](../packages/core/src/alignment.test.ts): Regression checks or test-only baseline; excluded from release runtime.
- [packages/core/src/alignment.ts](../packages/core/src/alignment.ts): Backward-compatible OpenCV alignment metadata and variable document dimensions.
- [packages/core/src/draft.ts](../packages/core/src/draft.ts): Optional multiline/block OCR on page snapshots; old draft JSON remains compatible.
- [packages/core/src/storage.test.ts](../packages/core/src/storage.test.ts): Regression checks or test-only baseline; excluded from release runtime.
- [scripts/inspect_apk.py](../scripts/inspect_apk.py): Verify scanner classes, bundled OpenCV/Latin/reference assets and ARM-only packaging.
