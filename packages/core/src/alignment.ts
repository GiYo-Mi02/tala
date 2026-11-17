export type Point = { x: number; y: number };
/** Clockwise, on the upright source: top-left, top-right, bottom-right, bottom-left. */
export type Corners = [Point, Point, Point, Point];
export const alignedSize = { width: 1600, height: 2263 } as const;
export type Alignment =
  | { method: 'four-corner-v1'; sourceWidth: number; sourceHeight: number; corners: Corners }
  | { method: 'opencv-auto-v1' | 'opencv-manual-v1'; sourceWidth: number; sourceHeight: number; corners: Corners; confidence?: number }
  | { method: 'guide-v1'; sourceWidth: number; sourceHeight: number };

export function alignmentProblem(points: readonly Point[], width: number, height: number, minimumSide?: number): string | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || points.length !== 4 ||
    points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1))
    return 'Select four corners inside the photo.';
  const p = points.map(v => ({ x: v.x * width, y: v.y * height }));
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1)
      return 'Select the corners clockwise: top left, top right, bottom right, bottom left. Keep the paper flat.';
  }
  if (p[0].x + p[3].x >= p[1].x + p[2].x || p[0].y + p[1].y >= p[2].y + p[3].y)
    return 'Rotate the photo upright, then select top left, top right, bottom right, bottom left.';
  const edge = (a: number, b: number) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
  if (Math.min(edge(0, 1), edge(3, 2)) < (minimumSide ?? 700) || Math.min(edge(0, 3), edge(1, 2)) < (minimumSide ?? 950))
    return 'The paper is too small for reliable field reading. Retake closer, keeping the whole paper visible.';
  const area = p.reduce((sum, a, i) => sum + a.x * p[(i + 1) % 4].y - a.y * p[(i + 1) % 4].x, 0) / 2;
  const bounds = (Math.max(...p.map(v => v.x)) - Math.min(...p.map(v => v.x))) *
    (Math.max(...p.map(v => v.y)) - Math.min(...p.map(v => v.y)));
  if (area < bounds * 0.1) return 'This selection is too narrow. Retake facing the paper more directly.';
}

export function isAligned(page: { width: number; height: number; alignment?: Alignment }): boolean {
  const a = page.alignment;
  if (a?.method === 'opencv-auto-v1' || a?.method === 'opencv-manual-v1') {
    const confidence = a.method !== 'opencv-auto-v1' || (Number.isFinite(a.confidence) && a.confidence! >= 0.72 && a.confidence! <= 1);
    return confidence && Number.isFinite(page.width) && Number.isFinite(page.height) && page.width >= 600 && page.height >= 600 &&
      page.width <= 5000 && page.height <= 5000 && !alignmentProblem(a.corners, a.sourceWidth, a.sourceHeight, 600);
  }
  // Older guide-v1 photos include camera margins. Keep them readable, but require
  // actual paper alignment before applying the template's field coordinates.
  return !!a && a.method === 'four-corner-v1' && page.width === alignedSize.width && page.height === alignedSize.height &&
    !alignmentProblem(a.corners, a.sourceWidth, a.sourceHeight);
}
