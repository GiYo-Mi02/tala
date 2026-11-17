import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { beefTemplate, type Alignment } from "@tala/core";
import { discardCache } from "./repository";

export type Candidate = { uri: string; width: number; height: number; alignment?: Alignment };

/** Fit the upright 4:3 sensor preview without stretching it into the remaining screen space. */
export function portraitCameraFrame(availableWidth: number, availableHeight: number) {
  if (![availableWidth, availableHeight].every(n => Number.isFinite(n) && n > 0)) return undefined;
  const width = Math.min(availableWidth, availableHeight * 3 / 4);
  const height = width * 4 / 3;
  const paper = beefTemplate.pages[0];
  const guideHeight = height * 0.9;
  const guideWidth = guideHeight * paper.width / paper.height;
  return { width, height, guide: { left: (width - guideWidth) / 2, top: (height - guideHeight) / 2,
    width: guideWidth, height: guideHeight } };
}

/** The alignment screen owns the normalized cache file only after a successful handoff. */
export async function captureForAlignment(
  take: () => Promise<{ uri: string } | undefined>,
  onPhoto: (photo: Candidate) => Promise<void>,
) {
  let sourceUri: string | undefined;
  let normalizedUri: string | undefined;
  let handedOff = false;
  try {
    const photo = await take();
    if (!photo) throw new Error("Photo capture failed. Try again.");
    sourceUri = photo.uri;
    // Apply camera orientation to pixels. A framing guide is not proof of paper alignment.
    const normalized = await manipulateAsync(photo.uri, [], { compress: 1, format: SaveFormat.JPEG });
    normalizedUri = normalized.uri;
    await onPhoto({ uri: normalized.uri, width: normalized.width, height: normalized.height });
    handedOff = true;
  } finally {
    if (sourceUri && (sourceUri !== normalizedUri || !handedOff)) await discardCache(sourceUri).catch(() => {});
    if (normalizedUri && normalizedUri !== sourceUri && !handedOff) await discardCache(normalizedUri).catch(() => {});
  }
}
