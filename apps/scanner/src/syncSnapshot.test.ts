import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { activeFixedFields, fieldKeys, newDraft, newFixedDraft, type FixedPage, type OcrRun, type RawField } from '@tala/core';
import { makeSyncSnapshot } from './syncSnapshot';

const now = '2026-11-18T01:11:11.000Z';
const rect = { x: .15, y: .1, width: .2, height: .025 };
const engine = 'mlkit-bundled-latin-16.0.1' as const;

describe('immutable sync payload', () => {
  it('uses the existing draft ID, accepted pages, corrected values and matching raw BEEF evidence', () => {
    const draft = newDraft(randomUUID(), now);
    for (const page of [1, 2] as const) {
      const imageId = randomUUID();
      draft.pages[page] = { page, imageId, width: 1800, height: 2480, uri: 'file:///'+imageId+'.jpg', acceptedAt: now };
    }
    draft.values = { school_year: '2024-2025', grade_level: '7', lrn: '001234567890',
      learner_last_name: 'RIVERA', learner_first_name: 'ELENA', learner_middle_name: '', birth_date: '2012-02-29' };
    draft.confirmed = Object.fromEntries(fieldKeys.map(key => [key, true]));
    const reading = (pageImageId: string, lrn: string): OcrRun => ({
      id: randomUUID(), pageImageId, engine, at: now,
      fields: Object.fromEntries<RawField>(fieldKeys.map(key => [key, { crop: rect, regions: [rect], elements: [],
        text: key === 'lrn' ? lrn : draft.values[key] }])) as OcrRun['fields'],
    });
    draft.ocrHistory = [reading(draft.pages[1]!.imageId, 'OO123456789O'), reading(randomUUID(), 'wrong image')];
    Object.assign(draft.ocrHistory[0].fields.lrn, {
      readingText: 'OO123456789O',
      evidence: [{ originalText: 'OO123456789O', originalReading: 'OO123456789O', originalConfidence: .69,
        processedText: '001234567890', processedReading: '001234567890', processedConfidence: .8,
        sourceWidth: 180, sourceHeight: 30, inputWidth: 180, inputHeight: 30,
        verticalLines: [], horizontalLines: [], occupiedCells: [], removedInkFraction: 0 }],
    });
    draft.state = 'ready';
    const snapshot = makeSyncSnapshot(draft);
    expect(snapshot.create).toEqual({ clientSubmissionId: draft.id, templateId: draft.templateId, templateVersion: 1, capturedAt: now });
    expect(snapshot.pages.map(page => page.number)).toEqual([1, 2]);
    expect(snapshot.fields.fields.find(f => f.key === 'lrn')).toMatchObject({ mobileValue: '001234567890',
      ocr: { original: 'OO123456789O', imageId: draft.pages[1]!.imageId, regions: [rect], engine, confidence: .69 } });
    draft.confirmed.lrn = false;
    expect(() => makeSyncSnapshot(draft)).toThrow(/confirmed field/);
    expect(snapshot.fields.fields.find(f => f.key === 'lrn')?.mobileValue).toBe('001234567890');
  });

  it('maps only SSS active fields and uses the conditional additional page without a reference-page upload', () => {
    const draft = newFixedDraft(randomUUID(), now);
    Object.assign(draft.values, { sss_registrant_last_name: 'ALVAREZ', sss_registrant_first_name: 'MIRA', sss_birth_date: '1994-04-15',
      sss_sex: 'Female', sss_civil_status: 'Single', sss_nationality: 'FILIPINO', sss_place_of_birth: 'PASIG',
      sss_employment_section: 'Not applicable', sss_certification_review: 'Reviewed on image', sss_additional_sheet_used: 'Yes',
      sss_additional_registrant_last_name: 'ALVAREZ', sss_additional_registrant_first_name: 'MIRA',
      sss_additional_certification_review: 'Reviewed on image' });
    for (const page of [1, 3]) {
      const imageId = randomUUID();
      draft.pages[page] = { page, imageId, width: 1700, height: 2200, uri: 'file:///'+imageId+'.jpg', acceptedAt: now,
        alignment: {} as FixedPage['alignment'] };
    }
    const fieldId = 'sss_additional_registrant_last_name';
    const pageImageId = draft.pages[3]!.imageId;
    draft.history.push({
      id: randomUUID(), pageImageId, page: 3, at: now, templateId: draft.templateId, templateVersion: draft.templateVersion,
      engine, preprocessing: 'native-roi-v3',
      fields: { [fieldId]: { fieldId, pageImageId, text: 'ALVAR3Z', originalText: 'ALVAR3Z', processedText: 'ALVARE',
        originalNormalized: 'ALVAR3Z', processedNormalized: 'ALVARE', normalized: '', region: rect, confidence: .81, error: 'Review name' } },
    });
    draft.confirmed = Object.fromEntries(activeFixedFields(draft).map(field => [field.id, true]));
    draft.state = 'ready';
    const snapshot = makeSyncSnapshot(draft);
    expect(snapshot.pages.map(page => page.number)).toEqual([1, 3]);
    expect(snapshot.fields.fields.find(field => field.key === fieldId)).toMatchObject({ mobileValue: 'ALVAREZ',
      ocr: { imageId: pageImageId, original: 'ALVAR3Z', confidence: .81, regions: [rect], warning: 'Review name' } });
    expect(snapshot.fields.fields.find(field => field.key === 'sss_additional_sheet_used')?.ocr).toBeNull();
    draft.values.sss_additional_sheet_used = 'No';
    const withoutSheet = makeSyncSnapshot(draft);
    expect(withoutSheet.pages.map(page => page.number)).toEqual([1]);
    expect(withoutSheet.fields.fields.some(field => field.key === fieldId)).toBe(false);
  });
});
