# Portrait camera and reading-area correction - 0.1.4

Current release: **0.2.0** uses automatic CameraX/OpenCV detection; corner adjustment is optional. See [the intelligent scanner implementation](intelligent-scanner.md). This document records the earlier correction.

The reported reading-area offset came from treating a full camera photo as an aligned BEEF page. The inset paper guide left camera background in the saved image, and the flexible preview could have a different aspect ratio from the photo. Template field coordinates were then applied to that full photo, shifting and scaling the areas read.

The camera now uses the Android 4:3 sensor setting inside a measured **portrait 3:4 preview**. The view fits the available screen space without stretching; its centered paper guide uses the supplied BEEF page proportions. The photo retains orientation processing and full resolution. The guide is a framing aid, not an OCR alignment transform. This follows the installed Expo Camera 17 source and its [SDK 54 ratio/orientation API](https://github.com/expo/expo/blob/sdk-54/packages/expo-camera/src/Camera.types.ts).

Every new capture now opens four-corner alignment. Mark the actual paper corners in the captured image, rotate upright if necessary, and select **Straighten & preview**. The native perspective transform produces a 1600 x 2263 page without camera margins. On page 1, check that the green regions cover the answer boxes below the labels, then select **Accept aligned page 1**. OCR uses that accepted page and the same coordinate system as the displayed regions. The supplied BEEF source and field coordinates are unchanged.

Birth-date cells now use an 80-pixel content height during native OCR preparation; other fields retain their tested 52-pixel scale. The larger date glyphs address a leading zero lost after camera perspective resampling while preserving single-digit grade recognition. This changes image preparation, not the recognized characters or expected fixture values. New OCR runs record `grid-lines-v2`; older `grid-lines-v1` runs remain readable. The [initial camera regression](evidence/camera-scale52-regression.xml) records the missing digit before this correction.

The normalized camera file remains available until the alignment screen accepts or discards it. A photograph alone no longer replaces the accepted page. Failed capture, processing, or handoff cleans the candidate; cancelling alignment and failed saves preserve the previously accepted page. Capture also blocks navigation while the camera is processing.

## Upgrade and retest

Install `output/android/TALA-Phase1-0.1.4.apk` as an update, without uninstalling or clearing storage. Version 0.1.4 / Android code 5 follows the local 0.1.3 / code 4 candidate; it upgrades the earlier 0.1.2 / code 3 installation. The build checks all release versions, packaged identity, source fingerprint, and the existing pilot signing certificate.

Old `guide-v1` photos and their drafts remain readable. Those photos now require **Align saved page 1** before OCR can run. Realign, check the green areas, accept, and rerun OCR; existing OCR is not silently recalculated. Alignment retains edited values and raw history and clears page 1 confirmations/readiness. Rerunning OCR asks before replacing editable values.

For the Samsung Galaxy A53 5G, repeat P1-02 and P1-03 in [the phone tests](phase-1-phone-tests.md), using the clean fictional printed form. Check that the preview stays taller than it is wide, all paper edges are visible, the straightened page is upright, and each **View area read** strip contains the corresponding answer. Test a centered photograph and an angled photograph. Compare all seven OCR values before making corrections. Record the installed version, Android version/build, and results.

## Verification

- TypeScript and all six release-version guard tests passed.
- All 112 host tests across eight files passed, including portrait framing on narrow, short, and tall screens; guide proportions; orientation-normalized image ownership; failed capture/processing/handoff; and refusal to crop old full-camera guide photos.
- Release build and the expanded native regression results are recorded in [release validation](evidence/release-0.1.4-validation.json). The native regression adds an offset, angled BEEF page inside a simulated 3024 x 4032 camera photo; it checks actual bundled ML Kit readings after paper alignment against unchanged expected values.
- Physical camera accuracy on the Galaxy A53 5G requires the updated APK retest. The user's earlier report of misplaced areas and poor reading remains unresolved acceptance evidence until that retest passes. Phase 2 has not started.
