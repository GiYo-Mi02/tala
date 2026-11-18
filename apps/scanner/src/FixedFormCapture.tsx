import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FixedPage, FixedTemplate } from '@tala/core';
import * as Crypto from 'expo-crypto';
import TalaOcr from '../modules/tala-ocr';
import { scannerConfig, type NativeScan, type Candidate } from './captureSupport';
import { Crop } from './Alignment';
import { ReadingImage } from './ReadingImage';
import { discardCache } from './repository';
import { Action, styles } from './ui';

type Review = { photo: Candidate; source: Candidate; layoutAligned: boolean; canUse: boolean; warning?: string };

export function FixedFormCapture({ template, pageNumber, savedPage, onAccept, onCancel }: {
  template: FixedTemplate;
  pageNumber: 1 | 3;
  savedPage?: FixedPage;
  onAccept: (page: FixedPage, readFields: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [review, setReview] = useState<Review>();
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showRegions, setShowRegions] = useState(true);
  const mounted = useRef(true);
  const started = useRef(false);
  const operation = useRef(false);
  const owned = useRef(new Set<string>());
  const close = useRef(onCancel);
  close.current = onCancel;
  const width = useWindowDimensions().width - 40;
  const slot = template.pages.find(p => p.number === pageNumber)!;
  const regions = template.fields.filter(f => f.page === pageNumber && f.mode === 'ocr' && f.region).map(f => f.region!);

  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void open(savedPage);
    }
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!operation.current && !busy) {
        if (manual) setManual(false); else close.current();
      }
      return true;
    });
    return () => listener.remove();
  }, [busy, manual, savedPage]);

  useEffect(() => () => {
    mounted.current = false;
    for (const uri of owned.current) void discardCache(uri).catch(() => {});
  }, []);

  async function release(uri: string) {
    await discardCache(uri).catch(() => {});
    owned.current.delete(uri);
  }

  async function open(existing?: FixedPage) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError('');
    setProgress(existing ? 'Finding the printed E-1 layout...' : 'Opening scanner...');
    try {
      let original: Candidate;
      let cropped: Candidate | undefined;
      let warning: string | undefined;
      let canUse = true;
      const keep = new Set<string>();
      if (existing) {
        original = existing;
      } else {
        const result = await TalaOcr.scanDocument(JSON.stringify(scannerConfig));
        if (!result) {
          if (mounted.current && !review) close.current();
          return;
        }
        const scan = JSON.parse(result) as NativeScan;
        original = scan.source;
        // A bad automatic crop can be recovered from the full photo. The native
        // quality check still blocks a dark or blank source image.
        canUse = scan.allowManual !== false || scan.diagnostic?.stage === 'content';
        warning = canUse ? scan.warning : scan.reason;
        for (const uri of [scan.rawUri, scan.source.uri, scan.processed?.uri]) {
          if (uri) { owned.current.add(uri); keep.add(uri); }
        }
        if (scan.processed && scan.corners) {
          cropped = { ...scan.processed, alignment: {
            method: 'opencv-auto-v1', sourceWidth: original.width, sourceHeight: original.height,
            corners: scan.corners, confidence: scan.confidence,
          } };
        }
      }
      for (const uri of owned.current) if (!mounted.current || !keep.has(uri)) await release(uri);
      if (!mounted.current) return;
      setProgress('Finding the printed E-1 layout...');
      setImageFailed(false); setZoom(1); setShowRegions(true);
      let aligned: Candidate | undefined;
      if (canUse) {
        // Retry on the paper crop when the form was a small part of the camera frame.
        for (const input of [original, cropped]) {
          if (!input || !mounted.current) continue;
          try {
            const match = await TalaOcr.registerSssPage(input.uri, pageNumber);
            if (!match) continue;
            if (!mounted.current) { await discardCache(match.uri); return; }
            owned.current.add(match.uri);
            aligned = { ...match, alignment: input.alignment ?? {
              method: 'guide-v1', sourceWidth: input.width, sourceHeight: input.height,
            } };
            break;
          } catch {
            // The photo is still available for manual frame alignment or entry.
          }
        }
      }
      if (!mounted.current) return;
      const photo = aligned ?? original;
      setReview({ photo, source: original, layoutAligned: !!aligned, canUse, warning });
      for (const uri of owned.current) if (uri !== photo.uri && uri !== original.uri) await release(uri);
    } catch {
      if (mounted.current) setError('The scanner could not open this photo. Try again.');
    } finally {
      operation.current = false;
      if (mounted.current) { setBusy(false); setProgress(''); }
    }
  }

  async function accept(readFields: boolean) {
    if (!review?.canUse || imageFailed || operation.current || (readFields && !review.layoutAligned)) return;
    const { photo } = review;
    operation.current = true;
    setBusy(true); setError('');
    setProgress(readFields ? 'Reading E-1 fields and saving...' : 'Saving photo...');
    try {
      await onAccept({
        ...photo, page: pageNumber, imageId: Crypto.randomUUID(), acceptedAt: new Date().toISOString(),
        alignment: photo.alignment ?? { method: 'guide-v1', sourceWidth: photo.width, sourceHeight: photo.height },
        layout: review.layoutAligned ? 'sss-print-v1' : undefined,
      }, readFields);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'This image could not be saved. Retry.');
    } finally {
      operation.current = false;
      if (mounted.current) { setBusy(false); setProgress(''); }
    }
  }

  if (manual && review) {
    return <SafeAreaView style={styles.screen}><Crop
      photo={review.source} page={pageNumber} busy={busy} showReadingRegions={false} retainSource transferAccepted
      printedFrame={{
        description: 'In the photo, mark the four corners of the large printed frame. Use the top rule above ?PART I? and the bottom rule of the last SSS table. Start at the top left, then go clockwise. Rotate if needed.',
        rectify: (uri, corners) => TalaOcr.rectifySssFrame(uri, pageNumber, corners),
      }}
      onCancel={() => setManual(false)} onWorkingChange={setBusy}
      onAccept={async photo => {
        owned.current.add(photo.uri);
        setReview({ photo, source: review.source, layoutAligned: true, canUse: true });
        setManual(false); setImageFailed(false); setZoom(1); setShowRegions(true); setError('');
        if (review.photo.uri !== review.source.uri) await release(review.photo.uri);
      }}
    /></SafeAreaView>;
  }

  return <SafeAreaView style={styles.screen}><ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>SSS E-1 ? PAGE {pageNumber}</Text>
    <Text style={styles.heading}>{slot.label}</Text>
    {!!progress && <View style={styles.row}><ActivityIndicator/><Text accessibilityLiveRegion="polite" style={styles.body}>{progress}</Text></View>}
    {review && <>
      <View style={styles.row}>
        <Action title="? Zoom" secondary disabled={busy || zoom <= 1} onPress={() => setZoom(z => z - .5)} />
        <Text style={styles.small}>{Math.round(zoom * 100)}%</Text>
        <Action title="+ Zoom" secondary disabled={busy || zoom >= 3} onPress={() => setZoom(z => z + .5)} />
      </View>
      <ScrollView horizontal>
        <ReadingImage key={review.photo.uri} uri={review.photo.uri} width={width * zoom}
          height={width * zoom * review.photo.height / review.photo.width}
          regions={review.layoutAligned && showRegions ? regions : []}
          onError={() => setImageFailed(true)} />
      </ScrollView>
      {review.layoutAligned && <Action title={showRegions ? 'Hide answer boxes' : 'Show answer boxes'} secondary onPress={() => setShowRegions(v => !v)} />}
      <Text style={styles.body}>{review.layoutAligned
        ? 'Zoom in to check the text. Read fields when the green boxes cover the printed answers.'
        : review.canUse ? 'The printed layout could not be matched. Align the printed frame on this photo, or save it for manual entry if the full form is readable.' : 'Capture a readable photo of the complete form.'}</Text>
      {review.layoutAligned && review.photo.width < 950 && <Text style={styles.warning}>Small text may need manual correction. Review the values after reading.</Text>}
      {!!review.warning && <Text style={styles.warning}>{review.warning}</Text>}
    </>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {imageFailed && <Text style={styles.error}>This image could not be opened. Retake it.</Text>}
    {review?.layoutAligned && <Action title="Read aligned fields" disabled={busy || imageFailed} onPress={() => { void accept(true); }}/>}
    {review?.canUse && <>
      <Action title="Align printed frame" secondary disabled={busy || imageFailed} onPress={() => { setError(''); setManual(true); }}/>
      <Action title="Save photo for manual entry" secondary disabled={busy || imageFailed} onPress={() => { void accept(false); }}/>
    </>}
    <Action title="Retake" secondary disabled={busy} onPress={() => { void open(); }}/>
    <Action title="Cancel capture" secondary disabled={busy} onPress={onCancel}/>
  </ScrollView></SafeAreaView>;
}
