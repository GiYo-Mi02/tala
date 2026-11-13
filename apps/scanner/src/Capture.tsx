import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { type PageNumber, beefTemplate } from '@tala/core';
import { Action, colors, styles, Card } from './ui';
import { discardCache } from './repository';

export type Candidate = { uri: string; width: number; height: number };
export function Capture({ page, onCancel, onPhoto }: { page: PageNumber; onCancel: () => void; onPhoto: (photo: Candidate) => void }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const camera = useRef<CameraView>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void getPermission().catch(() => setError('Tap Allow camera to refresh permission.')); });
    return () => subscription.remove();
  }, [getPermission]);
  async function take() {
    if (!permission?.granted || !ready || busy) return;
    setBusy(true); setError('');
    let cameraUri: string | undefined;
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!photo) throw new Error();
      cameraUri = photo.uri;
      // Render pixels with camera orientation applied before selecting crop coordinates.
      const normalized = await manipulateAsync(photo.uri, [], { compress: 1, format: SaveFormat.JPEG });
      onPhoto(normalized);
    } catch { setError('Photo capture failed. No image was accepted. Try again.'); }
    finally { if (cameraUri) await discardCache(cameraUri).catch(() => {}); setBusy(false); }
  }
  if (!permission?.granted) return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>CAPTURE - PAGE {page} OF 2</Text>
    <Text style={styles.heading}>Camera access needed</Text>
    <Card>
      <Text style={styles.body}>T.A.L.A. has not captured or accepted an image. Allow the camera to photograph both pages. If access is blocked, open Settings, then Permissions, then Camera. Allow access and return here.</Text>
      <Action title="Allow camera" onPress={() => { void requestPermission().catch(() => setError('Open app settings to allow camera access.')); }} />
      <Action title="Open app settings" secondary onPress={() => { void Linking.openSettings().catch(() => setError('Open Android Settings, then Apps, T.A.L.A. Pilot, Permissions, Camera.')); }} />
    </Card>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Action title="Cancel capture" secondary onPress={onCancel} />
  </ScrollView>;
  return <View style={styles.screen}>
    <View style={styles.content}>
      <Text style={styles.eyebrow}>CAPTURE · PAGE {page} OF 2</Text>
      <Text style={styles.heading}>{page === 1 ? 'Learner information' : 'Other sections & signature'}</Text>
      <Text style={styles.body}>Use a fictional printed form. Keep the page flat, upright, fully visible, and evenly lit.</Text>
    </View>
    <View style={{ flex: 1, marginHorizontal: 20, borderRadius: 16, overflow: 'hidden' }}>
      <CameraView ref={camera} style={{ flex: 1 }} facing="back" mode="picture" onCameraReady={() => setReady(true)}
        onMountError={() => { setReady(false); setError('Camera could not open. Close other camera apps and retry.'); }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: '8%', bottom: '8%', left: '8%', right: '8%', borderWidth: 2, borderColor: '#DDF9E5', borderRadius: 8 }} />
    </View>
    <View style={styles.content}>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {permission?.granted && <Action title={busy ? 'Taking photo...' : `Photograph page ${page}`} disabled={!ready || busy} onPress={() => { void take(); }} />}
      <Action title="Cancel capture" secondary disabled={busy} onPress={onCancel} />
    </View>
  </View>;
}

