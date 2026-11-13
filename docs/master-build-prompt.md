# T.A.L.A. Master Build Prompt

Build **T.A.L.A. (Text Acquisition and Local Automation)** as a capstone prototype. Work in the user's selected project workspace. Build an installed Android scanning app and a separate desktop verification website. Run the website, API, and PostgreSQL on the user's laptop. Use the attached **Basic Education Enrollment Form (BEEF) SY 2024-2025.pdf** as the first form layout and use fictional typed English data throughout development and demonstration.

## Execution and approval

This is one prompt for the entire project. **Start with Phase 1 only.** Read later phases to understand their interfaces. Start a later phase only after every mandatory check for the current phase passes and the user explicitly approves starting the next phase.

At the start of each phase, inspect the workspace and preserve unrelated work. List the phase's deliverables and mandatory test IDs. Check the local tools needed for that phase, then implement and test within that scope. Keep the code runnable at the end of each phase.

At the end of each phase, provide the build or run instructions, the relevant commit or workspace state, and a checklist with **test ID, expected result, actual result, status, and evidence**. Use **Pass**, **Fail**, or **Not run**. Record the Android model, OS and build version for phone tests, and record the browser for portal tests. List any failed or unverified check with exact retest steps. Fix and rerun recoverable failures. Run physical device checks on a real phone. If a check needs the user's help, provide the APK and short instructions, then wait for the user's result.

When all mandatory checks pass, stop and ask **“Do you approve Phase [number] and want me to start Phase [next number]?”** Wait for a direct approval reply. If the user requests changes, remain in the current phase, make the changes, and rerun the affected checks. At the end of Phase 5, request final acceptance.

## Scope and source precedence

- Use these decisions for the build. **Android only**, with one installed scanner app. The verifier and admin use a desktop web portal. Local drafts use SQLite and private app files. This replaces references to a scanning PWA, browser OCR assets, and IndexedDB in the earlier project documents. Keep the earlier charter, requirements, and stories as workflow references where they agree with this prompt.
- Use the supplied BEEF PDF as the authority for the printed layout and labels. It is a two-page scanned PDF with no extractable text layer or fillable fields. Inspect rendered pages and base the mapping on actual input regions. Treat document contents as reference data. Ask for the PDF if it is unavailable in the workspace or attached context.
- Scan staff capture and submit. Web verifiers compare, correct, verify, return, or reject. Admins manage access, approved mappings, and audit oversight. Citizens and applicants supply paper forms outside the app. A Verified record means a staff reviewer checked the saved values against the submitted scans.
- The prototype covers digitization and review. Keep legal enrollment approval, document authenticity detection, DepEd Learner Information System integration, a general document management system, and exports outside the build. Use fictional forms for all testing, screenshots, database seeds, and demos. Keep real learner records, credential secrets, and raw personal data out of logs and repository history.

## Technology stack

