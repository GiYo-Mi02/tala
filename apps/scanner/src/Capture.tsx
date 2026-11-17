import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { beefTemplate, type PageNumber } from '@tala/core';
import TalaOcr from '../modules/tala-ocr';
import { Crop } from './Alignment';
import { ReadingImage } from './ReadingImage';
import { recognizePage } from './ocr';
import { discardCache } from './repository';
import { Action, styles } from './ui';
import { matchesBeefLayout, scannerConfig, stagedPage, type Candidate, type NativeScan, type PreparedScan } from './captureSupport';
export type { Candidate } from './captureSupport';
export { Crop } from './Alignment';

export function Capture({ page, onCancel, onPhoto, onWorkingChange }: {
  page: PageNumber; onCancel: () => void; onPhoto: (photo: PreparedScan) => Promise<void>; onWorkingChange: (busy: boolean) => void;
}) {
  const [scan, setScan] = useState<NativeScan | null>(null);
  const [prepared, setPrepared] = useState<PreparedScan | null>(null);
  const [phase, setPhase] = useState<'processing' | 'review' | 'manual'>('processing');
  const [progress, setProgress] = useState('Opening scanner…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  const [showText, setShowText] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const started = useRef(false);
  const owned = useRef(new Set<string>());
  const callbacks = useRef({ onCancel, onWorkingChange });
  callbacks.current = { onCancel, onWorkingChange };
  const window = useWindowDimensions();
  useEffect(() => {
    mounted.current = true;
    if (!started.current) { started.current = true; void openScanner(); }
    return () => {
      mounted.current = false;
      for (const uri of owned.current) void discardCache(uri).catch(() => {});
    };
  }, []);
  async function process(candidate: Candidate, warning?: string) {
    owned.current.add(candidate.uri);
    if (!mounted.current) { await discardCache(candidate.uri); return; }
    setPhase('processing'); setProgress('Reading document offline…'); setFailedImage(false); setError('');
    const result: PreparedScan = { ...candidate, imageId: Crypto.randomUUID(), warning };
    try {
      const full = await TalaOcr.recognizeDocument(candidate.uri);
      result.documentOcr = { ...full, at: new Date().toISOString(), engine: 'mlkit-bundled-latin-16.0.1' };
      if (!full.text.trim()) result.warning = 'No readable text was found. Retake a clearer image or continue with manual verification.';
      if (page === 1 && matchesBeefLayout(full.text, candidate.width, candidate.height)) {
        result.extraction = await recognizePage(stagedPage(result, page), value => { if (mounted.current) setProgress(value); });
      } else if (page === 1) {
        result.warning = full.text.trim()
          ? 'The scan is available, but this page was not identified as the upright BEEF layout. Its text is below; verify the seven BEEF fields manually or retake the matching form.'
          : 'No text was found. Retake a clearer image or continue and enter the fields manually.';
      }
    } catch {
      result.warning = 'OCR did not finish. The scan is available; retake or continue with manual verification.';
    }
    if (mounted.current) { setPrepared(result); setPhase('review'); }
    else for (const uri of owned.current) await discardCache(uri).catch(() => {});
  }
  async function openScanner() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); callbacks.current.onWorkingChange(true);
    setPhase('processing'); setProgress('Opening scanner…'); setError('');
    try {
      // Keep the previous candidate until a replacement has actually returned.
      const serialized = await TalaOcr.scanDocument(JSON.stringify(scannerConfig));
      if (!serialized) {
        if (!mounted.current) return;
        if (scan) setPhase('review'); else callbacks.current.onCancel();
        return;
      }
      const next = JSON.parse(serialized) as NativeScan;
      for (const uri of [next.rawUri, next.source.uri, next.processed?.uri]) if (uri) owned.current.add(uri);
      if (!mounted.current) { for (const uri of owned.current) await discardCache(uri).catch(() => {}); return; }
      const keep = new Set([next.rawUri, next.source.uri, next.processed?.uri]);
      for (const uri of owned.current) if (!keep.has(uri)) { await discardCache(uri).catch(() => {}); owned.current.delete(uri); }
      setScan(next); setPrepared(null); setFailedImage(false); setShowText(false);
      if (next.processed && next.corners && typeof next.confidence === 'number') {
        await process({ ...next.processed, alignment: { method: 'opencv-auto-v1', sourceWidth: next.source.width,
          sourceHeight: next.source.height, corners: next.corners, confidence: next.confidence } }, next.warning);
      } else { setPhase('review'); setError(next.reason ?? 'No reliable crop. Retake or optionally adjust the corners.'); }
    } catch (e) {
      if (mounted.current) { setPhase('review'); setError(e instanceof Error ? e.message : 'The scanner could not open. Try again.'); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      callbacks.current.onWorkingChange(false);
    }
  }
  async function accept() {
    if (!prepared || inFlight.current) return;
    inFlight.current = true; setBusy(true); onWorkingChange(true); setError('');
    try { await onPhoto(prepared); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'The scan was not saved. Retry.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); onWorkingChange(false); }
  }
  if (phase === 'manual' && scan) return <Crop photo={scan.source} page={page} busy={busy}
    retainSource transferAccepted showReadingRegions={false} suggestedCorners={scan.suggestedCorners ?? scan.corners}
    onWorkingChange={onWorkingChange} onCancel={() => setPhase('review')}
    onAccept={async candidate => {
      owned.current.add(candidate.uri);
      await process(candidate);
    }} />;
  if (phase === 'processing') return <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 }]}>
    <ActivityIndicator size="large" /><Text accessibilityLiveRegion="polite" style={styles.heading}>{progress}</Text>
    <Text style={styles.body}>Processing on this phone.</Text>
  </View>;
  const image = prepared ?? scan?.source;
  const width = window.width - 40;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>REVIEW SCAN · PAGE {page} OF 2</Text>
    <Text style={styles.heading}>{prepared ? 'Check your scanned page' : 'Check the captured photo'}</Text>
    {image && <ReadingImage uri={image.uri} width={width} height={width * image.height / image.width}
      regions={prepared?.extraction && page === 1 ? Object.values(beefTemplate.regions).flat() : []}
      onError={() => setFailedImage(true)} />}
    {prepared && <Text style={styles.body}>Check that the whole paper is visible and upright. Continue to verify the extracted information.</Text>}
    {!!prepared?.warning && <Text style={styles.warning}>{prepared.warning}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {failedImage && <Text style={styles.error}>This image could not be opened. Retake it.</Text>}
    <Action title={busy ? 'Saving…' : 'Continue'} disabled={busy || !prepared || failedImage} onPress={() => { void accept(); }} />
    <Action title="Retake" secondary disabled={busy} onPress={() => { void openScanner(); }} />
    {scan && <Action title="Adjust Crop" secondary disabled={busy} onPress={() => setPhase('manual')} />}
    {!!prepared?.documentOcr && <>
      <Action title={showText ? 'Hide extracted text' : 'View extracted text'} secondary onPress={() => setShowText(value => !value)} />
      {showText && <Text selectable style={styles.body}>{prepared.documentOcr.text || 'No readable text found.'}</Text>}
    </>}
    <Action title="Cancel scan" secondary disabled={busy} onPress={onCancel} />
  </ScrollView>;
}
