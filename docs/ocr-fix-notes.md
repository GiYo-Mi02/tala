# OCR field selection fix — 0.1.1

Current release: **0.2.0** uses automatic CameraX/OpenCV detection; corner adjustment is optional. See [the intelligent scanner implementation](intelligent-scanner.md). This document records the earlier correction.

The 0.1.1 OCR correction below is retained as historical evidence.

The scanner now requires four-corner alignment before OCR. It straightens each page to 1600 × 2263, previews the mapped answer regions, rejects printed BEEF labels as proposed values, and lets the reviewer inspect the actual source regions used for a result. The supplied reference PDF and field mapping coordinates remain unchanged.

## Installed-app workflow

Install `output/android/TALA-Phase1-0.1.1.apk` as an update. Keep the existing app installed and do not clear storage. The build verifies the original signing certificate before handing off an upgrade.

For an older draft, select **Align saved page 1**, mark top-left, top-right, bottom-right and bottom-left paper corners, then select **Straighten & preview**. Use the arrow buttons for small adjustments. The green regions must cover answer boxes below their labels. Select **Adjust corners** if necessary, then accept the aligned page and rerun OCR. Retake the photograph if the old crop omitted paper edges or content.

Realignment preserves edited values and raw OCR history, replaces the accepted image only after a successful save, and clears page 1 confirmations/readiness. Cancelling or a failed save retains the previous accepted image. Each field still needs human confirmation, including optional blanks. **View area read** refuses to place historical coordinates on a replacement photograph; older app results without exact crop metadata also explain that their area is unavailable.

## Extraction implementation

- Perspective correction runs in the local native module using four-point Android matrix transformation. Both TypeScript and Kotlin validate the selection, including order, convexity, bounds and source resolution.
- Field preprocessing removes long grid rules, scales rows to 52 pixels high and adds 32 pixels of white margin. Bounding boxes are converted back through this transformation before page-coordinate mapping.
- ML Kit can return a partial duplicate inside a larger reading of the same glyphs. A shorter reading is removed only when its normalized text occurs in a larger reading and at least 85% of its box overlaps it. Different text or spatially separate repeated characters are retained.
- `RawField.text` retains complete original OCR. Optional `readingText` records the deduplicated reading used for normalization; `regions` stores the exact rounded pixel crops in page coordinates, and `warning: label_detected` records rejection of printed labels. Proposed names follow the form's capital-letter convention while original casing remains in raw OCR.
- Optional `Page.alignment` and `OcrRun.preprocessing` identify the processing applied. Existing JSON drafts remain readable without a database migration. Alignment is required before rerunning OCR on an old page, rather than silently treating an old image as aligned.
- No expected fixture value, name dictionary, remote OCR, or model download fills a field. Fixture images and labels belong only to the test APK.

## Verification and limits

- **Pass — TypeScript.** `npm.cmd run typecheck`.
- **Pass — 99 host tests across seven files.** Includes label-only/mixed/merged label results, unchanged raw OCR, normalized reading, exact crop and coordinate conversion, leading zeroes, optional blanks, legacy pages, readiness and save rollback. Evidence: `evidence/unit-tests.json`.
- **Pass — five native Android checks on an offline emulator.** Perspective landmarks, invalid-corner file cleanup, preservation of character strokes while removing grid rules, conservative duplicate removal, and actual bundled ML Kit recognition across all three unchanged fictional fixtures. All 21 field comparisons match after removing OCR inter-character whitespace and normalizing name case; intentional name spacing is covered separately by host tests. Evidence: `evidence/android-native-tests.json` and `.xml`.
- Native test environment: isolated `TALA_OCR` x86_64 AVD, Android 16, build `BP41.250916.009.A1`, airplane mode enabled, Wi-Fi off. This does not establish physical camera accuracy.
- Release build, package content and signing results are recorded in `evidence/build-result.json`, `evidence/apk-inspection.json`, `evidence/apk-badging.txt` and `evidence/apk-signature.txt`.
- **Not run — physical P1-01 through P1-05.** No physical phone is connected. The designated Samsung Galaxy A53 5G still needs its OS/build recorded and the updated APK exercised using `phase-1-phone-tests.md`. Emulator results do not change those statuses. Phase 2 has not started.

Rebuild with `npm.cmd run build:android`. Run native checks with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-android.ps1`; use `-Architectures x86_64` for a matching emulator. Use a single connected test device and explicitly enable airplane mode with Wi-Fi off before testing.
