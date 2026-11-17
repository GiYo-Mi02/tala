# SSS E-1 fixed-template implementation

This is the requested pre-sync extension of the mobile scanner. It implements SSS E-1 first. PhilHealth and Pag-IBIG remain queued, and the API, web connection and synchronization have not started.

## Source and coverage

The exact supplied `E1-Personal-Record.pdf` is retained as `references/sss-e1-cov01214-09-2015.pdf`. The registered template is `sss-e1-cov01214-09-2015`, version 1, revision **COV-01214 (09-2015)**. Its source SHA-256 is in [source evidence](evidence/sss/source.json). This implementation follows this fixed layout; it does not claim to be the latest SSS form or an official electronic filing service.

The PDF has three pages:

- Source page 1: main personal record; required image evidence.
- Source page 2: instructions and documentary reminders; bundled, zoomable offline reference. It is not treated as an input page to photograph or OCR.
- Source page 3: additional dependent/beneficiary sheet; required only when the user selects Yes for the additional-sheet checkbox. Its printed fixture is the second sheet in the two-page test PDFs, but its template page ID remains 3.

All **136 registrant-side fields and review controls** are implemented: **127 typed OCR regions and nine manual/visual controls**. These cover registrant details, address/contact fields, father, mother's maiden name, spouse, all five main child rows, both main other-beneficiary rows, the applicable employment section, certification, the additional registrant header, all five additional child rows, both additional beneficiary rows and additional certification.

Checkboxes are explicitly entered by a person after inspecting the paper. Certification, signatures, spouse consent and fingerprints remain visual evidence; the app does not recognize handwriting, authenticate a signature, compare biometrics or infer a checkbox. SSS-only processing fields are excluded from editable extraction. Employment applicability is a local review choice, not a claim of eligibility. Required markers are T.A.L.A. local review checks rather than a representation of SSS filing rules. The original printed instructions remain visible.

Mapping images: [main record](evidence/sss/mapping-page-1.png), [additional sheet](evidence/sss/mapping-page-3.png). Manual evidence regions are shown in the app for inspection but are never sent to OCR.

## Mobile behavior and preservation

The home screen has separate BEEF and SSS entries. Existing BEEF drafts, field keys, storage paths, verification screens and OCR history remain usable. SSS uses its own versioned draft model and SQLite table `fixed_form_drafts`, with private images under `tala-fixed-forms/`. It shares the local fictional profile, not a server account. No old BEEF draft is relabeled or migrated into an SSS record.

SSS drafts support offline creation, page capture/retake, optional corner/orientation recovery, source-area and full-page zoom, collapsible review sections, manual correction, explicit field confirmation, optional-blank confirmation, saving unfinished work and local readiness. A saved page and its raw extraction commit together. A failed write removes only the newly staged image; the previous page remains intact. Retaking a page resets that page's confirmations. Replaced-image OCR history remains identified by its original image ID rather than being presented as current-image evidence.

The additional sheet is conditional; populated dependent rows must be completed or explicitly cleared. Applicant names and assigned SS numbers are compared across sheets without copying values into empty fields. Unsupported template versions are refused for editing while their saved data is retained. Readiness requires applicable source images, valid active fields, and explicit confirmation of every active field, including manual choices and optional blanks. Ready locally is not government approval or submission.

## OCR and uncertainty

The existing CameraX/OpenCV pipeline provides the corrected document. Registered regions are decoded from that file at sample size 1. Preview pixels, React overlays and full-page label searches never supply field values. Use the supplied US Letter layout (612 × 792 points), preserve its complete page boundaries and check the highlighted answer regions. Scaling a Letter form onto another paper size with extra margins can invalidate fixed coordinates.

Unboxed fields retain their character strokes. For E-1 grids, cleanup measures registered single/double-width separators and preserves an original comparison reading. Numeric identifier groups receive an additional ML Kit reading when the row output has an unexpected length; every grouped input and its raw result can be inspected in the diagnostics build. This does not guarantee that a missed digit is recovered. No expected fixture value, name dictionary, missing digit, `O`/`0` or `I`/`1` substitution fills a field.

Actual original, processed and any grouped readings, normalized alternatives, field IDs, page/image IDs, warnings and supported confidence are retained. Different valid alternatives stay unresolved. A sole format-valid model candidate is marked uncertain when it differs from another reading. Low confidence is flagged. A valid-looking misspelling can still pass format validation; every field therefore needs comparison with the image. Required names and dates, assigned identifier lengths/leading zeros, actual calendar dates, contact formats, years, amounts and populated-row completeness are checked.

The development diagnostics view is read-only and native-debug gated. It shows the clean source, pixel coordinates, original/processed/grouped input images, raw and normalized alternatives, confidence and validation/review warnings. Temporary diagnostic files are not saved into draft history or uploaded and are cleaned when their owning view/page is left or replaced. Release builds hide these controls.

## Measured results on unchanged fictional fixtures

Five cases exercise the clean main sheet, the additional children, other beneficiaries, non-working-spouse details, and invalid/missing required values. They contain seven page images and **503 mapped-field comparisons**. Expected labels remain separate from app code. The fixture image hashes match the initial baseline after mapping/preprocessing changes; the test images were not regenerated to improve the score.

