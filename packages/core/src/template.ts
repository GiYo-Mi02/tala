import { fieldKeys, type FieldKey } from './fields';
export type Region = { x: number; y: number; width: number; height: number };
// Bounds were measured inside the upright embedded scan (1060 x 1495), then transformed
// through its actual PDF placement to the full printed page. The PDF crops the scan's edges.
// This transform is essential: raw embedded-image ratios do not match a printed PDF.
const relative = (x: number, y: number, width: number, height: number): Region => ({
  x: (-11.95501708984375 + x / 1060 * 611.75) / 595.4000244140625,
  y: (7.3599853515625 + y / 1495 * 862.5900268554688) / 841.7999877929688,
  width: width / 1060 * 611.75 / 595.4000244140625,
  height: height / 1495 * 862.5900268554688 / 841.7999877929688,
});
export const beefTemplate = {
  id: 'beef-sy-2024-2025', version: 1, label: 'BEEF SY 2024-2025',
  pilotNotice: 'BEEF pilot - partial field extraction. Seven typed English fields on page 1 only. Page 2 is evidence.',
  pages: [{ page: 1, width: 1060, height: 1499 }, { page: 2, width: 1060, height: 1499 }],
  regions: {
    school_year: [relative(215, 219, 95, 27), relative(344, 219, 94, 27)],
    grade_level: [relative(344, 288, 44, 26)],
    lrn: [relative(619, 253, 290, 26)],
    learner_last_name: [relative(84, 472, 582, 29)],
    learner_first_name: [relative(84, 542, 582, 29)],
    learner_middle_name: [relative(84, 612, 582, 30)],
    birth_date: [relative(710, 472, 51, 29), relative(794, 472, 51, 29), relative(878, 472, 107, 29)],
  } satisfies Record<FieldKey, Region[]>,
  cells: { school_year: [4, 4], grade_level: [1], lrn: [12], learner_last_name: [20],
    learner_first_name: [20], learner_middle_name: [20], birth_date: [2, 2, 4] } satisfies Record<FieldKey, number[]>,
} as const;
export function pixelRegion(region: Region, width: number, height: number) {
  const originX = Math.max(0, Math.floor(region.x * width));
  const originY = Math.max(0, Math.floor(region.y * height));
  return { originX, originY, width: Math.min(width - originX, Math.max(1, Math.floor(region.width * width))),
    height: Math.min(height - originY, Math.max(1, Math.floor(region.height * height))) };
}
export type OcrElement = Region & { text: string };
// Used for mapping regression tests and OCR overlay diagnostics. Input is normalized to the upright image.
export function mapElements(elements: OcrElement[]): Record<FieldKey, string[]> {
  return Object.fromEntries(fieldKeys.map(key => [key, beefTemplate.regions[key].map(r => elements
    .filter(e => e.x + e.width / 2 >= r.x && e.x + e.width / 2 <= r.x + r.width && e.y + e.height / 2 >= r.y && e.y + e.height / 2 <= r.y + r.height)
    .sort((a, b) => a.x - b.x).map(e => e.text).join(' '))])) as Record<FieldKey, string[]>;
}
