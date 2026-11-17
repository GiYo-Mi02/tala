import { describe, expect, it } from 'vitest';
import { containsPrintedLabel, extractedValue, readingRegions } from './extraction';
import { beefTemplate } from './template';
import { fieldKeys } from './fields';
import type { OcrRun, Page, RawField } from './draft';
const row = beefTemplate.regions.learner_last_name[0];
const raw = (text: string): RawField => ({ text, crop: row, elements: [] });
describe('Printed BEEF labels and reading evidence', () => {
  it.each(['Last Name', 'FIRST NAME: ELENA', 'Middle\nName', "Learner’s Last Name", 'BIRTHDATE (mm/dd/yyyy)',
    'Learner Reference No. (LRN)? If applicable:', 'School-Year 2024-2025', 'Graded, specify Grade Level', 'LastName', 'FIRSTNAME', 'MiddleName', 'SchoolYear'])('rejects label text: %s', text => {
    const original = raw(text);
    expect(extractedValue('learner_last_name', original, row)).toEqual({ value: '', warning: 'label_detected' });
    expect(original.text).toBe(text);
  });
  it.each(['RIVERA', 'DELA CRUZ', "O'NEILL", 'SMITH-JONES', 'NAMELESS', 'FIRSTMAN', 'BIRTHDATEZ'])('preserves legitimate name text: %s', text => {
    expect(containsPrintedLabel(text)).toBe(false);
    expect(extractedValue('learner_last_name', raw(text), row)).toEqual({ value: text });
  });
  it('preserves optional blanks and leading LRN zeroes', () => {
    expect(extractedValue('lrn', raw(''), row)).toEqual({ value: '' });
    expect(extractedValue('learner_middle_name', raw(''), row)).toEqual({ value: '' });
    expect(extractedValue('lrn', raw('0 0 1 2 3 4 5 6 7 8 9 0'), row)).toEqual({ value: '001234567890' });
  });
  it('normalizes BEEF name casing while preserving original recognition and punctuation', () => {
    const original=raw("de la Cruz-O'Neill");
    expect(extractedValue('learner_last_name',original,row).value).toBe("DE LA CRUZ-O'NEILL");
    expect(original.text).toBe("de la Cruz-O'Neill");
  });
  it('uses the geometry-deduplicated reading and retains the complete original text', () => {
    const original={...raw('2024 4-2025'),readingText:'2024-2025'};
    expect(extractedValue('school_year',original,row).value).toBe('2024-2025');
    expect(original.text).toBe('2024 4-2025');
    expect(extractedValue('learner_last_name',{...raw('Last Name RIVERA'),readingText:'RIVERA'},row)).toEqual({value:'',warning:'label_detected'});
  });
  it('shows only the saved exact regions belonging to the same image identity', () => {
    const fields = Object.fromEntries(fieldKeys.map(key => [key, { ...raw('RIVERA'), regions: [{ ...row }] }])) as OcrRun['fields'];
    const run: OcrRun = { id: 'ocr', pageImageId: 'old', at: 'now', engine: 'mlkit-bundled-latin-16.0.1', fields };
    const page: Page = { page: 1, uri: 'private://page', imageId: 'old', acceptedAt: 'now', width: 1600, height: 2263 };
    expect(readingRegions(run, page, 'learner_last_name')).toEqual([row]);
    expect(readingRegions(run, { ...page, imageId: 'replacement' }, 'learner_last_name')).toBeUndefined();
    expect(readingRegions(run, undefined, 'learner_last_name')).toBeUndefined();
    delete fields.learner_last_name.regions;
    expect(readingRegions(run, page, 'learner_last_name')).toBeUndefined();
  });
});
