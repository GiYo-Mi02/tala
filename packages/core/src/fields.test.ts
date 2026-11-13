import { describe, expect, it } from 'vitest';
import clean from '../../../fixtures/expected/clean.json';
import optional from '../../../fixtures/expected/optional-blanks.json';
import invalid from '../../../fixtures/expected/invalid-required.json';
import { fieldKeys, normalizeOcr, parsePrintedDate, printedDate, validateValues, validIsoDate, valuesSchema, type Values } from './fields';

describe('P1-06: BEEF field parsing and validation', () => {
  for (const fixture of [clean, optional, invalid]) {
    it(`matches every labeled ${fixture.fixture} field`, () => {
      const values = Object.fromEntries(fieldKeys.map(key => [key, normalizeOcr(key, fixture.raw[key])])) as Values;
      expect(values).toEqual(fixture.values);
      expect(Object.keys(validateValues(values))).toEqual(fixture.errors);
    });
  }
  it('retains optional blanks and leading zeroes as strings', () => {
    expect(valuesSchema.parse(optional.values).lrn).toBe('');
    expect(valuesSchema.parse(optional.values).learner_middle_name).toBe('');
    expect(valuesSchema.parse(clean.values).lrn).toBe('001234567890');
    expect(normalizeOcr('lrn', '0 0 1 2 3 4 5 6 7 8 9 0')).toBe('001234567890');
  });
  it.each(['1','2','3','4','5','6','7','8','9','10','11','12'])('allows numeric grade %s', grade_level => expect(validateValues({ ...clean.values, grade_level }).grade_level).toBeUndefined());
  it.each(['','0','13','Grade 7','07','7.5','O'])('refuses unsupported grade %s', grade_level => expect(validateValues({ ...clean.values, grade_level }).grade_level).toBeDefined());
  it.each(['2014-02-30','2023-02-29','1900-02-29','2024-04-31','2024-00-01','2024-13-01','2024-01-00','0000-01-01','2024-2-01','12/31/2024'])('refuses impossible or non-ISO stored date %s', value => expect(validIsoDate(value)).toBe(false));
  it.each(['2000-02-29','2012-02-29','2024-02-29','2023-12-31','0001-01-01'])('accepts a real date %s', value => expect(validIsoDate(value)).toBe(true));
  it('uses printed MM/DD/YYYY regardless of locale', () => {
    expect(parsePrintedDate('11/03/2013')).toBe('2013-11-03');
    expect(printedDate('2013-11-03')).toBe('11/03/2013');
    expect(printedDate('2014-02-30')).toBe('02/30/2014');
    expect(normalizeOcr('birth_date','0 2 / 2 9 / 2 0 1 2')).toBe('2012-02-29');
    expect(validateValues({ ...clean.values, birth_date: parsePrintedDate('30/02/2014') }).birth_date).toBeDefined();
  });
  it('preserves intentional spaces, hyphens, and apostrophes in names', () => {
    const name = "DELA  CRUZ-O'NEILL";
    expect(valuesSchema.parse({ ...clean.values, learner_last_name: name }).learner_last_name).toBe(name);
  });
  it('joins year groups and does not guess uncertain glyphs', () => {
    expect(normalizeOcr('school_year', '2 0 2 4 - 2 0 2 5')).toBe('2024-2025');
    expect(validateValues({ ...clean.values, school_year: '2024-2026' }).school_year).toBeDefined();
    expect(validateValues({ ...clean.values, lrn: normalizeOcr('lrn', 'OO1234567890') }).lrn).toBeDefined();
  });
  it.each(['123','1234567890123','12345678901A'])('refuses malformed LRN %s', lrn => expect(validateValues({ ...clean.values, lrn }).lrn).toBeDefined());
});
