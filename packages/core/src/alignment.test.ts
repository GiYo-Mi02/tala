import { describe, expect, it } from 'vitest';
import { alignedSize, alignmentProblem, isAligned, type Corners } from './alignment';
const full: Corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
describe('Four-corner alignment validation', () => {
  it('accepts full-page and perspective selections in clockwise order', () => {
    expect(alignmentProblem(full, 1060, 1499)).toBeUndefined();
    expect(alignmentProblem([{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.15 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.95 }], 2000, 3000)).toBeUndefined();
  });
  it.each([
    [full[0], full[2], full[1], full[3]],
    [full[0], full[3], full[2], full[1]],
    [full[1], full[2], full[3], full[0]],
    [full[0], full[1], full[1], full[3]],
    [{ x: -0.1, y: 0 }, ...full.slice(1)],
    [{ x: Number.NaN, y: 0 }, ...full.slice(1)],
    full.slice(1),
  ])('rejects crossing, reversed, degenerate, outside, nonfinite or missing corners (%#)', (...points) => {
    expect(alignmentProblem(points, 2000, 3000)).toBeTruthy();
  });
  it('rejects inadequate source resolution and invalid dimensions', () => {
    expect(alignmentProblem(full, 600, 900)).toMatch(/too small/);
    expect(alignmentProblem(full, Infinity, 1500)).toBeTruthy();
  });
  it('requires valid alignment metadata and canonical dimensions before OCR; legacy pages remain readable', () => {
    const legacy = { width: 1060, height: 1499 };
    expect(isAligned(legacy)).toBe(false);
    const page = { ...alignedSize, alignment: { method: 'four-corner-v1' as const, sourceWidth: 1060, sourceHeight: 1499, corners: full } };
    expect(isAligned(page)).toBe(true);
    expect(isAligned({ ...page, height: 1600 })).toBe(false);
    expect(isAligned({ ...page, alignment: { ...page.alignment, corners: [full[0], full[2], full[1], full[3]] } })).toBe(false);
  });
  it('accepts a complete image captured inside the camera guide', () => {
    expect(isAligned({
      width: 3024,
      height: 4032,
      alignment: { method: 'guide-v1', sourceWidth: 3024, sourceHeight: 4032 },
    })).toBe(true);
    expect(isAligned({
      width: 3024,
      height: 4032,
      alignment: { method: 'guide-v1', sourceWidth: 1600, sourceHeight: 2263 },
    })).toBe(false);
  });
});
