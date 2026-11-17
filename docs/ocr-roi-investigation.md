# Field OCR correction - 0.2.2 / Android code 8

## What the supplied evidence establishes

The pasted text is the **whole-page reference OCR**, which includes printed labels, instructions and guardian information. It is not the structured seven-field extraction result. The screenshot's green rectangles indicate that the previous field extraction path also ran. They are React sibling overlays in `ReadingImage`, not pixels drawn into the saved image or the ML Kit input.

Against the supplied screenshot, the pasted whole-page text has these outcomes:

- School year: expected `2024-2025`; malformed fragments such as `2lo2ļa]-2|0|2|5]`; incorrect.
- Grade level: expected `7`; `Grade Level 7` is present; correctly visible in reference text, although reference text does not preserve a field ID.
- LRN: expected `001234567890`; `oo12|B4567|89o`; incorrect, with leading zeros misrecognized.
- Learner last name: expected `RIVERA`; `RvER|A`; incorrect.
- Learner first name: expected `ELENA`; absent; missing.
- Learner middle name: expected `SANTOS`; absent; missing.
- Birthdate: expected `02/29/2012`; `o229202|2`; incorrect.
- Guardian: `MARCELA` appears correctly; expected surname `TORRES` appears as `TORRE:`. Guardian fields are outside the current Phase 1 seven-field mapping and are **not** used to fill learner names.

The screenshot is a display-sized photo with UI overlays. Its original corrected file is not available in the workspace. It was **not** rerun as if it were the camera source. Exact-photo before/after field accuracy remains unmeasured. Empty address/parent/PSA fields and checkbox groups are not scored as missing learner values; they are outside the current mapping. Page 2 remains evidence only.

## Changes

`recognizePage` now sends the corrected private file URI, field ID, part index, exact pixel rectangle and registered cell count directly to native `FieldRoiOcr`. `BitmapRegionDecoder` reads that region at sample size 1. The Expo JPEG crop/128-pixel resize and subsequent native reduction are removed from this path. Field element boxes are mapped directly from crop pixels back to their parent document coordinates.

The existing OpenCV paper detection/perspective correction remains the source of the document coordinate system. No view capture, green rectangle, preview bitmap or full-page text search supplies a field value. Page 1 field reading no longer depends on successful whole-page label recognition. Unknown layouts retain an explicit alignment warning. Whole-page reading remains supplemental and is labeled **whole-page reference text (unstructured)**. A validated, readable ROI can support review even if supplemental OCR fails; missing/noise-only results remain blocked.

The scanner retains its original raw camera file while reviewing. Its working image is still bounded to 3,200 pixels on the long edge / eight megapixels, and corrected output to 3,000 pixels on the long edge, to preserve the earlier memory-failure recovery. Thus the ROI is full resolution **within the corrected document**, not necessarily the sensor's full resolution. No extra field downscaling occurs; small crops are only enlarged and padded. Higher-resolution capture does not automatically mean higher OCR accuracy.

Grid removal searches only near the registered character-cell boundaries and removes long rules with a narrow bounded mask. It does not erase arbitrary tall glyph columns. Numeric date parts use a thinner mask. Occupied-cell measurements and removed-ink fractions are retained for inspection. Character-cell segmentation was considered: isolated-letter recognition can lose word context and word spacing, so it is not the production recognizer. Registered cells instead constrain rule removal and name spacing. Original and cleaned row images are both passed to the same bundled ML Kit engine.

No `O`/`0`, `B`/`8`, pipe/digit replacements, name dictionary or fixture-derived corrections occur. Both raw readings, normalized alternatives, actual mean element confidences and preprocessing measurements are retained with the field ID and image ID. Matching normalized readings become proposals. When only one actual model reading passes the field format, it is an explicitly **uncertain proposal** with a preprocessing review warning. Different valid alternatives, two invalid disagreeing alternatives or a failed read leave the proposal blank. Every field still needs human confirmation before readiness. Format validity is not identity certainty.

LRN remains an optional string of exactly 12 digits, including leading zeros. Dates must have the expected month/day/year structure and a real calendar date. Consecutive school years and numeric grades 1-12 remain required. Names reject digits, grid pipes and unexpected symbols while preserving Unicode letters, accents, spaces, apostrophes, periods and hyphens. Missing optional fields remain blank.

## Same-image comparison

The offline Android test uses bundled ML Kit Latin 16.0.1 on two immutable copies of the same fictional printed enrollment page:

- Earlier upright baseline: `ocr-baseline-clean-page-1.png`, SHA-256 `084192eca588e7be362c096a1923ab619d2a9dd3d05d54becd1a88b64d44a7ac`.
- Snapshot of the user's currently modified local clean fixture: `roi-user-clean-page-1.png`, SHA-256 `b8cdf353ce9ad2c9996473fa1bdbdc145601f3f17cfa01b3927ab308adbdc016`. It is rotated 90 degrees clockwise for reading. The original fixture files were preserved.

Each run reads exactly the same ten pixel regions using the original crop, the previous v2 algorithm, and the new processed crop. Expected values come from the unchanged `fixtures/expected/clean.json`. Native results are replayed through the actual application normalization and selection code by `node scripts/summarize-roi.cjs`.

Final proposed values on **each** copy:

