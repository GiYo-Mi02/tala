import type { FieldKey } from "./fields";
import { normalizeOcr } from "./fields";
import { nameFromBoxes } from "./boxed-name";
import type { Page, RawField, OcrRun } from "./draft";
import type { Region } from "./template";

// Printed BEEF labels only; never use a name dictionary or remove characters from a name.
const printedLabels = [
  "school year",
  "schoolyear",
  "grade level to enroll",
  "graded specify grade level",
  "grade level",
  "learner reference no",
  "learner reference number",
  "lrn",
  "last name",
  "lastname",
  "first name",
  "firstname",
  "middle name",
  "middlename",
  "birthdate",
  "birth date",
  "mm dd yyyy",
];
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
export function containsPrintedLabel(text: string): boolean {
  const normalized = ` ${words(text)} `;
  return printedLabels.some((label) => normalized.includes(` ${label} `));
}
export function extractedValue(
  key: FieldKey,
  raw: RawField,
  row: Region,
): { value: string; warning?: "label_detected" } {
  if (containsPrintedLabel(raw.text))
    return { value: "", warning: "label_detected" };
  return {
    value: key.includes("_name")
      // BEEF requests capital letters. Preserve the model's original casing in raw.text.
      ? nameFromBoxes(raw.elements, row, raw.readingText ?? raw.text).toUpperCase()
      : normalizeOcr(key, raw.readingText ?? raw.text),
  };
}
/** Never overlay historical coordinates onto a replacement photograph. */
export function readingRegions(
  run: OcrRun | undefined,
  page: Page | undefined,
  key: FieldKey,
): Region[] | undefined {
  if (!run || !page || run.pageImageId !== page.imageId) return;
  const raw = run.fields[key];
  // Old runs stored only the encompassing rectangle; their exact split crops are unknown.
  return raw.regions?.length ? raw.regions : undefined;
}
