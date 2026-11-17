# Scanner processing recovery - 0.2.1 / code 7

The user reported that both automatic and manual captures repeatedly showed Image processing failed on a physical document, while a covered-camera capture appeared accepted. The A53 was not connected to adb, so its exact underlying exception was not independently retrieved.

## Confirmed defects and changes

- A detected paper narrower than 600 source pixels threw from perspective correction. The caller deleted the candidate and restarted the camera with a generic message. A new native test reproduced this failure before the change. Correction failures now retain the normalized original and return to review with Retake/optional Adjust Crop and a specific code. Decode/capture failures wait for an explicit Retake rather than automatically restarting.
- The React review created a prepared candidate even when OCR failed or returned no text, and Continue did not check readability. Continue and the final acceptance handler now require a reliable crop and at least four recognized letters/digits. Empty/noise-only/missing OCR cannot be saved as a successful scan. Retry reading is available for a corrected image whose OCR failed.
- Covered, uniformly blank and dark rectangular false detections now undergo content checks before detection and after cropping. Rejected frames have no processed candidate, cannot Continue, and do not offer manual crop as a way around an empty/covered image.
- Working JPEG decoding is bounded to a 3,200-pixel long edge and eight million pixels, uses software ARGB/sRGB, and retains the original high-resolution capture file. This reduces processing allocations; it does not establish that memory caused the phone's failure. A 3024 x 4032 regression checks correction, bounded working dimensions and preservation of the original.
- CameraX is allowed to select higher-resolution still sizes where supported. See [ResolutionSelector](https://developer.android.com/reference/androidx/camera/core/resolutionselector/ResolutionSelector). Decode-time sizing uses Android's [BitmapFactory density/sample options](https://developer.android.com/reference/android/graphics/BitmapFactory.Options).
- Failure codes identify dark/empty input, uncertain boundaries, insufficient crop resolution, processing stage, memory, storage or decode failures. Diagnostic logs contain codes, exception classes and image dimensions, not photographs, recognized text or private file paths.

Typical recovery codes: CAPTURE_DARK/CAPTURE_EMPTY require an uncovered lens and a visible printed page; CROP_RESOLUTION requests a closer/higher-resolution capture; CROP_FAILED/DETECTION_FAILED keep the photo for retake or optional adjustment; memory/storage codes give the corresponding phone recovery action. CAPTURE_DECODE indicates a photograph could not be opened and waits for explicit Retake.

## Verification

- Three native regressions failed against the old implementation: [before-fix XML](evidence/recovery-before-fix.xml).
- **116 host tests** across eight files passed, including final acceptance guards for missing, empty and noise-only OCR. TypeScript and all six version-guard tests passed.
- **17 offline native emulator tests** passed, including the new dark/blank/false-rectangle, small-crop recovery and full-resolution checks. Existing CameraX capture/reopen, OpenCV geometry and all 35 OCR fixture comparisons still pass. See [native results](evidence/release-0.2.1-native-tests.json).
- The signed standalone APK, packaged version, original upgrade certificate, embedded references/Latin model/OpenCV and source fingerprint passed verification. See [release validation](evidence/release-0.2.1-validation.json).
- Native instrumentation ran on Android 16 x86_64 with the virtual camera, airplane mode enabled and Wi-Fi off. It does not establish that the Galaxy A53 problem is resolved. The new APK requires a physical retest. No expected OCR values or user data were changed.

## Phone retest

Install `output/android/TALA-Phase1-0.2.1.apk` as an update; keep app data.

1. Cover the lens and press manual Capture. The result must say Scan not accepted, with Continue disabled, and no accepted image/values changed. Auto capture should not fire on a covered lens.
2. Photograph the printed fictional BEEF form using Auto and manual Capture separately. Check the crop, recognized text and reading areas, then Continue only when readable.
3. If correction cannot finish, the original should remain available with a reason/code and optional crop adjustment. The camera must not reopen on its own. If decoding itself fails, its error/Retake screen must remain visible until an explicit action.
4. If either path still fails, report the exact Scan code and any dimensions shown. These distinguish the remaining phone-specific failure; the older generic message did not.

The earlier P1-02/P1-03 phone failures remain open pending this retest. Phase 2 has not started. Existing draft UUIDs, images, corrected values and raw history remain protected by the existing atomic save protocol and explicit replacement choice.
