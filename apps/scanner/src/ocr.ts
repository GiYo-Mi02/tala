import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import {
  beefTemplate,
  fieldKeys,
  extractedValue,
  isAligned,
  pixelRegion,
  type FieldKey,
  type OcrRun,
  type Page,
  type RawField,
  type Values,
} from "@tala/core";
import TalaOcr from "../modules/tala-ocr";
import { discardCache } from "./repository";

export async function recognizePage(
  page: Page,
  onProgress: (value: string) => void,
): Promise<{ run: OcrRun; values: Values }> {
  if (page.page !== 1) throw new Error("Only page 1 has extraction mappings.");
  if (!isAligned(page)) throw new Error("Align saved page 1 before running OCR. Check that the highlighted areas cover the answer boxes.");
  if (page.width / page.height < 0.56 || page.width / page.height > 0.85)
    throw new Error("Automatic field extraction supports the upright BEEF layout. Rotate or retake this page; its full OCR text remains available.");
  const fields = {} as Record<FieldKey, RawField>;
  const values = {} as Values;
  for (const key of fieldKeys) {
    onProgress(`Reading ${key.replaceAll("_", " ")}...`);
    const parts: string[] = [];
    const readingParts: string[] = [];
    const elements: RawField["elements"] = [];
    const actualRegions: NonNullable<RawField['regions']> = [];
    const regions = beefTemplate.regions[key];
    for (const region of regions) {
      const crop = pixelRegion(region, page.width, page.height);
      actualRegions.push({ x: crop.originX / page.width, y: crop.originY / page.height,
        width: crop.width / page.width, height: crop.height / page.height });
      // A physical crop confines native recognition to actual inputs, never full-page name searching.
      const image = await manipulateAsync(
        page.uri,
        [{ crop }, { resize: { height: 128 } }],
        { format: SaveFormat.JPEG, compress: 1 },
      );
      try {
        const result = await TalaOcr.recognize(image.uri, key === 'birth_date');
        parts.push(result.text);
        readingParts.push(result.readingText ?? result.text);
        for (const e of result.elements)
          elements.push({
            text: e.text,
            x: (crop.originX + (e.x * crop.width) / image.width) / page.width,
            y:
              (crop.originY + (e.y * crop.height) / image.height) / page.height,
            width: (e.width * crop.width) / image.width / page.width,
            height: (e.height * crop.height) / image.height / page.height,
          });
      } finally {
        await discardCache(image.uri);
      }
    }
    const separator =
      key === "school_year" ? "-" : key === "birth_date" ? "/" : " ";
    const raw = parts.map((p) => p.trim()).join(separator);
    const first = regions[0];
    const last = regions[regions.length - 1];
    fields[key] = {
      text: raw,
      readingText: readingParts.map(p => p.trim()).join(separator),
      elements,
      crop: {
        x: first.x,
        y: first.y,
        width: last.x + last.width - first.x,
        height: first.height,
      },
      regions: actualRegions,
    };
    const extracted = extractedValue(key, fields[key], first);
    values[key] = extracted.value;
    if (extracted.warning) fields[key].warning = extracted.warning;
  }
  return {
    values,
    run: {
      id: Crypto.randomUUID(),
      pageImageId: page.imageId,
      at: new Date().toISOString(),
      engine: "mlkit-bundled-latin-16.0.1",
      preprocessing: 'grid-lines-v2',
      fields,
    },
  };
}
