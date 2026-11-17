import { requireNativeModule } from 'expo-modules-core';
import type { Corners } from '@tala/core';
type Element = { text: string; x: number; y: number; width: number; height: number };
export default requireNativeModule<{
  scanDocument(config: string): Promise<string | null>;
  rectifyDocument(uri: string, corners: Corners): Promise<{ uri: string; width: number; height: number }>;
  recognizeDocument(uri: string): Promise<{ text: string; blocks: { text: string; region: { x: number; y: number; width: number; height: number }; lines: { text: string; region: { x: number; y: number; width: number; height: number } }[] }[] }>;
  recognize(uri: string, dateCell: boolean): Promise<{ text: string; readingText?: string; elements: Element[] }>;
  rectify(uri: string, corners: Corners): Promise<{ uri: string; width: number; height: number }>;
}>('TalaOcr');
