import { requireNativeModule } from 'expo-modules-core';
import type { Corners } from '@tala/core';
type Element = { text: string; x: number; y: number; width: number; height: number };
export default requireNativeModule<{
  recognize(uri: string): Promise<{ text: string; readingText?: string; elements: Element[] }>;
  rectify(uri: string, corners: Corners): Promise<{ uri: string; width: number; height: number }>;
}>('TalaOcr');