- `school_year`: expected `2024-2025`; extracted `2024-2025`; correct, preprocessing review required.
- `grade_level`: expected `7`; extracted `7`; correct.
- `lrn`: expected `001234567890`; extracted `001234567890`; correct, preprocessing review required.
- `learner_last_name`: expected `RIVERA`; extracted `RIVERA`; correct, preprocessing review required.
- `learner_first_name`: expected `ELENA`; extracted `ELENA`; correct, preprocessing review required.
- `learner_middle_name`: expected `SANTOS`; extracted `SANTOS`; correct, preprocessing review required.
- `birth_date`: expected `02/29/2012`; extracted ISO value `2012-02-29`, displayed `02/29/2012`; correct, preprocessing review required.

Final: **7/7 correct, 0 missing, 0 incorrect per copy**. These are two versions of one form, not 14 independent documents. The previous v2 native results also recover the seven values on these digital inputs after box-spacing normalization. This is a regression comparison, **not evidence of improved physical-camera accuracy**.

Original boxed crops contain rule characters and misread letters/digits; cleaned crops remove those distractions. During development, a larger 96-pixel preparation and a narrower LRN mask misrecognized a zero; a wider date mask duplicated a digit in the birth year. Those trials were rejected against the unchanged ground truth. The final field profiles are fixture-tested; glare, blur, handwriting, other fonts, imperfect alignment and the physical A53 remain unverified. Validation cannot recover an omitted character.

Evidence:

- [Native raw comparisons, coordinates and confidence](evidence/roi-comparison.json).
- [Actual application proposals versus expected values](evidence/roi-field-results.json).
- [Original and processed field/input images](evidence/roi-crops/).
- [19 passing offline native tests](evidence/roi-native-tests.xml), including the prior capture/crop/recovery regressions and two ROI tests.
- [118 passing host tests](evidence/release-0.2.2-tests.json). Six release-version guard tests also pass; TypeScript checks pass.

ML Kit remains the baseline. The bundled artifact is available immediately offline; its [Android guidance](https://developers.google.com/ml-kit/vision/text-recognition/v2/android) recommends sufficient character detail and notes that excessive character resolution does not necessarily help. Confidence shown here is the actual available [element confidence](https://developers.google.com/android/reference/com/google/mlkit/vision/text/Text.Element), averaged within a crop; it is not a fabricated field/document probability. PaddleOCR has not been added or justified by a same-photo engine comparison.

## Development diagnostic view and device checks

Both phone APKs are version **0.2.2 / code 8**, package `ph.tala.scanner.pilot`, signed with the existing pilot certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Version/source guards, signatures, bundled JavaScript/reference pages, bundled Latin OCR, native ROI and OpenCV checks pass.

- Release: `output/android/TALA-Phase1-0.2.2.apk`; SHA-256 `daba01ba1ee9f90a5eec31c5f9c812d51baa3e9ab2e6585424106dc1834214b0`.
- Development diagnostics: `output/android/TALA-Phase1-0.2.2-diagnostics.apk`; SHA-256 `1e283799270281bf1163a6932a4419fa39bf3c3ee025dc0573a6e140f58f73c6`.

See [release build evidence](evidence/build-result.json) and [diagnostics build evidence](evidence/diagnostics-build-result.json). Both embed offline assets; physical phone checks remain separate.

An emulator-native x86_64 test build cold-launches with airplane mode enabled and Wi-Fi disabled. The existing fictional draft survives the upgrade. Saved-page diagnostic recognition completes offline, and the view renders original/processed inputs, coordinates, raw results and unavailable-confidence messages. This UI check uses an older geometry-test page with black landmarks, not the enrollment accuracy fixture. The ARM phone APK's translation launch on the x86 emulator encountered a React Native library-selection failure; it is not counted as phone acceptance. See [UI smoke evidence](evidence/diagnostics-ui-smoke.json) and [release/development gating evidence](evidence/diagnostics-gate.json).

The diagnostics APK uses native `BuildConfig.DEBUG` to expose the diagnostic view and permit temporary crop PNGs. The release variant disables both. Both variants embed their JavaScript and bundled OCR model for offline use. Diagnostic image URIs stay in review state and are deleted on retry/close; they are not persisted in draft history or synchronized. Raw field text and measurements remain local history, separate from edited values.

On the diagnostics build, scan page 1 and open **Development: OCR diagnostics**. For an existing aligned page, open the draft, choose **Development: inspect saved-page OCR**, then open its diagnostics. That inspection leaves saved values/history unchanged. Inspect the clean source, exact pixel/normalized coordinates, original and cleaned crops, actual padded OCR inputs, both raw/normalized readings, confidences and review/validation messages. Release builds retain normal field review and **View area read**.

Required remaining A53 test: update in place, enable airplane mode with Wi-Fi off, scan the same printed clean page using manual and automatic capture, compare all seven fields with the values above, inspect the original diagnostic inputs for overlays or clipping, confirm corrections, restart and verify saved images/history/confirmations. Repeat optional blanks and invalid-required forms, retake a page and verify confirmation reset, and verify a covered camera is rejected. Do not uninstall or clear storage to upgrade. Exact phone-photo accuracy and diagnostic UI operation on the physical phone are pending.

Existing verification, atomic SQLite/image persistence, historical image/field linkage, explicit replacement choices and the future-sync boundary remain intact. No server, synchronization implementation or Phase 2 work is introduced by this correction.
