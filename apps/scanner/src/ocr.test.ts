import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alignedSize, beefTemplate, fieldKeys, pixelRegion, type Page } from '@tala/core';
const mocks = vi.hoisted(() => ({ manipulate: vi.fn(), recognize: vi.fn(), discard: vi.fn() }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: mocks.manipulate, SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'ocr-id' }));
vi.mock('../modules/tala-ocr', () => ({ default: { recognize: mocks.recognize } }));
vi.mock('./repository', () => ({ discardCache: mocks.discard }));
import { recognizePage } from './ocr';
const page: Page = { page: 1, uri: 'file:///private/page.jpg', ...alignedSize, imageId: 'photo', acceptedAt: 'now',
  alignment: { method: 'four-corner-v1', sourceWidth: 1060, sourceHeight: 1499, corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.manipulate.mockImplementation(async (_uri, operations) => ({ uri: 'file:///cache/crop.jpg', width: Math.round(operations[0].crop.width * 128 / operations[0].crop.height), height: 128 }));
  mocks.recognize.mockResolvedValue({ text: '', elements: [] });
  mocks.discard.mockResolvedValue(undefined);
});
describe('Scanner extraction orchestration (mocked native recognition)', () => {
  it('does not apply portrait BEEF regions to a general landscape scan', async () => {
    const landscape: Page = { ...page, width: 2400, height: 1500, alignment: {
      method: 'opencv-manual-v1', sourceWidth: 2400, sourceHeight: 1500,
      corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
    } };
    await expect(recognizePage(landscape, () => {})).rejects.toThrow(/upright BEEF/);
    expect(mocks.manipulate).not.toHaveBeenCalled(); expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it('blocks unaligned legacy pages before reading or modifying anything', async () => {
    await expect(recognizePage({ ...page, alignment: undefined }, () => {})).rejects.toThrow(/Align saved page/);
    expect(mocks.manipulate).not.toHaveBeenCalled();expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it('blocks old full-camera guide photos before cropping or native recognition', async () => {
    const guided = {
      ...page,
      width: 3024,
      height: 4032,
      alignment: { method: 'guide-v1' as const, sourceWidth: 3024, sourceHeight: 4032 },
    };
    await expect(recognizePage(guided, () => {})).rejects.toThrow(/Align saved page/);
    expect(mocks.manipulate).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it('saves exact rounded crop coordinates and reverses resized OCR coordinates correctly', async () => {
    mocks.recognize.mockResolvedValue({ text: 'RIVERA', elements: [{ text: 'RIVERA', x: 12, y: 20, width: 80, height: 30 }] });
    const { run } = await recognizePage(page, () => {});
    const index = fieldKeys.slice(0, 3).reduce((n, key) => n + beefTemplate.regions[key].length, 0);
    const crop = pixelRegion(beefTemplate.regions.learner_last_name[0], page.width, page.height);
    const resizedWidth = Math.round(crop.width * 128 / crop.height);
    expect(run.fields.learner_last_name.regions).toEqual([{x:crop.originX/page.width,y:crop.originY/page.height,width:crop.width/page.width,height:crop.height/page.height}]);
    expect(run.fields.learner_last_name.elements[0].x).toBeCloseTo((crop.originX + 12 * crop.width / resizedWidth) / page.width);
    expect(run.fields.learner_last_name.elements[0].y).toBeCloseTo((crop.originY + 20 * crop.height / 128) / page.height);
    expect(mocks.manipulate.mock.calls[index][1][0].crop).toEqual(crop);
    expect(run.pageImageId).toBe(page.imageId);
  });
  it('requests larger date-cell preparation only for birth-date crops, preserving other field scales', async () => {
    const { run } = await recognizePage(page, () => {});
    const expected = fieldKeys.flatMap(key => beefTemplate.regions[key].map(() => key === 'birth_date'));
    expect(mocks.recognize.mock.calls.map(call => call[1])).toEqual(expected);
    expect(run.preprocessing).toBe('grid-lines-v2');
  });
  it('preserves raw labels, flags the field, and leaves proposed values blank', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Last Name', elements: [] });
    const result = await recognizePage(page, () => {});
    expect(result.run.fields.learner_last_name.text).toBe('Last Name');
    expect(result.run.fields.learner_last_name.warning).toBe('label_detected');
    expect(result.values.learner_last_name).toBe('');
  });
  it('cleans the crop on native failure without altering the accepted page', async () => {
    mocks.recognize.mockRejectedValue(new Error('unreadable'));
    await expect(recognizePage(page, () => {})).rejects.toThrow('unreadable');
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith('file:///cache/crop.jpg');
    expect(mocks.discard).not.toHaveBeenCalledWith(page.uri);
  });
});
