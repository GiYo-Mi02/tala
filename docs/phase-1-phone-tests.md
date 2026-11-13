# Phase 1 physical-phone acceptance

Record the phone manufacturer/model, Android version, Android build number, T.A.L.A. version (`0.1.0`, Android version code `1`), APK SHA-256, tester, and date. Physical-phone results are required. Emulator or host tests do not replace these checks. No browser is used in Phase 1.

Designated phone: Samsung Galaxy A53 5G. Obtain its Android version and build number from Settings → About phone → Software information. The current APK SHA-256 is `62965c2f32eab2e577b1fdde4451a09a9087ecfe280a2c241f665a8c81b4f5d0`.

Use fictional data only. Download/transfer `output/android/TALA-Phase1-0.1.0.apk` and print each two-page PDF from `output/pdf/` at **actual size on A4 paper**. Retain every paper edge while cropping. The clean learner is ELENA SANTOS RIVERA, LRN `001234567890`, grade `7`, school year `2024-2025`, birthdate `02/29/2012`. The legal guardian is MARCELA TORRES, deliberately different.

## P1-01 - first launch offline

1. Install the APK. Finish installation with **Done**, not Open. If this app was used previously, use a designated disposable test installation; uninstalling removes its drafts.
2. Enable airplane mode and separately switch Wi-Fi off. Leave the laptop/development server unavailable.
3. Launch T.A.L.A. and open **View both blank reference pages**. Switch pages. Record whether both appear with no server or model download.
4. Record Pass/Fail and evidence (for example a short video showing network settings and launch).

## P1-02 - permission, crop, and retake

1. Create a new BEEF draft and record its UUID. Tap **Capture page 1** and deny permission. Confirm the recovery instructions appear and no image is accepted in the slot.
2. Grant camera permission from the app or Android Settings → Apps → T.A.L.A. Pilot → Permissions → Camera. Return and capture the clean printed page 1.
3. On the crop screen rotate upright if needed, select **Top left** and tap the paper's top-left edge, then select **Bottom right** and tap its bottom-right edge. Accept the entire paper. A crop with the wrong page shape or insufficient resolution is refused.
4. Capture and accept page 2. View each numbered slot. Retake page 2 using a visibly different photograph, crop it, and accept it. Confirm page 1 is unchanged and slot 2 shows only the replacement. A discarded candidate must not replace either accepted slot.
5. Save the unfinished draft. Record Pass/Fail and capture/page order evidence.

## P1-03 - actual bundled OCR

1. Keep airplane mode on and Wi-Fi off. Open the clean draft and tap **Run bundled OCR on page 1**.
2. Compare every original OCR and editable field with `fixtures/expected/clean.json`. Birthdate is entered as MM/DD/YYYY and stored as YYYY-MM-DD. Do not silently correct before recording the pre-correction result.
3. Confirm no learner field contains MARCELA or TORRES from the guardian section. View page 2 as evidence and use its zoom controls.
4. Record the actual text for all seven fields, whether each matched, any correction needed, and Pass/Fail. Incorrect OCR is a failure of the clean-fixture exact-match check; preserve the evidence for a mapping/OCR fix and retest.

## P1-04 - blanks, invalid values, and readiness

1. Make a new draft using `beef-optional-blanks.pdf`. Accept both pages and run OCR offline. Check LRN and middle name remain blank; compare the other five values with its expected JSON. The learner surname is DELA CRUZ, not TORRES.
2. Make another draft using `beef-invalid-required.pdf`. Accept both pages and run OCR. Check missing grade and first name, school year `2024-2026`, and impossible date `02/30/2014` are flagged. The LRN `000123456789` must retain all leading zeroes.
3. Confirm an unfinished/invalid draft cannot be saved as ready. Save it unfinished and reopen it. Correct school year to `2024-2025`, grade to `7`, first name to `JULIAN`, and birthdate to `02/28/2014`. Confirm validation updates as fields change.
4. Check all seven values against the page and confirm them. Save as ready only when both accepted files exist and all values are valid. Record Pass/Fail and screenshots.

## P1-05 - force-stop and reopen

1. On the clean draft, preserve its original OCR, correct one name to the typed page value if needed, confirm all seven fields, and save as ready. Record the UUID, values, page order, raw OCR, and state. The Save confirmation must be visible before force-stop.
2. Android Settings → Apps → T.A.L.A. Pilot → **Force stop**. Do not clear storage or uninstall.
3. Reopen offline with the laptop unavailable. Confirm the UUID, both accepted images, page order, raw output, corrected values, and readiness are unchanged. View both images.
4. Repeat for the unfinished invalid draft before correcting it. Confirm it remains editable. Record Pass/Fail and evidence.

## P1-06 - automated faults

Run `npm.cmd test`. The mapping fixture supplies independent coordinates and a different guardian; it is not fabricated ML Kit output. Save tests inject a missing accepted image, failed persistent copy, and failed metadata commit. They require errors, prevent acknowledgment/readiness, retain the previous accepted page, and remove failed replacement files. Review `docs/evidence/unit-tests.json`.

These are host tests of the save protocol. They do not demonstrate camera behavior or actual SQLite/ML Kit execution on a phone; P1-01 through P1-05 establish those runtime results.

## Report back

Send the device details plus a Pass/Fail result for P1-01 through P1-05. For any failure, include the test step, what appeared, and the seven pre-correction OCR values when relevant. Do not send real learner forms. Keep this project in Phase 1 until failures are fixed, the affected checks are repeated, and all mandatory checks pass.
