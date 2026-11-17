import React, { useEffect, useRef, useState } from 'react';
import { Image, Text, View, useWindowDimensions } from 'react-native';
import { fieldKeys, fieldLabels, type Page } from '@tala/core';
import TalaOcr from '../modules/tala-ocr';
import { recognizePage, type Extraction } from './ocr';
import { discardCache } from './repository';
import { Action, styles } from './ui';

export function SavedOcrDiagnostics({ page }: { page: Page }) {
  const [result, setResult] = useState<Extraction>();
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const running = useRef(false);
  const files = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const uri of files.current) void discardCache(uri).catch(() => {}); };
  }, []);
  if (!TalaOcr.diagnosticsEnabled) return null;
  async function read() {
    if (running.current) return;
    running.current = true; setProgress('Reading diagnostic crops...'); setError(''); setResult(undefined);
    for (const uri of files.current) await discardCache(uri).catch(() => {});
    files.current.clear();
    try {
      const next = await recognizePage(page, value => { if (mounted.current) setProgress(value); }, uri => {
        if (mounted.current) files.current.add(uri); else void discardCache(uri).catch(() => {});
      });
      if (mounted.current) setResult(next);
    } catch { if (mounted.current) setError('Diagnostic reading failed. Check that the saved image is aligned and available.'); }
    finally { running.current = false; if (mounted.current) setProgress(''); }
  }
  return <View><Action title={progress || 'Development: inspect saved-page OCR'} secondary disabled={!!progress} onPress={() => { void read(); }} />
    <Text style={styles.small}>Diagnostic reads leave saved values and history unchanged.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {result && <OcrDiagnostics uri={page.uri} width={page.width} height={page.height} extraction={result} />}
  </View>;
}

export function FieldResults({ extraction }: { extraction: Extraction }) {
  return <View style={{ gap: 12 }}><Text style={styles.heading}>Field readings · unverified</Text>
    {fieldKeys.map(key => <View key={key}>
      <Text style={styles.eyebrow}>{fieldLabels[key]}</Text>
      <Text selectable style={styles.body}>Proposed: {extraction.values[key] || '(blank)'}</Text>
      <Text selectable style={styles.small}>Raw field OCR: {extraction.run.fields[key].text || '(empty)'}</Text>
      {!!extraction.run.fields[key].validation && <Text style={styles.warning}>{extraction.run.fields[key].validation}</Text>}
    </View>)}
  </View>;
}
export function OcrDiagnostics({ uri, width, height, extraction }: { uri: string; width: number; height: number; extraction: Extraction }) {
  const [open, setOpen] = useState(false);
  const displayWidth = useWindowDimensions().width - 48;
  if (!TalaOcr.diagnosticsEnabled) return null;
  return <View><Action title={open ? 'Close OCR diagnostics' : 'Development: OCR diagnostics'} secondary onPress={() => setOpen(v => !v)} />
    {open && <View style={{ gap: 12 }}>
      <Text style={styles.heading}>Actual OCR inputs</Text>
      <Text style={styles.small}>Corrected source: {width} × {height}. No detection overlay is included. Crops use file pixels at sample size 1. Confidence is ML Kit’s mean element confidence, not a guarantee of correctness.</Text>
      <Image source={{ uri }} style={{ width: displayWidth, height: displayWidth * height/width }} resizeMode="contain" />
      {fieldKeys.map(key => <View key={key} style={{ gap: 8 }}>
        <Text style={styles.eyebrow}>{key}</Text>
        <Text selectable style={styles.small}>Normalized proposal: {extraction.values[key] || '(blank)'}
          {'\n'}Original normalized: {extraction.run.fields[key].originalNormalized || '(blank)'}
          {'\n'}Processed normalized: {extraction.run.fields[key].processedNormalized || '(blank)'}
          {'\n'}Validation: {extraction.run.fields[key].validation || 'Format valid; confirmation still required.'}</Text>
        {extraction.diagnostics?.[key]?.map(r => <View key={r.part} style={{ gap: 8 }}>
          <Text selectable style={styles.small}>Part {r.part + 1}: {JSON.stringify(extraction.run.fields[key].regions?.[r.part])}
            {'\n'}Pixel crop: x={r.x}, y={r.y}, {r.sourceWidth} × {r.sourceHeight}; input: {r.inputWidth} × {r.inputHeight}
            {'\n'}Original raw: {r.original.text || '(empty)'}; confidence: {r.original.confidence ?? 'unavailable'}
            {'\n'}Processed raw: {r.processed.text || '(empty)'}; confidence: {r.processed.confidence ?? 'unavailable'}
            {'\n'}Rules removed: {r.verticalLines.length} vertical, {r.horizontalLines.length} horizontal. Ink removed: {(r.removedInkFraction*100).toFixed(1)}%. Occupied cells: {r.occupiedCells.join(', ') || 'none'}.</Text>
          {(['originalCrop','processedCrop','originalInput','processedInput'] as const).map(kind => r.diagnostics[kind] && <View key={kind}>
            <Text style={styles.small}>{kind}</Text>
            <Image source={{ uri: r.diagnostics[kind] }} style={{ width: displayWidth, height: Math.min(180, displayWidth * (kind.endsWith('Input') ? r.inputHeight/r.inputWidth : r.sourceHeight/r.sourceWidth)) }} resizeMode="contain" />
          </View>)}
        </View>)}
      </View>)}
    </View>}
  </View>;
}
