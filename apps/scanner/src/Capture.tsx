import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { type PageNumber, type Alignment } from "@tala/core";
import { Action, colors, styles, Card } from "./ui";
import { discardCache } from "./repository";

export type Candidate = { uri: string; width: number; height: number; alignment?: Alignment };
export function Capture({
  page,
  onCancel,
  onPhoto,
}: {
  page: PageNumber;
  onCancel: () => void;
  onPhoto: (photo: Candidate) => Promise<void>;
}) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const camera = useRef<CameraView>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void getPermission().catch(() =>
          setError("Tap Allow camera to refresh permission."),
        );
    });
    return () => subscription.remove();
  }, [getPermission]);
  async function take() {
    if (!permission?.granted || !ready || busy) return;
    setBusy(true);
    setError("");
    let cameraUri: string | undefined;
    let normalizedUri: string | undefined;
    try {
      const photo = await camera.current?.takePictureAsync({
        quality: 1,
        skipProcessing: false,
      });
      if (!photo) throw new Error();
      cameraUri = photo.uri;
      // Render pixels with camera orientation applied before saving the full image.
      const normalized = await manipulateAsync(photo.uri, [], {
        compress: 1,
        format: SaveFormat.JPEG,
      });
      normalizedUri = normalized.uri;
      await onPhoto({
        ...normalized,
        alignment: {
          method: "guide-v1",
          sourceWidth: normalized.width,
          sourceHeight: normalized.height,
        },
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Photo capture failed. No image was accepted. Try again.",
      );
    } finally {
      if (cameraUri) await discardCache(cameraUri).catch(() => {});
      if (normalizedUri) await discardCache(normalizedUri).catch(() => {});
      setBusy(false);
    }
  }
  if (!permission?.granted)
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>CAPTURE - PAGE {page} OF 2</Text>
        <Text style={styles.heading}>Camera access needed</Text>
        <Card>
          <Text style={styles.body}>
            T.A.L.A. has not captured or accepted an image. Allow the camera to
            photograph both pages. If access is blocked, open Settings, then
            Permissions, then Camera. Allow access and return here.
          </Text>
          <Action
            title="Allow camera"
            onPress={() => {
              void requestPermission().catch(() =>
                setError("Open app settings to allow camera access."),
              );
            }}
          />
          <Action
            title="Open app settings"
            secondary
            onPress={() => {
              void Linking.openSettings().catch(() =>
                setError(
                  "Open Android Settings, then Apps, T.A.L.A. Pilot, Permissions, Camera.",
                ),
              );
            }}
          />
        </Card>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Action title="Cancel capture" secondary onPress={onCancel} />
      </ScrollView>
    );
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>CAPTURE · PAGE {page} OF 2</Text>
        <Text style={styles.heading}>
          {page === 1 ? "Learner information" : "Other sections & signature"}
        </Text>
        <Text style={styles.body}>
          Use a fictional printed form. Keep the page flat, upright, fully
          visible, and evenly lit. Fit the paper inside the guide; the
          complete photo will be saved without cropping.
        </Text>
      </View>
      <View
        style={{
          flex: 1,
          marginHorizontal: 20,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <CameraView
          ref={camera}
          style={{ flex: 1 }}
          facing="back"
          mode="picture"
          onCameraReady={() => setReady(true)}
          onMountError={() => {
            setReady(false);
            setError(
              "Camera could not open. Close other camera apps and retry.",
            );
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "8%",
            bottom: "8%",
            left: "8%",
            right: "8%",
            borderWidth: 2,
            borderColor: "#DDF9E5",
            borderRadius: 8,
          }}
        />
        <Text
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: "10%",
            alignSelf: "center",
            color: "#DDF9E5",
            backgroundColor: "#174A43CC",
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            fontWeight: "700",
          }}
        >
          Keep the whole page inside the guide
        </Text>
      </View>
      <View style={styles.content}>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {permission?.granted && (
          <Action
            title={busy ? "Taking photo..." : `Photograph page ${page}`}
            disabled={!ready || busy}
            onPress={() => {
              void take();
            }}
          />
        )}
        <Action
          title="Cancel capture"
          secondary
          disabled={busy}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}

export { Crop } from './Alignment';
