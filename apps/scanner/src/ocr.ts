import * as Crypto from 'expo-crypto';
import { beefTemplate, fieldKeys, extractedValue, isAligned, pixelRegion, validateValues,
  type FieldKey, type OcrRun, type Page, type RawField, type Values } from '@tala/core';
import TalaOcr, { type RoiResult, type RoiReading } from '../modules/tala-ocr';
import { discardCache } from './repository';

export type OcrDiagnostics = Partial<Record<FieldKey, RoiResult[]>>;
export type Extraction = { run: OcrRun; values: Values; diagnostics?: OcrDiagnostics };
export async function recognizePage(page: Page, onProgress: (value: string) => void,
  retainDiagnostic?: (uri: string) => void): Promise<Extraction> {
  if (page.page !== 1) throw new Error('Only page 1 has extraction mappings.');
  if (!isAligned(page)) throw new Error('Align saved page 1 before running OCR. Check that the highlighted areas cover the answer boxes.');
  if (page.width / page.height < .56 || page.width / page.height > .85)
    throw new Error('Automatic field extraction supports the upright BEEF layout. Rotate or retake this page.');
  const fields = {} as Record<FieldKey, RawField>;
  const values = {} as Values;
  const diagnostics: OcrDiagnostics = {};
  for (const key of fieldKeys) {
    onProgress(`Reading ${key.replaceAll('_', ' ')}...`);
    const regions = beefTemplate.regions[key].map(region => pixelRegion(region, page.width, page.height));
    const actualRegions = regions.map(r => ({ x: r.originX/page.width, y: r.originY/page.height, width: r.width/page.width, height: r.height/page.height }));
    const row = actualRegions[0];
    const separator = key === 'school_year' ? '-' : key === 'birth_date' ? '/' : ' ';
    const results: RoiResult[] = [];
    let failed = false;
    for (const [part, crop] of regions.entries()) {
      try {
        const result = await TalaOcr.recognizeField(page.uri, JSON.stringify({ fieldId: key, part,
          x: crop.originX, y: crop.originY, width: crop.width, height: crop.height,
          cells: beefTemplate.cells[key][part], diagnostics: !!TalaOcr.diagnosticsEnabled && !!retainDiagnostic }));
        for (const uri of Object.values(result.diagnostics)) if (uri) {
          if (retainDiagnostic) retainDiagnostic(uri); else await discardCache(uri);
        }
        if (result.fieldId !== key || result.part !== part) throw new Error('Field identity mismatch.');
        results.push(result);
      } catch { failed = true; }
    }
    function raw(variant: 'original' | 'processed'): RawField {
      const readings: RoiReading[] = results.map(r => r[variant]);
      return { text: readings.map(r => r.text.trim()).join(separator), readingText: readings.map(r => r.readingText.trim()).join(separator),
        crop: { ...row, width: actualRegions.at(-1)!.x + actualRegions.at(-1)!.width - row.x }, regions: actualRegions,
        elements: results.flatMap(r => r[variant].elements.map(e => ({ text: e.text,
          x: (regions[r.part].originX + e.x)/page.width, y: (regions[r.part].originY + e.y)/page.height,
          width: e.width/page.width, height: e.height/page.height }))) };
    }
    const original = raw('original'); const processed = raw('processed');
    const before = extractedValue(key, original, row); const after = extractedValue(key, processed, row);
    const changed = before.value !== after.value;
    const beforeValid = !before.warning && !validateValues({ ...values, [key]: before.value } as Values)[key];
    const afterValid = !after.warning && !validateValues({ ...values, [key]: after.value } as Values)[key];
    // Select an actual model reading only when one variant passes the field format.
    // Two different valid readings remain unresolved. No character substitution occurs.
    const conflict = changed && beforeValid === afterValid;
    const useOriginal = changed && beforeValid && !afterValid;
    const selected = useOriginal ? original : processed;
    fields[key] = { ...selected, originalNormalized: before.value, processedNormalized: after.value, evidence: results.map(r => ({ originalText: r.original.text, processedText: r.processed.text,
      originalReading: r.original.readingText, processedReading: r.processed.readingText,
      originalConfidence: r.original.confidence, processedConfidence: r.processed.confidence,
      sourceWidth: r.sourceWidth, sourceHeight: r.sourceHeight, inputWidth: r.inputWidth, inputHeight: r.inputHeight,
      verticalLines: r.verticalLines, horizontalLines: r.horizontalLines, occupiedCells: r.occupiedCells, removedInkFraction: r.removedInkFraction })),
      warning: failed ? 'recognition_failed' : conflict ? 'conflicting_readings' : changed ? 'preprocessing_review' : after.warning };
    values[key] = failed || conflict ? '' : useOriginal ? before.value : after.value;
    if (TalaOcr.diagnosticsEnabled && retainDiagnostic) diagnostics[key] = results;
  }
  const invalid = validateValues(values);
  for (const key of fieldKeys) fields[key].validation = fields[key].warning === 'conflicting_readings'
    ? 'Original and processed crops disagree. Read the image and enter the value manually.'
    : fields[key].warning === 'preprocessing_review' ? 'Original and cleaned OCR differ. Only one passes the field format; this proposal is uncertain. Check the image before confirming.'
    : fields[key].warning === 'recognition_failed' ? 'Field reading failed. Verify this field manually.'
    : fields[key].warning === 'label_detected' ? 'Printed label detected inside answer region. Check alignment.' : invalid[key];
  return { values, diagnostics, run: { id: Crypto.randomUUID(), pageImageId: page.imageId, at: new Date().toISOString(),
    engine: 'mlkit-bundled-latin-16.0.1', preprocessing: 'native-roi-v3', fields } };
}
