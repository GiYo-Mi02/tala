# T.A.L.A. Mobile Application: Intelligent Document Scanner Implementation

## Role and Objective

Act as a Senior Android Developer, Computer Vision Engineer, and Mobile Application Architect.

Your task is to improve the existing T.A.L.A. (Text Acquisition and Local Automation) mobile application by replacing the current document scanning experience with an intelligent, automated document scanner.

**Technology requirements:**
- **CameraX:** Camera preview, image analysis, camera controls, and high-resolution image capture.
- **OpenCV:** Document boundary detection, automatic cropping, image correction, and perspective transformation.
- **Google ML Kit Text Recognition:** On-device OCR and text extraction.
- **Existing Application Architecture:** Preserve the current project structure, navigation, document verification, local storage, and synchronization workflows.

The primary problem is that users currently need to manually adjust four document corners after scanning. This process is inconvenient, time-consuming, and unnecessary when document boundaries can be detected automatically.

**Primary objective:** Users should be able to point their camera at a government document and have the application automatically detect, capture, straighten, crop, and process it without manually adjusting its corners.

Manual adjustment must become an optional fallback, not a required step.

---

## PHASE 1: Existing Project Inspection

Before modifying any code:

1. Inspect the complete mobile application architecture.
2. Identify the current document scanner implementation and its entry points.
3. Locate all dependencies related to Google ML Kit Document Scanner, OCR, camera access, and image processing.
4. Identify the current document image handling, extracted text storage, verification screens, and API integrations.
5. Determine whether the application uses native Android, React Native, or another framework.
6. Identify the minimum supported Android version and existing Gradle dependency constraints.

**Important:**
- Do not immediately rewrite the application.
- Reuse existing components whenever practical.
- If the application uses React Native, implement the Android-specific scanner natively and integrate it through an appropriate native module.
- Preserve existing data contracts and downstream OCR workflows.
- Avoid introducing unnecessary dependencies.
- Consult current official dependency documentation before selecting compatible library versions.

Provide a short technical assessment before implementing the changes.

---

## PHASE 2: CameraX Integration

Implement a dedicated camera experience using CameraX.

Required components:

- PreviewView for live camera preview.
- ImageAnalysis for real-time computer vision processing.
- ImageCapture for high-resolution document capture.
- Camera lifecycle management.
- Automatic focus and exposure handling.
- Flashlight control.
- Camera permission handling.

### Expected behavior

When the scanner opens:

1. Automatically initialize the camera.
2. Display the live camera preview.
3. Continuously analyze frames for document boundaries.
4. Display an overlay around the detected document.
5. Detect when the document is adequately positioned and stable.
6. Automatically capture the image once quality requirements are satisfied.

Allow manual capture as a fallback.

Do not require users to align a document perfectly with a static rectangular guide.

The camera should recognize a document even when it appears slightly rotated, tilted, or viewed from an angle.

---

## PHASE 3: OpenCV Document Detection

Implement automatic document boundary detection using OpenCV.

### Required image processing pipeline

1. Receive camera frames from CameraX.
2. Convert frames into the appropriate OpenCV image format.
3. Correct frame orientation.
4. Convert the image to grayscale.
5. Apply suitable noise reduction.
6. Apply edge detection, such as Canny.
7. Detect and analyze contours.
8. Identify candidate document boundaries.
9. Approximate suitable contours into quadrilaterals.
10. Select the most likely document boundary.
11. Return the four detected corner coordinates.

### Document selection criteria

Evaluate candidates using:

- Contour area relative to the camera frame.
- Four-corner geometry.
- Convexity.
- Edge strength.
- Corner angles.
- Boundary completeness.
- Document positioning.
- Suitable aspect-ratio tolerances.

Do not assume every document uses A4 dimensions. Support common government form sizes and orientations.

Prevent incorrectly identifying unrelated rectangular objects as documents whenever possible.

### Real-time visual overlay

Display a polygon around the detected document.

The overlay should:

- Follow the actual document boundaries.
- Update smoothly as the camera moves.
- Avoid excessive flickering.
- Indicate whether the document is ready to capture.

Suggested visual statuses:

- **Searching:** No reliable document detected.
- **Adjust Position:** Document partially visible or unsuitable.
- **Hold Steady:** Document detected but moving.
- **Ready:** Document is properly detected.
- **Capturing:** Automatic capture is underway.

Keep the interface simple and accessible.

---

## PHASE 4: Automatic Capture System

Implement intelligent automatic capture.

### Capture conditions

Trigger automatic capture only when:

