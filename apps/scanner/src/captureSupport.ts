import type { Alignment, Corners, DocumentOcr, Draft, OcrRun, PageNumber, Values } from '@tala/core';
import { fieldKeys, isAligned, validateValues } from '@tala/core';

export type Candidate = { uri: string; width: number; height: number; alignment?: Alignment; documentOcr?: DocumentOcr };
export type PreparedScan = Candidate & { imageId: string; extraction?: import('./ocr').Extraction; warning?: string };
export type NativeScan = { source: Candidate; rawUri: string; processed?: Candidate; corners?: Corners;
  suggestedCorners?: Corners; confidence?: number; reason?: string; warning?: string; allowManual?: boolean;
  diagnostic?: { code: string; stage: string; sourceWidth?: number; sourceHeight?: number; workingWidth?: number; workingHeight?: number } };
export const scannerConfig = { stableMs: 1000, motionTolerance: 0.018, minSharpness: 45, minBrightness: 45, maxGlare: 0.20 };

/** A warning does not turn an empty/failed OCR result into an acceptable scan. */
export function scanAcceptanceProblem(scan: PreparedScan): string | undefined {
  if (!isAligned(scan)) return 'This photo has no reliable document crop. Retake it or adjust the crop.';
  if (scan.extraction) {
    const errors = validateValues(scan.extraction.values);
    if (fieldKeys.some(key => !errors[key] && (scan.extraction!.values[key].match(/[\p{L}\p{N}]/gu) ?? []).length >= 4)) return;
  }
  if (!scan.documentOcr) return 'Text reading did not finish. Retry reading or retake a clear photo.';
  if ((scan.documentOcr.text.match(/[A-Za-z0-9]/g) ?? []).length < 4)
    return 'No readable document text was found. Retake with the whole page visible and enough light.';
}

/** Template identification only; these labels never supply field values. */
export function matchesBeefLayout(text: string, width: number, height: number) {
  if (width / height < 0.56 || width / height > 0.85) return false;
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.includes('BASICEDUCATIONENROLLMENTFORM') ||
    ['SCHOOLYEAR', 'LEARNER', 'BIRTHDATE', 'REFERENCE'].filter(label => compact.includes(label)).length >= 3;
}
export function stagedPage(scan: PreparedScan, page: PageNumber) {
  return { uri: scan.uri, width: scan.width, height: scan.height, alignment: scan.alignment, documentOcr: scan.documentOcr,
    imageId: scan.imageId, page, acceptedAt: new Date().toISOString() };
}
/** The caller chooses replacement after explicit review; persistence commits this with the image. */
export function draftWithScan(draft: Draft, scan: PreparedScan, page: PageNumber, replaceValues: boolean): Draft {
  if (page !== 1 || !scan.extraction) return draft;
  return { ...draft, values: replaceValues ? scan.extraction.values : draft.values,
    ocrHistory: [...draft.ocrHistory, scan.extraction.run], confirmed: {}, state: 'editing' };
}