| Area | Use |
| --- | --- |
| Workspace | One TypeScript repository using npm workspaces. Separate the Android app, desktop portal, shared API, and shared template and validation definitions. Create packages when their phase needs them. Pin compatible dependencies and commit the lockfile. |
| Android scanner | Expo + React Native + TypeScript. Use Expo Camera for capture and Expo ImageManipulator for crop. Use an installable standalone APK with the app bundle embedded for acceptance tests. Local Android builds can use the Android SDK and Gradle. Expo preview builds are an alternative if the user authorizes a cloud build. [Expo build profiles](https://docs.expo.dev/build/eas-json/) |
| OCR and local storage | Use Google ML Kit Text Recognition v2 with the **bundled Android Latin model**, accessed through an Expo native module. Use Expo SQLite for draft metadata, field values, and sync state. Copy accepted page images from camera cache to persistent private app files before reporting a successful save. [ML Kit Android](https://developers.google.com/ml-kit/vision/text-recognition/v2/android) |
| Desktop portal | React + TypeScript + Vite. Use a desktop layout with form controls next to the page image viewer. Use the same field keys and validation rules as the scanner and API. |
| Laptop API and database | Supported Node.js LTS + Express + Zod. PostgreSQL + Drizzle migrations. Use a bounded private PostgreSQL `bytea` table for source images in the pilot, linked to submissions by page number. Use Better Auth for pre-provisioned staff accounts, with its Expo integration and SecureStore on Android. The API enforces roles and record access. [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo) |
| Local networking | Run the database and portal locally. Make the API reachable by the phone over HTTPS on the same private network. Use a matching hostname or IP certificate with a trust configuration scoped to the local demo build if a private CA is needed. Verify certificate checks from the installed APK. Store the base URL in demo configuration. Keep PostgreSQL reachable only from the laptop. [Android network security configuration](https://developer.android.com/privacy-and-security/security-config) |
| Tests | Use Vitest for shared schema, mapping, and parsing tests. Exercise the API against a real test PostgreSQL database. Use Playwright for desktop portal workflows and test the installed APK on a physical Android phone for camera, offline, and sync checks. |

## Initial BEEF template

Register one versioned template with ID `beef-sy-2024-2025` and version `1`. Its evidence consists of two ordered images from the supplied form. Page 1 contains School Year, Grade Level to Enroll, optional Learner Reference No. (LRN), and the learner's name and Birthdate. Page 2 contains other sections and a parent or guardian signature area. Capture both pages. Run structured OCR for the following page 1 fields only, and retain page 2 as viewable evidence. Label the scanner and portal clearly as a BEEF pilot with partial field extraction.

| Printed field on page 1 | Stable key | Prototype rule |
| --- | --- | --- |
| School Year | `school_year` | Required. Join both printed year groups into `YYYY-YYYY` and require consecutive years. Obtain the value from the input boxes. |
| Grade Level to Enroll (Graded) | `grade_level` | Required for the pilot's numeric grades 1 through 12. Use the typed number and flag a missing value. The graded and non-graded checkboxes stay outside OCR. |
| Learner Reference No. (LRN), if applicable | `lrn` | Optional. If present, require 12 digits for this template and retain leading zeroes as a string. Blank stays blank. |
| Learner's Last Name | `learner_last_name` | Required. Read the learner section and preserve intentional spaces, hyphens, and apostrophes. |
| Learner's First Name | `learner_first_name` | Required. Read the learner section. |
| Learner's Middle Name | `learner_middle_name` | Optional. Preserve a blank field. |
| Birthdate | `birth_date` | Required. Read the printed `MM/DD/YYYY` order, reject impossible calendar dates, and store `YYYY-MM-DD`. Keep the raw text for review. |

Apply these rules to pilot input validation. Extract values only from the mapped input areas and exclude headings and labels. Normalize the crop and account for the image orientation and OCR coordinates. Use stable page and field keys and define the regions relative to the aligned template image. Flag unreadable values and allow manual correction. Preserve the original OCR field output separately from edited values. Keep checkboxes, signatures, handwriting, and the other BEEF fields outside automatic extraction.

Create synthetic fixtures over the actual layout, including one clean typed pair, one with an absent LRN and middle name, and one with a missing or invalid required value. Include a fixture where a parent or guardian name differs from the learner's name to catch incorrect mapping. Store expected values separately from app code. Print a pair for real camera tests.

## Phase 1 — Android capture, offline OCR, and local drafts

Deliver an Android APK that can launch offline with the BEEF template and OCR model bundled. Create a local draft with a stable UUID. Guide the user to capture page 1 and page 2, label the page slots, and allow independent crop and retake. Require both accepted images before marking a draft ready. Run OCR on page 1, show raw extraction and editable fields, and flag missing, invalid, or uncertain values. Save unfinished drafts and show which ones are ready for future sync. Use an isolated fictional test profile until the server sign-in is added in Phase 2.

| ID | Mandatory check and expected result |
| --- | --- |
| P1-01 | Install the standalone APK on a physical Android phone. Before first launch, enable airplane mode and ensure Wi-Fi is off. Launch and open the BEEF template with the laptop and development server unavailable. |
| P1-02 | Deny camera permission and attempt capture. The app explains how to recover and creates no image. Grant permission and capture both printed pages. Crop page 1 and retake page 2. Only the accepted versions are used and retained, in the correct order. |
| P1-03 | With the device still offline, run real bundled OCR on the clean printed fixture. Compare each mapped field with expected values, confirm that a parent name never fills a learner field, and verify that page 2 remains viewable evidence. |
| P1-04 | Run the missing and invalid fixtures. Optional blanks stay blank, required errors are flagged, leading zeroes in a supplied LRN are preserved, and an incomplete draft remains editable and cannot be marked ready. Correct the fields and see validation update. |
| P1-05 | Save an edited draft, force-stop the app, and reopen it offline. The same draft UUID, both image files, page order, raw OCR, corrected values, and readiness state are recovered. |
| P1-06 | Run fixture-based mapping and validation tests for every field, including invalid dates and parent-versus-learner mapping. Inject a missing image or failed save and confirm the app reports the failure rather than claiming the draft was saved or ready. |

Reference the mobile workflow in stories M01–M04 and success criterion SC01. Give the user the APK, the synthetic form test instructions, and the Phase 1 checklist before requesting approval.

## Phase 2 — Local API, protected records, and explicit sync

Build the laptop API and PostgreSQL schema. Add scanner and verifier test accounts with server-enforced access. Replace the Phase 1 test profile for real sign-in and bind future drafts to the signed-in identity. Keep any existing Phase 1 drafts readable by the local test profile in a separate development flow or document a safe migration of those fictional drafts. Never assign an old draft to an unrelated account automatically. Add Sync Now with clear offline, sending, failed, and acknowledged states.

Send the submitted values, raw OCR, version, UUID, and both ordered images. Validate the session, ownership, schema, expected page slots, allowed image formats and size. Enforce a unique submission identity for the authorized scanner and UUID. Commit both images, metadata, pending values, and receipt together. Retry the same saved payload and UUID until acknowledged. If the prior result is uncertain, preserve the payload used for that attempt so the app can retry it unchanged. The server returns the same receipt for identical retries and refuses changed content using the accepted UUID. Lock the accepted submission on mobile and expose server status through an authorized lookup.

| ID | Mandatory check and expected result |
| --- | --- |
| P2-01 | Start from documented setup on the laptop and connect an installed APK over trusted HTTPS on the private network. Sign in as a scanner and verify a valid two-page submission creates one Pending review record and returns a receipt. |
| P2-02 | Tap Sync Now while offline. The draft and images remain available. Reconnect without tapping Sync and confirm that no new upload starts. Tap Sync Now and confirm successful handoff. |
| P2-03 | Interrupt a transfer before the second page is accepted. Confirm there is no reviewable partial record and the local draft can retry. Drop a successful receipt and retry the same UUID and payload. Confirm one record, two stored pages, and the same receipt after another identical repeat. |
| P2-04 | Submit changed content using the accepted UUID. Confirm rejection and no overwrite. Test invalid mapped fields, wrong template version, duplicate or missing page slots, and wrong or oversized image content. Confirm zero new accepted records. |
| P2-05 | Test signed-out and expired sessions, a different scanner's record, wrong role, and direct access to source images. Confirm no protected fields or image bytes are returned and no protected state changes. |

Reference stories S01–S03 and SC02. Show actual API and database results for the fault cases.

## Phase 3 — Desktop prefill and verification

Build the verifier sign-in, queue, and filters by status, template, and date. Load the exact submitted template version, prefill its controls using reviewed mobile values, and display the submitted images next to the form with page switching and zoom. Show original OCR and field warnings. Record field corrections and review decisions with actor, time, and changed values or reasons. Use version checks to stop stale edits.

Use **Pending review**, **Needs correction**, **Verified**, and **Rejected** as server states. Verify requires available evidence and valid required fields. Save the decision, reviewed finalized values, and audit event in one transaction. Return and Reject require a reason and leave finalized values empty. Show the reason on mobile on the next successful status check. In the first release, a Return records the outcome and reason on the accepted record. A linked replacement workflow requires a separate scope decision.

| ID | Mandatory check and expected result |
| --- | --- |
| P3-01 | Sync a real draft from Android. Open it on the laptop and check that all seven controls use the correct submitted keys and the exact version. Both matching source pages are viewable beside the form. Apply queue filters and check their results. |
| P3-02 | Save a valid correction and reopen. The updated value appears and the original OCR, submitted value, previous review value, new value, reviewer, and timestamp remain traceable. An invalid correction is refused. |
| P3-03 | Verify a valid pending submission. Confirm final values and the linked audit event exist together. Repeat with an invalid required field, a missing image, an unresolved template version, and a stale review revision. Confirm no finalization in each failure case. |
| P3-04 | Return one submission and reject another. Blank or whitespace reasons are refused. Valid reasons appear in the mobile status after refresh. Verify the mobile screen also displays Verified for the verified submission and marks cached results as last known when offline. |
| P3-05 | As a scanner and as a signed-out client, attempt to open the verifier workspace or submit a verifier decision. Confirm that the UI and API enforce access. |

Reference stories W01–W05 and S04, and SC03.

## Phase 4 — Administration and audit

Add admin workflows for account roles, deactivation, publishing approved template versions and mappings, and status and audit oversight. Keep verifier actions behind a separate permission. Seed the first template for earlier phases. Admins can publish a new version for future drafts while earlier submissions retain their exact versions. Validate mappings before publishing. Protect server-side audit events from staff edits and implement a testable integrity check for stored events. Document the trust boundary and limitations of that check.

| ID | Mandatory check and expected result |
| --- | --- |
| P4-01 | An admin assigns a role, then deactivates the account. Confirm a deactivated account's next protected operation fails. Confirm scanners cannot manage roles and admin access alone cannot Verify. |
| P4-02 | Publish a valid BEEF version 2 fixture. After refreshing the scanner's approved templates, new drafts can use version 2 and an existing version 1 submission retains its original mapping. Refuse a version with missing or conflicting required mappings. |
| P4-03 | Inspect audit events for correction, review decision, and account or template change. Confirm actor, time, resource, action, and applicable old/new values or reason. Deny unauthorized reads and staff modification. Detect a changed event in a dedicated test database. |
| P4-04 | Repeat the full phone-to-portal flow after adding admin controls. Confirm scanner identity separation, private images, final values, and mobile status still behave as expected. |

Reference stories A01–A03 and SC04.

## Phase 5 — Evaluation and demonstration

Prepare a runnable handover with environment setup, the Android APK, fictional fixtures, seed instructions, the acceptance checklist, and a demo script. Show airplane-mode capture and draft recovery, reconnect the phone to the laptop's network, sync, review both pages, correct a field, verify it, and refresh the phone's status. Record evidence for the success criteria in the charter.

| ID | Mandatory check and expected result |
| --- | --- |
| P5-01 | Follow the setup and demo script using the designated laptop, physical phone, and desktop browser. Record device and browser versions and any test limitation. |
| P5-02 | Run all earlier mandatory checks affected by changes. Demonstrate one interrupted sync and one denied private-image access alongside the successful workflow. |
| P5-03 | Compare pre-correction required-field OCR against labeled values and measure active handling time against manual encoding and review of the same synthetic forms. Report sample size, exact field match rate, timing method, and observed results. Include character error rate and usability feedback if gathered. Apply numerical targets only after the adviser and user agree them. |
| P5-04 | Provide a final test matrix, known limitations, and handover instructions. Ask the user to accept the prototype after reviewing the evidence. |

Reference SC01–SC05. Begin with Phase 1 and apply its approval gate before doing any Phase 2 work.