1. A valid document quadrilateral has been detected.
2. All four document corners are visible.
3. The detected document occupies a reasonable portion of the camera frame.
4. The document remains relatively stable for approximately 800–1,200 milliseconds.
5. The image meets minimum sharpness requirements.
6. Lighting conditions are acceptable.
7. The scanner is not already processing another capture.

Use configurable thresholds rather than hardcoded assumptions.

### Stability detection

Compare detected document corners across consecutive camera frames.

If the document moves beyond the configured tolerance, restart the stability timer.

Avoid unnecessary repeated captures.

### Quality checks

Implement practical checks for:

- Excessive blur.
- Poor lighting.
- Strong glare when detectable.
- Incomplete document boundaries.
- Excessive perspective distortion.

Do not reject otherwise readable documents because of overly strict thresholds.

When auto-capture cannot succeed, allow the user to capture manually.

---

## PHASE 5: Automatic Cropping and Perspective Correction

After capturing the image:

1. Use the original high-resolution photograph.
2. Re-detect or accurately map the four document corners to the captured image.
3. Correct image orientation and coordinate transformations.
4. Calculate the perspective transformation.
5. Apply OpenCV perspective correction using getPerspectiveTransform and warpPerspective.
6. Crop away unnecessary background.
7. Produce a rectangular, correctly oriented document image.
8. Preserve text readability and sufficient resolution for OCR.

The resulting document should appear similar to a properly scanned paper form, even if the original photograph was taken at a slight angle.

### Important behavior

**Do not automatically open the four-corner adjustment interface after capturing.**

If document boundaries are confidently detected, perform cropping and perspective correction automatically.

If detection confidence is insufficient:

- Allow the user to retake the image.
- Offer optional manual corner adjustment.
- Avoid silently applying an unreliable crop.

Preserve the original captured image until successful processing and user confirmation.

Do not stretch, truncate, or remove meaningful parts of the document.

---

## PHASE 6: Google ML Kit Offline OCR Integration

After perspective correction, automatically submit the processed image to Google ML Kit Text Recognition.

### OCR requirements

1. Use on-device text recognition.
2. Prefer bundled text recognition models that are available immediately after installation.
3. Do not depend on an internet connection to perform OCR.
4. Preserve existing extracted text processing and verification logic.
5. Support multi-line document text.
6. Preserve text blocks, lines, and bounding-box information when useful.
7. Properly handle OCR failures, empty results, and unreadable documents.
8. Do not overwrite a user's previously verified data with new OCR results without confirmation.

### Processing pipeline

CameraX Capture → OpenCV Boundary Detection → Automatic Cropping → Perspective Correction → Image Enhancement → ML Kit OCR → Extracted Data Review.

OCR must process the corrected document image rather than relying on the uncorrected camera photograph.

Use image enhancement conservatively. Excessive contrast, sharpening, or thresholding must not reduce recognition accuracy.

The application should preserve the document image and OCR results for the existing verification workflow.

---

## PHASE 7: User Interface and Experience

Redesign the scanner flow to minimize unnecessary interaction.

### Camera Screen

Display:

- Full-screen camera preview.
- Dynamic document boundary overlay.
- Small scanner status indicator.
- Automatic capture enabled by default.
- Manual capture button.
- Flashlight toggle.
- Back button.

Avoid excessive buttons and instructions.

### Processing Screen

After capture, show a brief processing state while the application:

- Corrects document perspective.
- Crops the document.
- Enhances image readability.
- Performs OCR.

Prevent duplicate processing requests.

### Document Review Screen

Display the automatically processed document with three primary actions:

**Continue**
Accept the scan and proceed to extracted data verification.

**Retake**
Return to the camera and capture another image.

**Adjust Crop**
Optionally adjust the four document corners when the automated crop is incorrect.

The manual adjustment option should not interrupt the normal scanning process.

### OCR Verification

Preserve the existing verification interface.

Users should be able to inspect extracted values and correct recognition errors before the information is saved or synchronized.

Do not automatically submit unverified OCR data to the backend.

---

## PHASE 8: Offline Architecture and Performance

T.A.L.A. must support offline document scanning and OCR.

Ensure that:

- CameraX works without internet access.
- OpenCV processing works entirely on-device.
- ML Kit OCR uses an appropriately bundled model.
- Image processing does not require an external API.
- Documents and OCR results can be stored locally.
- Existing online synchronization remains separate from scanning.
- Verification can proceed offline where supported by the current application.
- Pending records follow the existing synchronization workflow when connectivity is restored.

### Performance requirements

