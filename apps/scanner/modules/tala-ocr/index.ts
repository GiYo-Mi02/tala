import { requireNativeModule } from 'expo-modules-core';
type Element = { text: string; x: number; y: number; width: number; height: number };
export default requireNativeModule<{ recognize(uri: string): Promise<{ text: string; elements: Element[] }> }>('TalaOcr');
