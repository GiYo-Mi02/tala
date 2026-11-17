# Intelligent scanner acceptance - 0.2.0 / code 6

Current update: **0.2.1 / code 7**. The user subsequently reported failures on both capture paths; see [processing recovery and retest status](scanner-recovery-fix.md). The 0.2.0 emulator evidence below is historical and does not close that phone failure.

The following statuses describe the specified verification scope. An emulator pass is not a Samsung Galaxy A53 5G pass. Physical Android version/build are not recorded yet. Machine-readable results and APK identity are in [release validation](evidence/release-0.2.0-validation.json).

## Functional criteria

1. **PASS - Camera opens successfully on the emulator.** CameraX reached a running preview and the screen opened/reopened twice. Physical camera: NOT TESTED.
2. **PASS - Automatic document detection in native image tests.** Actual OpenCV identified exterior paper in flat, clockwise, counterclockwise, perspective, clutter, shadow and uneven-light cases. Live phone detection: NOT TESTED.
3. **PASS - Four corners without user input in native tests.** Detected corners match known geometry; the BEEF end-to-end test supplies no crop corners.
4. **PARTIAL - Overlay follows the document.** The native overlay uses the shared CameraX ViewPort and coordinate transform; inverse rotation checks cover 0/90/180/270 degrees. Visual live tracking on the A53: NOT TESTED.
5. **PARTIAL - Stable document triggers automatic capture.** Sustained-quality timing, movement/drift resets, frame loss, and the capture latch pass. Automatic shutter on a real document/camera: NOT TESTED.
6. **PASS - Manual capture remains available on the emulator.** The native UI button takes a CameraX photograph and returns its staged private image metadata. Physical capture: NOT TESTED.
7. **PASS - Automatic cropping in native tests.** High-resolution re-detection produces a corrected candidate without opening a corner editor. Unreliable boundaries return a fallback.
8. **PASS - Perspective correction in native tests.** OpenCV preserves tilted content landmarks and landscape proportions. Actual phone photographs: NOT TESTED.
9. **PARTIAL - Corner adjustment is not required on the normal path.** The integrated success path runs OCR and shows review directly; no automatic navigation to Crop remains. Physical React/native flow: NOT TESTED.
10. **PARTIAL - Optional manual adjustment remains.** Adjust Crop uses the original source; native warp and TypeScript checks pass. Touch adjustment/retake on the A53: NOT TESTED.
11. **PASS - Corrected image reaches ML Kit in native tests.** The automatic BEEF detection/warp output is recognized and compared with unchanged field labels.
12. **PASS - Text extraction works offline on the emulator.** Airplane mode enabled and Wi-Fi disabled; 35 field comparisons pass, including seven from the new automatically cropped page. Full-page OCR retains multiple text blocks/lines.
13. **PARTIAL - Users review/correct OCR.** Existing editable validation/confirmation flows are retained; replacement requires a choice when values exist. Host tests pass. Installed-app editing acceptance: NOT TESTED.
14. **PARTIAL - Offline storage remains functional.** Host fault injection and serialization cover UUIDs, image replacement, raw history and new multiline block data. Real SQLite force-stop/reopen: NOT TESTED.
15. **NOT TESTED - Existing synchronization behavior.** This checkout has no active synchronization, authentication service or backend. Local future-sync readiness is retained; no endpoints/contracts were changed.
16. **PASS - Camera resource release/reopen on the emulator.** Activity lifecycle close/reopen passes; analyzers close every ImageProxy in finally and native Mats are released. Long-running hardware/memory profiling: NOT TESTED.
17. **PARTIAL - No duplicate captures or OCR requests.** Native capture uses an atomic guard, stability latches once, and React/manual operations are guarded and serialized. Integrated simultaneous-trigger stress on the A53: NOT TESTED.

## Image scenarios

- **PASS (native synthetic images):** flat paper; clockwise and counterclockwise rotation; angled perspective; simple clutter; uneven illumination; light shadows; small printed BEEF text; tables/multiple fields.
- **PASS (safe fallback):** partial paper, white/low-contrast background and blurred imagery do not satisfy automatic capture requirements. These results do not promise successful detection on white paper against every white surface.
- **PASS (state tests):** document movement, slow drift, missing frames, poor sharpness/brightness and detected glare reset or prevent readiness.
- **NOT TESTED (physical):** all twelve requested image scenarios on the A53, including real specular glare, hand motion and mixed backgrounds. Test every scenario in the phone instructions.

## Evidence

- 115 host tests across eight files: [host report](evidence/release-0.2.0-tests.json).
- 13 native checks, zero failures/skips, Android 16 x86_64 virtual camera: [native report](evidence/release-0.2.0-native-tests.json), [JUnit XML](evidence/release-0.2.0-native-tests.xml).
- TypeScript and six release-version guard tests: [release validation](evidence/release-0.2.0-validation.json).
- APK build, identity, source fingerprint, original signing certificate and bundled components: [build](evidence/build-result.json), [contents](evidence/apk-inspection.json), [metadata](evidence/apk-badging.txt), [signature](evidence/apk-signature.txt).

P1-02/P1-03 retain the user's previous failure report until this APK is retested. P1-01/P1-04/P1-05 still need physical acceptance. P1-06 host checks pass. Do not start the capstone's backend Phase 2 yet.