The fictional print forms leave checkbox marks and signatures to the test operator. Before a physical camera test, mark applicable boxes using that case's `fixtures/sss/sss-<case>.json` scenario, then enter the corresponding manual choices in the app. Manual choices are not included in the OCR score, and the app does not infer them from the typed fields.

Final results on the digital fixtures:

- Clean: 81/83 total exact, including 35/37 populated values and 46/46 optional blanks; one unresolved TIN and one incorrect mother first name.
- Additional sheet case: 122/127 total exact; four unresolved values and one incorrect name.
- Other beneficiaries case: 124/127 total exact; three unresolved values.
- Non-working spouse case: 80/83 total exact; two unresolved values and one incorrect name.
- Invalid-input case: 80/83 total exact; two withheld values and one incorrect name. Invalid required input is still blocked from readiness.

Overall: **487/503 exact (96.8%)**, comprising **222/238 populated values** and **265/265 correct blanks**. There are **12 withheld/missing proposals and four incorrect proposals**. The initial baseline was 469/503 on the same images. This is a comparison over repeated fields in five synthetic cases of one layout, not five independent real documents or proof of physical-camera accuracy.

Known residuals include the boxed TIN, several dependent birthdates, a working-spouse identifier and `CORAZON` read as `CORAZZON`. The latter is flagged for low recognition confidence. The app retains the actual reading rather than inventing the intended name. The invalid February 30 fixture can be withheld by the conservative policy; the raw recognition and calendar error remain available. Review the complete [field-by-field actual/expected results](evidence/sss/field-results.json), [initial baseline](evidence/sss/baseline-field-results.json), [native readings](evidence/sss/native-comparison.json) and [sample actual OCR inputs](evidence/sss/sss-inputs/).

ML Kit remains the bundled offline baseline. PaddleOCR has not been introduced. No claim of physical-device accuracy is made from these digital tests.

## Verification and retest list

- **SSS-01 — Pass:** exact revision/hash, all 136 keys, source bounds, applicant/parent separation, all repeated rows, and exclusion of reference-only/SSS-only areas. [Host evidence](evidence/sss-host-tests.json).
- **SSS-02 — Pass (emulator); Not run (A53):** offline reference pages, zoom and template selection. Physical retest: update in place, enable airplane mode with Wi-Fi off, open all three SSS references without Metro or laptop services.
- **SSS-03 — Not run on A53:** capture the printed main sheet, confirm the regions, exercise auto/manual capture, deny/grant permission, retake independently, and select Yes/No for the optional sheet. Check US Letter printing at actual size and source-page IDs 1/3.
- **SSS-04 — Pass for measured execution, with the OCR mismatches above:** actual bundled native ML Kit comparison against all 503 fixed expected fields. [Final native suite](evidence/sss/native-final-tests.txt) records 20 passing tests, including the earlier BEEF/camera/recovery regressions. An execution pass is not a 100% recognition score.
- **SSS-05 — Pass (host); physical retest pending:** required/optional and row validation, invalid date/SS number, manual choices, different repeated identities, uncertainty preservation and local-readiness checks. Correct and confirm the known residual OCR values against the source; an incomplete draft must remain editable and unready.
- **SSS-06 — Pass (host); emulator UI recovery evidence recorded separately:** image/database failure rollback, metadata/image identity, edited field recovery and no acknowledgment on failed saves. Physical retest: save an edited main+additional pair, force-stop, restart offline, and compare UUID, both image slots, raw history, corrected values and confirmations.
- **SSS-07 — BEEF native regressions pass:** existing BEEF mappings/validation and capture failures remain checked. Upgrade the A53 without uninstalling and verify an existing BEEF draft and its source images.
- **SSS-08 — Pass for scope:** no API, account migration, auto-upload, web integration or active synchronization is added. The existing future-sync boundary remains explicit.

The host suite has 142 passing tests; TypeScript and six Android version-guard tests pass. The [offline emulator UI smoke test](evidence/sss/ui-smoke.json) verifies template selection, instruction zoom, conditional sheet behavior, editing a name with spaces, save/readiness feedback, force-stop recovery and preservation of the prior BEEF draft. This is separate from physical camera acceptance.

Version **0.3.0 / Android code 9** contains this implementation. Final APK package, source fingerprint, signing and bundled-asset evidence is recorded by the build scripts. Install as an update and preserve app storage. The build verifier compares decoded RGBA pixels, allowing Android's lossless RGB-to-grayscale PNG optimization while still checking the original reference images exactly. Its Pillow dependency is pinned in `scripts/requirements-pdf.txt`.

## Built APKs

- Release: `output/android/TALA-Phase1-0.3.0.apk`; SHA-256 `7dd28f3ac9e7932b79238d1da5bd26e178ac3e02807e6f26c8180b6ea3345c16`.
- Development diagnostics: `output/android/TALA-Phase1-0.3.0-diagnostics.apk`; SHA-256 `a4247720cbbdf26e7b6fac810c24cd2772efc0e2adc7232551105fcb6ea6f54f`.

Both are code 9, use the existing pilot signing certificate, match authored source fingerprint `0bacb1852cff49f2ea7b467a12bcab1d304e2df70feb7bf8a62507f241842f94`, and include all five BEEF/SSS reference images plus the offline Latin model. See [release build](evidence/build-result.json), [diagnostic build](evidence/diagnostics-build-result.json) and [variant gating](evidence/diagnostics-gate.json).
