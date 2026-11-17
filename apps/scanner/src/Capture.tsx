import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type PageNumber } from "@tala/core";
import { Action, styles, Card } from "./ui";
import {
  captureForAlignment,
  portraitCameraFrame,
  type Candidate,
} from "./captureSupport";

export type { Candidate } from "./captureSupport";
export function Capture({
  page,
  onCancel,
  onPhoto,
  onWorkingChange,
}: {
  page: PageNumber;
  onCancel: () => void;
  onPhoto: (photo: Candidate) => Promise<void>;
  onWorkingChange: (busy: boolean) => void;
}) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const frame = portraitCameraFrame(space.width, space.height);
  const camera = useRef<CameraView>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void getPermission().catch(() =>
          setError("Tap Allow camera to refresh permission."),
        );
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [getPermission]);
  async function take() {
    if (!permission?.granted || !ready || busy) return;
    setBusy(true);
    onWorkingChange(true);
    setError("");
    try {
      await captureForAlignment(
        async () => camera.current?.takePictureAsync({ quality: 1, skipProcessing: false }),
        onPhoto,
      );
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Photo capture failed. No image was accepted. Try again.",
        );
    } finally {
      if (mounted.current) setBusy(false);
      onWorkingChange(false);
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
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 6 }}>
        <Text style={styles.eyebrow}>CAPTURE - PAGE {page} OF 2</Text>
        <Text style={styles.heading}>
          {page === 1 ? "Learner information" : "Other sections & signature"}
        </Text>
        <Text style={styles.body}>
          Hold the phone upright. Fit the whole fictional form inside the guide.
          Next, mark its four paper corners to place the reading areas correctly.
        </Text>
      </View>
      <View
        style={{
          flex: 1,
          marginHorizontal: 20,
          alignItems: "center",
          justifyContent: "center",
        }}
        onLayout={({ nativeEvent: { layout } }) => setSpace({ width: layout.width, height: layout.height })}
      >
        {frame && (
          <View
            style={{ width: frame.width, height: frame.height, borderRadius: 16,
              overflow: "hidden", backgroundColor: "#172B29" }}
          >
            <CameraView
              ref={camera}
              style={{ flex: 1 }}
              facing="back"
              mode="picture"
              ratio="4:3"
              onCameraReady={() => setReady(true)}
              onMountError={() => {
                setReady(false);
                setError("Camera could not open. Close other camera apps and retry.");
              }}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                ...frame.guide,
                borderWidth: 2,
                borderColor: "#DDF9E5",
                borderRadius: 2,
              }}
            />
          </View>
        )}
      </View>
      <View style={{ padding: 20, paddingBottom: 16, gap: 8 }}>
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
