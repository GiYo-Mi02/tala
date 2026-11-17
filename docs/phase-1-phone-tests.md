# Phase 1 physical-phone acceptance - intelligent scanner

**First repeat the [processing/blank-scan regression checks](scanner-recovery-fix.md#phone-retest).** Covered/empty/no-text captures must not Continue. Crop failures should keep the original and show a code instead of reopening the camera on their own.

Install **0.2.1 / Android code 7** from `output/android/TALA-Phase1-0.2.1.apk` as an update to preserve drafts. SHA-256: `010779fa35323e3c2c2072a63da8b1a0fda2fd2c9017162e75d13ed035b6b4f6`. Record tester/date, Samsung Galaxy A53 5G model, Android version/build (Settings > About phone > Software information), installed app version and each result. An emulator result is not a phone pass.

Use fictional printed forms only. Print `output/pdf/` at actual size on A4 for the registered BEEF tests. Auto detection/cropping also supports other document proportions, but automatic structured fields are limited to BEEF. Other layouts expose full OCR text rather than inventing field mappings.

## P1-01 - first launch offline

1. Use a separate disposable test installation for the fresh first-launch check; do not uninstall the installation whose drafts you need. Finish installation with Done.
2. Enable airplane mode and separately disable Wi-Fi before first launch. Keep the laptop/server unavailable.
3. Open the app and both bundled blank reference pages. Record that no server/model download is required.

## P1-02 - permission, automatic scan, optional crop and retake

1. Create a draft and record its UUID. Deny camera permission. Check that the native recovery instructions create no accepted image. Allow permission or open Android app settings, then return.
2. Open Capture page 1. Auto is on by default. Put the entire clean fictional form on a contrasting desk and hold steady. Check the live polygon follows the paper, the status changes from searching/adjusting to hold steady, and a stable readable page captures automatically after about one second.
3. The app should correct the page and read it offline, then show **Continue / Retake / Adjust Crop**. It must not require corner taps. Check that no edges/text are removed or stretched. Continue and confirm the new image/OCR appear in the existing editor.
4. Repeat with slightly clockwise/counterclockwise and angled paper. Check the polygon against the actual edges. Use Auto Off and Capture to test manual shutter. Toggle Light on/off on the A53 and check focus/exposure recovery.
5. Exercise **Adjust Crop** once: the original source must remain available; rotate if necessary, mark/fine-tune corners, straighten, accept the corrected crop, and return to processed review/OCR. Cancelling adjustment must preserve the review candidate. Cancelling the scan must preserve the previous accepted page.
6. Cover a paper edge or use an unreliable boundary. No silently accepted crop is allowed. Retake or choose optional adjustment. Capture page 2 and Continue. Retake page 2 with a visibly different photo; verify page 1 is unchanged and only the accepted page 2 is retained.
7. Update an older installation without clearing data. Open an existing draft. When retaking page 1 with current values, Continue must offer Keep current values / Use new OCR / Cancel. Cancel must leave the accepted image and values unchanged; either acceptance choice requires fresh field confirmation. Raw structured history remains available.

## P1-03 - automatic bundled OCR and reading areas

1. Keep airplane mode on and Wi-Fi off. Capture/Continue the clean BEEF page. OCR runs automatically before review. The editor's Run OCR action remains available for retries and legacy pages.
2. Before correcting anything, record all seven raw/proposed values against `fixtures/expected/clean.json`. Expected: school year 2024-2025, grade 7, LRN 001234567890, learner RIVERA / ELENA / SANTOS, birthdate 02/29/2012 (stored as 2012-02-29). The different guardian is MARCELA TORRES and must not fill learner fields.
3. Open **View area read** for each result: the strip and marked areas must contain its answer boxes, below labels. Repeat after an angled capture. Page 2 stays viewable. Full OCR text should remain available in page review/viewer as unverified multiline text.
4. Compare results from all twelve scenarios: flat desk; clockwise; counterclockwise; angle; clutter; uneven light; light shadow; little background contrast; partial page; blur/movement; small print; tables/multiple fields. Record detection, overlay, shutter, crop and OCR separately. Low contrast/partial/blur may safely require Retake or Adjust Crop, without forcing adjustment when reliable detection succeeds.

## P1-04 - blanks, invalid values and readiness

1. Scan the optional-blanks pair: LRN and middle name stay empty; required values match its labels. Confirm optional blanks explicitly.
2. Scan the invalid-required pair. Missing/invalid required values must be flagged and cannot be ready. Leading zeroes remain strings. An OCR O in a numeric LRN must be flagged, not silently changed to zero.
3. Save unfinished, reopen, correct required values, and check validation updates. Only both accepted images plus valid values and all seven confirmations allow readiness. No data is uploaded.

## P1-05 - force-stop and reopen

1. Preserve original OCR, make a manual correction, confirm fields and save. Record UUID, page order/images, raw/full OCR, corrected values and state after the save acknowledgment.
2. Force-stop through Android Settings, without clearing storage or uninstalling. Reopen offline and check all recorded data, including full OCR text and field areas on the matching image.
3. Repeat with an unfinished draft. Check camera background/resume, Back during searching, capture cancellation and repeated captures: no duplicate accepted pages/OCR runs or stuck processing state.

## P1-06 - automated faults

Run `npm.cmd test`; the current saved report is [release-0.2.1-tests.json](evidence/release-0.2.1-tests.json). Missing accepted files, failed copies and failed writes must not acknowledge a save or delete the previous accepted file. These host tests do not prove native SQLite persistence.

Report Pass/Fail for P1-01 through P1-05, the twelve scenario results and phone OS/build. Include pre-correction values for reading failures and a fictional-form screenshot/video of a displaced overlay or crop. Keep Phase 1 active until failures are resolved and retested; no backend Phase 2 approval is being requested yet.
