import { describe, expect, it } from 'vitest';
import { newDraft, type OcrRun } from '@tala/core';
import { draftWithScan, matchesBeefLayout, scanAcceptanceProblem, stagedPage, type PreparedScan } from './captureSupport';

const run = { id: 'new-ocr', pageImageId: 'new-image', fields: {}, engine: 'mlkit-bundled-latin-16.0.1', at: 'now' } as OcrRun;
const scan: PreparedScan = { uri: 'file:///cache/processed.jpg', imageId: 'new-image', width: 1800, height: 2545,
  extraction: { run, values: { ...newDraft('x', 'now').values, learner_first_name: 'ELENA' } },
  documentOcr: { text: 'First line\nSecond line', at: 'now', engine: 'mlkit-bundled-latin-16.0.1', blocks: [] } };

describe('Automatic scan review and template boundary', () => {
  it('blocks empty, missing and noise-only OCR instead of accepting a warning as success', () => {
    const aligned: PreparedScan = { ...scan, extraction: undefined, alignment: { method: 'opencv-manual-v1', sourceWidth: 2000, sourceHeight: 3000,
      corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] } };
    expect(scanAcceptanceProblem(aligned)).toBeUndefined();
    expect(scanAcceptanceProblem({ ...aligned, documentOcr: undefined, extraction: scan.extraction })).toBeUndefined();
    expect(scanAcceptanceProblem({ ...aligned, documentOcr: undefined, extraction: { run, values: newDraft('empty', 'now').values } })).toMatch(/did not finish/);
    expect(scanAcceptanceProblem({ ...aligned, documentOcr: undefined })).toMatch(/did not finish/);
    for (const text of ['', '  \n ', '...', 'I']) {
      expect(scanAcceptanceProblem({ ...aligned, documentOcr: { ...aligned.documentOcr!, text }, warning: 'OCR finished' })).toMatch(/No readable/);
    }
    expect(scanAcceptanceProblem({ ...aligned, alignment: undefined })).toMatch(/no reliable/);
  });
  it.each(['Basic Education Enrollment Form', 'SCHOOL YEAR\nLearner information\nBirthdate'])('identifies BEEF from labels, never from expected learner values (%s)', text => {
    expect(matchesBeefLayout(text, 1800, 2545)).toBe(true);
  });
  it.each(['Random government certificate', 'ELENA SANTOS RIVERA 001234567890', 'School year'])('keeps other documents outside seven-field extraction (%s)', text => {
    expect(matchesBeefLayout(text, 1800, 2545)).toBe(false);
  });
  it('does not apply upright BEEF fields to a landscape or very narrow document', () => {
    for (const [width, height] of [[2500, 1500], [700, 3000]]) expect(matchesBeefLayout('Basic Education Enrollment Form', width, height)).toBe(false);
  });
  it('preserves the candidate image identity and multiline full OCR for atomic acceptance', () => {
    const page = stagedPage(scan, 1);
    expect(page.imageId).toBe(run.pageImageId);
    expect(page.documentOcr?.text).toBe('First line\nSecond line');
    expect(page.uri).toBe(scan.uri);
  });
  it('keeps existing editable values when the reviewer chooses to retain them and preserves both raw runs', () => {
    const existing = newDraft('same-uuid', 'now');
    existing.values.learner_first_name = 'CORRECTED'; existing.confirmed.learner_first_name = true; existing.ocrHistory = [{ ...run, id: 'old' }];
    const next = draftWithScan(existing, scan, 1, false);
    expect(next.id).toBe(existing.id); expect(next.values.learner_first_name).toBe('CORRECTED');
    expect(next.ocrHistory.map(item => item.id)).toEqual(['old', 'new-ocr']);
    expect(next.confirmed).toEqual({}); expect(next.state).toBe('editing');
    expect(existing.confirmed.learner_first_name).toBe(true);
  });
  it('uses new proposals only when replacement is authorized, without confirming them', () => {
    const next = draftWithScan(newDraft('same-uuid', 'now'), scan, 1, true);
    expect(next.values.learner_first_name).toBe('ELENA'); expect(next.confirmed).toEqual({});
  });
  it('leaves learner values untouched for page 2 or a scan with unreadable/unregistered text', () => {
    const draft = newDraft('id', 'now'); draft.values.learner_first_name = 'KEPT';
    expect(draftWithScan(draft, scan, 2, true)).toBe(draft);
    expect(draftWithScan(draft, { ...scan, extraction: undefined }, 1, true)).toBe(draft);
  });
});