- Run computer vision processing outside the main UI thread.
- Use CameraX ImageAnalysis with KEEP_ONLY_LATEST backpressure where appropriate.
- Close every ImageProxy correctly.
- Use reduced-resolution frames for real-time boundary detection.
- Use the original high-resolution image for final image correction.
- Avoid excessive image allocations and memory leaks.
- Release camera and OpenCV resources when the scanner closes.
- Prevent overlapping OCR operations and duplicate scan submissions.
- Handle activity lifecycle changes and camera interruptions.

Maintain smooth camera previews on typical mid-range Android devices.

---

## PHASE 9: Compatibility and Regression Protection

The new scanner must integrate with the existing T.A.L.A. workflow.

Do not break:

- User authentication.
- Existing navigation.
- Document selection.
- OCR extraction.
- Document verification.
- Local persistence.
- Pending synchronization.
- Existing API endpoints.
- Backend data models.
- PostgreSQL synchronization through the existing backend.

Replace only the functionality necessary to deliver the improved scanning experience.

If an existing Google ML Kit Document Scanner implementation becomes unnecessary, remove or isolate it safely after confirming the replacement works.

Do not delete unrelated functionality or reset existing user data.

---

## PHASE 10: Testing and Acceptance Criteria

Implement and execute tests wherever possible.

### Functional acceptance criteria

- [ ] The camera opens successfully.
- [ ] A document is detected automatically.
- [ ] Four corners are identified without user interaction.
- [ ] The boundary overlay correctly follows the document.
- [ ] A stable document triggers automatic capture.
- [ ] Manual capture remains available.
- [ ] Cropping happens automatically.
- [ ] Perspective correction straightens tilted documents.
- [ ] Users are not forced to adjust four corners.
- [ ] Manual adjustment remains available when necessary.
- [ ] The processed image is submitted to ML Kit OCR.
- [ ] Text extraction completes without internet access.
- [ ] Users can review and correct OCR results.
- [ ] Existing offline storage remains functional.
- [ ] Existing synchronization behavior remains functional.
- [ ] Camera resources are correctly released.
- [ ] No duplicate captures or OCR requests occur.

### Image detection scenarios

Test against:

1. A document placed flat on a desk.
2. A document tilted clockwise.
3. A document tilted counterclockwise.
4. A document photographed from an angle.
5. A document with a cluttered background.
6. A document under uneven lighting.
7. A document with light shadows.
8. A document with no clear background contrast.
9. A partially visible document.
10. A blurry or moving document.
11. A document containing small printed text.
12. A document with tables and multiple fields.

Create automated tests for image processing with representative test images wherever feasible.

Clearly distinguish automated test results from scenarios that require manual camera testing on physical Android devices.

---

## PHASE 11: Final Deliverables

Implement the functionality directly in the existing project.

At completion, provide:

### 1. Implementation Summary

Explain which components were changed, created, removed, or replaced.

### 2. Technical Architecture

Describe how CameraX, OpenCV, and ML Kit OCR communicate with each other.

### 3. Changed Files

Provide a list of modified files and their purposes.

### 4. Dependency Changes

Document added, updated, and removed dependencies.

### 5. Testing Results

Report each acceptance criterion as:

- **PASS:** Implemented and verified.
- **PARTIAL:** Implemented but not fully verified.
- **FAIL:** Tested and found not working.
- **NOT TESTED:** Verification was not possible.

Include relevant build, unit test, and runtime evidence.

### 6. Remaining Issues

Identify unresolved limitations or manual tests required.

### 7. Build Verification

Run the available project build and relevant automated tests. Do not claim that device-level auto-capture, OCR accuracy, or camera behavior passed unless those behaviors were actually verified.

---

## CRITICAL IMPLEMENTATION INSTRUCTIONS

1. Do not provide pseudocode as the final implementation.
2. Implement production-oriented, maintainable code.
3. Inspect existing code before making architectural decisions.
4. Preserve all unrelated working features.
5. Use real OpenCV document detection rather than a static decorative rectangle.
6. Ensure detected overlay coordinates accurately correspond to camera image coordinates.
7. Never force manual corner adjustment when reliable automatic cropping succeeds.
8. Ensure document scanning and OCR can function offline.
9. Implement graceful fallbacks rather than crashing.
10. Do not modify backend contracts unless absolutely necessary and documented.
11. Do not fabricate successful test results.
12. Avoid implementing unrelated application features.

## Expected Final Result

A T.A.L.A. user opens the scanner, points the camera toward a government form, and holds the phone steady.

The application automatically identifies the document boundaries, captures the photograph, corrects its perspective, crops unnecessary background, and performs offline OCR.

The user reviews the processed document and extracted information before continuing to the existing verification and synchronization workflow.

**The four-corner manual adjustment process must no longer be required during normal successful document scanning.**

Proceed with project inspection, implementation, integration, and testing using the existing codebase.
