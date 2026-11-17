import React from "react";
import { Image, Text, View } from "react-native";
import type { Region } from "@tala/core";
import { styles } from "./ui";

export function ReadingImage({
  uri,
  width,
  height,
  regions = [],
  onError,
}: {
  uri: string;
  width: number;
  height: number;
  regions?: readonly Region[];
  onError?: () => void;
}) {
  return (
    <View style={{ width, height }}>
      <Image
        source={{ uri }}
        style={{ width, height }}
        resizeMode="contain"
        onError={onError}
      />
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, width, height }}
      >
        {regions.map((r, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: r.x * width,
              top: r.y * height,
              width: r.width * width,
              height: r.height * height,
              borderWidth: 2,
              borderColor: "#06A98B",
              backgroundColor: "#06A98B18",
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** Same source image, clipped to the saved pixel crop; no new persistent crop files. */
export function ReadingStrip({
  uri,
  region,
  width,
  imageWidth,
  imageHeight,
}: {
  uri: string;
  region: Region;
  width: number;
  imageWidth: number;
  imageHeight: number;
}) {
  const scale = width / (region.width * imageWidth);
  const height = region.height * imageHeight * scale;
  const [failed, setFailed] = React.useState(false);
  if (failed)
    return (
      <Text style={styles.error}>
        This image could not be opened. Retake the page.
      </Text>
    );
  return (
    <View
      style={{ width, height, overflow: "hidden", backgroundColor: "#FFFFFF" }}
    >
      <Image
        source={{ uri }}
        onError={() => setFailed(true)}
        style={{
          position: "absolute",
          width: imageWidth * scale,
          height: imageHeight * scale,
          left: -region.x * imageWidth * scale,
          top: -region.y * imageHeight * scale,
        }}
      />
    </View>
  );
}
