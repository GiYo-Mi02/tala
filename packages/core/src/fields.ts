import { z } from 'zod';

export const fieldKeys = ['school_year', 'grade_level', 'lrn', 'learner_last_name', 'learner_first_name', 'learner_middle_name', 'birth_date'] as const;
export type FieldKey = typeof fieldKeys[number];
export type Values = Record<FieldKey, string>;
export const fieldLabels: Record<FieldKey, string> = {
  school_year: 'School Year', grade_level: 'Grade Level to Enroll (Graded)', lrn: 'Learner Reference No. (optional)',
  learner_last_name: "Learner's Last Name", learner_first_name: "Learner's First Name",
  learner_middle_name: "Learner's Middle Name (optional)", birth_date: 'Birthdate (MM/DD/YYYY)',
};
export const emptyValues = (): Values => Object.fromEntries(fieldKeys.map(k => [k, ''])) as Values;

export function validIsoDate(s: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return false;
  const [, ys, ms, ds] = match;
  const [y, m, d] = [Number(ys), Number(ms), Number(ds)];
  if (y < 1 || m < 1 || m > 12) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
export function parsePrintedDate(raw: string): string {
  const m = /^(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : raw.trim();
}
export function printedDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : iso;
}
export function normalizeOcr(key: FieldKey, raw: string): string {
  const s = raw.trim();
  if (key === 'birth_date') return parsePrintedDate(s.replace(/\s/g, ''));
  if (key === 'lrn' || key === 'grade_level') return s.replace(/\s/g, '');
  if (key === 'school_year') {
    const digits = s.replace(/[\s\u2010-\u2015-]/g, '');
    return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : s;
  }
  return s;
}

const name = z.string().trim().min(1, 'Required learner field.').max(120, 'Use at most 120 characters.');
export const valuesSchema = z.object({
  school_year: z.string().trim().refine(v => {
    const m = /^(\d{4})-(\d{4})$/.exec(v);
    return !!m && Number(m[1]) > 0 && Number(m[2]) === Number(m[1]) + 1;
  }, 'Use consecutive years, e.g. 2024-2025.'),
  grade_level: z.string().trim().regex(/^(?:[1-9]|1[0-2])$/, 'Enter a numeric grade from 1 to 12.'),
  lrn: z.string().trim().refine(v => v === '' || /^\d{12}$/.test(v), 'Leave blank or enter exactly 12 digits.'),
  learner_last_name: name,
  learner_first_name: name,
  learner_middle_name: z.string().trim().max(120, 'Use at most 120 characters.'),
  birth_date: z.string().trim().refine(validIsoDate, 'Enter a real date in MM/DD/YYYY order.'),
}).strict();
export function validateValues(values: Values): Partial<Record<FieldKey, string>> {
  const result = valuesSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map(i => [i.path[0], i.message]));
}
