import { beforeEach, describe, expect, it, vi } from "vitest";
import { beefTemplate } from "@tala/core";
const mocks = vi.hoisted(() => ({ manipulate: vi.fn(), discard: vi.fn() }));
vi.mock("expo-image-manipulator", () => ({ manipulateAsync: mocks.manipulate, SaveFormat: { JPEG: "jpeg" } }));
vi.mock("./repository", () => ({ discardCache: mocks.discard }));
import { captureForAlignment, portraitCameraFrame } from "./captureSupport";

describe("Portrait camera and paper guide geometry", () => {
  it.each([[320, 500], [371, 280], [680, 1100], [300, 800]])(
    "keeps a portrait 3:4 preview and a centered BEEF guide within %i by %i available space",
    (availableWidth, availableHeight) => {
      const frame = portraitCameraFrame(availableWidth, availableHeight)!;
      expect(frame.width).toBeLessThanOrEqual(availableWidth);
      expect(frame.height).toBeLessThanOrEqual(availableHeight);
      expect(frame.width / frame.height).toBeCloseTo(3 / 4);
      expect(frame.height).toBeGreaterThan(frame.width);
      const guide = frame.guide;
      expect(guide.width / guide.height).toBeCloseTo(beefTemplate.pages[0].width / beefTemplate.pages[0].height);
      expect(guide.left).toBeGreaterThan(0);
      expect(guide.top).toBeGreaterThan(0);
      expect(guide.left * 2 + guide.width).toBeCloseTo(frame.width);
      expect(guide.top * 2 + guide.height).toBeCloseTo(frame.height);
    },
  );
  it("waits for a valid measured area instead of mounting a zero-sized camera", () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(portraitCameraFrame(value, 400)).toBeUndefined();
      expect(portraitCameraFrame(300, value)).toBeUndefined();
    }
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.manipulate.mockResolvedValue({ uri: "file:///normalized.jpg", width: 3024, height: 4032 });
  mocks.discard.mockResolvedValue(undefined);
});
describe("Camera photo handoff to paper alignment", () => {
  const take = async () => ({ uri: "file:///camera.jpg" });
  it("keeps the orientation-normalized source alive for corner selection without declaring it aligned", async () => {
    const onPhoto = vi.fn(async photo => {
      expect(photo).toEqual({ uri: "file:///normalized.jpg", width: 3024, height: 4032 });
      expect(mocks.discard).not.toHaveBeenCalledWith(photo.uri);
    });
    await captureForAlignment(take, onPhoto);
    expect(onPhoto).toHaveBeenCalledOnce();
    expect(mocks.manipulate).toHaveBeenCalledWith("file:///camera.jpg", [], { compress: 1, format: "jpeg" });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith("file:///camera.jpg");
  });
  it("cleans both candidates when the next screen cannot take ownership", async () => {
    await expect(captureForAlignment(take, async () => { throw new Error("No draft is open"); })).rejects.toThrow("No draft");
    expect(mocks.discard.mock.calls).toEqual([["file:///camera.jpg"], ["file:///normalized.jpg"]]);
  });
  it("cleans the original when orientation normalization fails and does not accept an image", async () => {
    mocks.manipulate.mockRejectedValue(new Error("Image processing failed"));
    const onPhoto = vi.fn();
    await expect(captureForAlignment(take, onPhoto)).rejects.toThrow("Image processing failed");
    expect(onPhoto).not.toHaveBeenCalled();
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith("file:///camera.jpg");
  });
  it("does not delete the handed-off image if normalization reuses the same URI", async () => {
    mocks.manipulate.mockResolvedValue({ uri: "file:///camera.jpg", width: 3024, height: 4032 });
    await captureForAlignment(take, async () => {});
    expect(mocks.discard).not.toHaveBeenCalled();
  });
  it("does not open alignment when capture returns no image", async () => {
    const onPhoto = vi.fn();
    await expect(captureForAlignment(async () => undefined, onPhoto)).rejects.toThrow("Photo capture failed");
    expect(onPhoto).not.toHaveBeenCalled();
    expect(mocks.manipulate).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});