export function Crop({ photo, page, busy, onCancel, onAccept }: { photo: Candidate; page: PageNumber; busy: boolean; onCancel: () => void; onAccept: (photo: Candidate) => Promise<void> }) {
  const [image, setImage] = useState(photo);
  const [box, setBox] = useState({ left: 0, top: 0, right: 1, bottom: 1 });
  const [corner, setCorner] = useState<'start' | 'end'>('start');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const rotatedUris = useRef<string[]>([]);
  useEffect(() => () => { for (const uri of rotatedUris.current) void discardCache(uri).catch(() => {}); }, []);
  const window = useWindowDimensions();
  const factor = Math.min((window.width - 40) / image.width, (window.height * 0.48) / image.height);
  const w = image.width * factor; const h = image.height * factor;
  async function rotate() {
    setWorking(true); setError('');
    try {
      const rotated = await manipulateAsync(image.uri, [{ rotate: 90 }], { compress: 1, format: SaveFormat.JPEG });
      rotatedUris.current.push(rotated.uri);
      if (image.uri !== photo.uri) await discardCache(image.uri);
      setImage(rotated); setBox({ left: 0, top: 0, right: 1, bottom: 1 });
    } catch { setError('Could not rotate the photo. Try again.'); }
    finally { setWorking(false); }
  }
  async function accept() {
    setWorking(true); setError('');
    let result: Candidate | undefined;
    try {
      const originX = Math.floor(box.left * image.width), originY = Math.floor(box.top * image.height);
      const width = Math.floor((box.right - box.left) * image.width), height = Math.floor((box.bottom - box.top) * image.height);
      const target = beefTemplate.pages[page - 1];
      if (Math.abs(width / height / (target.width / target.height) - 1) > 0.09) throw new Error('Crop all four edges of the upright paper. The selected area does not match this page shape.');
      if (width < 700 || height < 950) throw new Error('This crop is too small for reliable field reading. Retake closer, keeping the entire page in view.');
      result = await manipulateAsync(image.uri, [{ crop: { originX, originY, width, height } }, { resize: { width: 1600 } }], { compress: 0.95, format: SaveFormat.JPEG });
      await onAccept(result);
      if (image.uri !== photo.uri) await discardCache(image.uri);
      await discardCache(photo.uri);
    } catch (e) { setError(e instanceof Error ? e.message : 'Image save failed. Try again.'); }
    finally { if (result) await discardCache(result.uri); setWorking(false); }
  }
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>ALIGN & CROP · PAGE {page}</Text>
    <Text style={styles.heading}>Keep the whole paper</Text>
    <Text style={styles.body}>Rotate until upright. Select a corner below, then tap that paper corner in the photo. Keep all printed boxes inside. Retake if the paper is slanted or blurred.</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" onPress={() => setCorner('start')}><Text style={{ color: corner === 'start' ? colors.teal : colors.muted, fontWeight: '700', padding: 10 }}>1. Top left</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setCorner('end')}><Text style={{ color: corner === 'end' ? colors.teal : colors.muted, fontWeight: '700', padding: 10 }}>2. Bottom right</Text></Pressable>
    </View>
    <Pressable accessibilityLabel={`Set ${corner === 'start' ? 'top left' : 'bottom right'} crop corner`} disabled={working || busy}
      style={{ width: w, height: h, alignSelf: 'center', backgroundColor: '#CCD8D3' }} onPress={e => {
        const x = Math.max(0, Math.min(1, e.nativeEvent.locationX / w)), y = Math.max(0, Math.min(1, e.nativeEvent.locationY / h));
        setBox(b => corner === 'start' ? { ...b, left: Math.min(x, b.right - 0.15), top: Math.min(y, b.bottom - 0.15) } : { ...b, right: Math.max(x, b.left + 0.15), bottom: Math.max(y, b.top + 0.15) });
        if (corner === 'start') setCorner('end');
      }}>
      <View pointerEvents="none"><Image source={{ uri: image.uri }} style={{ width: w, height: h }} /></View>
      <View pointerEvents="none" style={{ position: 'absolute', left: box.left * w, top: box.top * h, width: (box.right - box.left) * w, height: (box.bottom - box.top) * h, borderWidth: 3, borderColor: '#06A98B', backgroundColor: '#0C937710' }} />
    </Pressable>
    <Action title="Rotate 90°" secondary disabled={working || busy} onPress={() => { void rotate(); }} />
    <Action title="Reset crop to full photo" secondary disabled={working || busy} onPress={() => setBox({ left: 0, top: 0, right: 1, bottom: 1 })} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Action title={working || busy ? 'Saving accepted page...' : `Accept page ${page}`} disabled={working || busy} onPress={() => { void accept(); }} />
    <Action title="Discard photo & retake" secondary disabled={working || busy} onPress={() => { if (image.uri !== photo.uri) void discardCache(image.uri); void discardCache(photo.uri); onCancel(); }} />
  </ScrollView>;
}
