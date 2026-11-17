import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import {
  alignmentProblem,
  beefTemplate,
  type Corners,
  type PageNumber,
  type Point,
} from "@tala/core";
import type { Candidate } from "./Capture";
import TalaOcr from "../modules/tala-ocr";
import { discardCache } from "./repository";
import { ReadingImage } from "./ReadingImage";
import { Action, colors, styles } from "./ui";

const labels = ["Top left", "Top right", "Bottom right", "Bottom left"];
const initialCorners = (): Corners => [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];
export function Crop({
  photo,
  page,
  busy,
  savedPhoto = false,
  onCancel,
  onAccept,
  onWorkingChange,
}: {
  photo: Candidate;
  page: PageNumber;
  busy: boolean;
  savedPhoto?: boolean;
  onCancel: () => void;
  onAccept: (photo: Candidate) => Promise<void>;
  onWorkingChange: (busy: boolean) => void;
}) {
  const [image, setImage] = useState(photo);
  const [corners, setCorners] = useState<Corners>(initialCorners);
  const [selected, setSelected] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<Candidate | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const temporary = useRef(new Set([photo.uri]));
  const mounted = useRef(true);
  useEffect(() => {
    const files = temporary.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const uri of files) void discardCache(uri).catch(() => {});
    };
  }, []);
  const window = useWindowDimensions();
  const factor = Math.min(
    (window.width - 40) / image.width,
    (window.height * 0.5) / image.height,
  );
  const w = image.width * factor,
    h = image.height * factor;
  const blocked = busy || working;
  function start() {
    setWorking(true);
    onWorkingChange(true);
    setError("");
  }
  function finish() {
    if (mounted.current) {
      setWorking(false);
      onWorkingChange(false);
    }
  }
  async function rotate() {
    start();
    try {
      const rotated = await manipulateAsync(image.uri, [{ rotate: 90 }], {
        compress: 1,
        format: SaveFormat.JPEG,
      });
      if (!mounted.current) {
        await discardCache(rotated.uri);
        return;
      }
      temporary.current.add(rotated.uri);
      setImage(rotated);
      setCorners(initialCorners());
      setSelected([]);
      setActive(0);
      setImageFailed(false);
    } catch {
      if (mounted.current) setError("Could not rotate the photo. Try again.");
    } finally {
      finish();
    }
  }
  function move(point: Point) {
    setCorners(
      (previous) =>
        previous.map((p, i) => (i === active ? point : p)) as Corners,
    );
    setSelected((previous) =>
      previous.includes(active) ? previous : [...previous, active],
    );
  }
  async function straighten() {
    start();
    try {
      const problem = alignmentProblem(corners, image.width, image.height);
      if (problem) throw new Error(problem);
      const result = await TalaOcr.rectify(image.uri, corners);
      if (!mounted.current) {
        await discardCache(result.uri);
        return;
      }
      temporary.current.add(result.uri);
      setPreview({
        ...result,
        alignment: {
          method: "four-corner-v1",
          sourceWidth: image.width,
          sourceHeight: image.height,
          corners,
        },
      });
      setZoom(1);
      setImageFailed(false);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "This photo could not be aligned. Adjust the corners or retake it.",
        );
    } finally {
      finish();
    }
  }
  async function accept() {
    if (!preview) return;
    start();
    try {
      await onAccept(preview);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Image save failed. The previous page is still saved. Try again.",
        );
    } finally {
      finish();
    }
  }
  return (
    <ScrollView key={preview?.uri ?? image.uri} style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>ALIGN PAGE {page}</Text>
      <Text style={styles.heading}>
        {preview
          ? "Check the straightened page"
          : "Mark all four paper corners"}
      </Text>
      <Text style={styles.body}>
        {preview
          ? page === 1
            ? "The green areas must cover the answer boxes, below the printed labels. Adjust the corners if they do not. This pilot reads only the supplied BEEF layout."
            : "Check that the whole page is upright and no content is cut off."
          : "Rotate until upright. Choose each corner below, then tap that paper corner in the photo. Use the arrow buttons to fine-tune it. Keep the whole paper visible."}
      </Text>
      {preview ? (
        <>
          <View style={styles.row}>
            <Action
              title="− Zoom"
              secondary
              disabled={blocked || zoom <= 1}
              onPress={() => setZoom((z) => z - 0.5)}
            />
            <Text style={styles.small}>{Math.round(zoom * 100)}%</Text>
            <Action
              title="+ Zoom"
              secondary
              disabled={blocked || zoom >= 3}
              onPress={() => setZoom((z) => z + 0.5)}
            />
          </View>
          <ScrollView horizontal>
            <ReadingImage
              uri={preview.uri}
              width={(window.width - 40) * zoom}
              height={
                ((window.width - 40) * zoom * preview.height) / preview.width
              }
              regions={
                page === 1 ? Object.values(beefTemplate.regions).flat() : []
              }
              onError={() => setImageFailed(true)}
            />
          </ScrollView>
          <Action
            title="Adjust corners"
            secondary
            disabled={blocked}
            onPress={() => {
              void discardCache(preview.uri).catch(() => {});
              temporary.current.delete(preview.uri);
              setPreview(null);
              setImageFailed(false);
              setError("");
            }}
          />
          <Action
            title={
              blocked
                ? "Saving accepted page..."
                : `Accept aligned page ${page}`
            }
            disabled={blocked || imageFailed}
            onPress={() => {
              void accept();
            }}
          />
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {labels.map((label, i) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{
                  selected: active === i,
                  disabled: blocked,
                }}
                disabled={blocked}
                onPress={() => setActive(i)}
                style={{
                  padding: 12,
                  minHeight: 48,
                  backgroundColor: active === i ? colors.mint : "#FFFFFF",
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: colors.teal }}>
                  {i + 1}. {label}
                  {selected.includes(i) ? " ✓" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Place ${labels[active].toLowerCase()} paper corner`}
            disabled={blocked || imageFailed}
            style={{
              width: w,
              height: h,
              alignSelf: "center",
              backgroundColor: "#CCD8D3",
            }}
            onPress={(e) => {
              move({
                x: Math.max(0, Math.min(1, e.nativeEvent.locationX / w)),
                y: Math.max(0, Math.min(1, e.nativeEvent.locationY / h)),
              });
            }}
          >
            <View pointerEvents="none">
              <Image
                source={{ uri: image.uri }}
                onError={() => setImageFailed(true)}
                style={{ width: w, height: h }}
              />
            </View>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: w,
                height: h,
              }}
            >
              {corners.map((p, i) => {
                const q = corners[(i + 1) % 4],
                  dx = (q.x - p.x) * w,
                  dy = (q.y - p.y) * h,
                  length = Math.hypot(dx, dy);
                return (
                  <React.Fragment key={i}>
                    <View
                      style={{
                        position: "absolute",
                        left: ((p.x + q.x) * w) / 2 - length / 2,
                        top: ((p.y + q.y) * h) / 2,
                        width: length,
                        height: 2,
                        backgroundColor: "#06A98B",
                        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                      }}
                    />
                    <View
                      style={{
                        position: "absolute",
                        left: p.x * w - 12,
                        top: p.y * h - 12,
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active === i ? colors.teal : "#FFFFFF",
                        borderColor: colors.teal,
                        borderWidth: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: active === i ? "#FFFFFF" : colors.teal,
                          fontWeight: "800",
                        }}
                      >
                        {i + 1}
                      </Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          </Pressable>
          <Text style={styles.small}>
            Fine-tune {labels[active].toLowerCase()} (2 source pixels per tap)
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              ["← Left", -2 / image.width, 0],
              ["Right →", 2 / image.width, 0],
              ["↑ Up", 0, -2 / image.height],
              ["Down ↓", 0, 2 / image.height],
            ].map(([label, dx, dy]) => (
              <Action
                key={label}
                title={String(label)}
                secondary
                disabled={blocked || imageFailed}
                onPress={() =>
                  move({
                    x: Math.max(0, Math.min(1, corners[active].x + Number(dx))),
                    y: Math.max(0, Math.min(1, corners[active].y + Number(dy))),
                  })
                }
              />
            ))}
          </View>
          <Action
            title="Rotate 90°"
            secondary
            disabled={blocked || imageFailed}
            onPress={() => {
              void rotate();
            }}
          />
          <Action
            title="Reset corners"
            secondary
            disabled={blocked}
            onPress={() => {
              setCorners(initialCorners());
              setSelected([]);
              setActive(0);
              setError("");
            }}
          />
          <Action
            title={blocked ? "Straightening page..." : "Straighten & preview"}
            disabled={blocked || selected.length !== 4 || imageFailed}
            onPress={() => {
              void straighten();
            }}
          />
        </>
      )}
      {imageFailed && (
        <Text style={styles.error}>
          This photo could not be opened. Retake the page.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        title={savedPhoto ? "Cancel alignment" : "Discard photo & retake"}
        secondary
        disabled={blocked}
        onPress={onCancel}
      />
    </ScrollView>
  );
}
