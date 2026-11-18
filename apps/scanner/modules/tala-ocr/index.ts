import { requireNativeModule } from 'expo-modules-core';
import type { Corners } from '@tala/core';
type Element = { text: string; x: number; y: number; width: number; height: number };
export type RoiReading = { text: string; readingText: string; elements: Element[]; confidence: number | null };
export type RoiResult = { fieldId: string; part: number; x: number; y: number; original: RoiReading; processed: RoiReading; sourceWidth: number; sourceHeight: number; inputWidth: number; inputHeight: number; verticalLines: number[]; horizontalLines: number[]; occupiedCells: number[]; removedInkFraction: number; segmented?: RoiReading | null; segments?: (RoiReading & { startCell: number; cells: number })[]; diagnostics: Partial<Record<string, string>> };
export default requireNativeModule<{
  diagnosticsEnabled: boolean;
  registerSssPage(uri: string, page: number): Promise<{ uri: string; width: number; height: number } | null>;
  rectifySssFrame(uri: string, page: number, corners: Corners): Promise<{ uri: string; width: number; height: number }>;
  recognizeField(uri: string, request: string): Promise<RoiResult>;
  scanDocument(config: string): Promise<string | null>;
  rectifyDocument(uri: string, corners: Corners): Promise<{ uri: string; width: number; height: number }>;
  recognizeDocument(uri: string): Promise<{ text: string; blocks: { text: string; region: { x: number; y: number; width: number; height: number }; lines: { text: string; region: { x: number; y: number; width: number; height: number } }[] }[] }>;
  recognize(uri: string, dateCell: boolean): Promise<{ text: string; readingText?: string; elements: Element[] }>;
  rectify(uri: string, corners: Corners): Promise<{ uri: string; width: number; height: number }>;
}>('TalaOcr');
