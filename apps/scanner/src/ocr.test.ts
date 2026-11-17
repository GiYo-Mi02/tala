import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alignedSize, beefTemplate, pixelRegion, type Page } from '@tala/core';
const mocks = vi.hoisted(() => ({ recognize: vi.fn(), discard: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'ocr-id' }));
vi.mock('../modules/tala-ocr', () => ({ default: { recognizeField: mocks.recognize, diagnosticsEnabled: true } }));
vi.mock('./repository', () => ({ discardCache: mocks.discard }));
import { recognizePage } from './ocr';
const page: Page = { page: 1, uri: 'file:///private/page.jpg', ...alignedSize, imageId: 'photo', acceptedAt: 'now',
  alignment: { method: 'four-corner-v1', sourceWidth: 1060, sourceHeight: 1499, corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] } };
function response(json: string, original = 'RIVERA', processed = original) {
  const r = JSON.parse(json);
  const reading = (text: string) => ({ text, readingText: text, confidence: .8, elements: [{ text, x: 12, y: 4, width: 80, height: 20 }] });
  return { fieldId: r.fieldId, part: r.part, original: reading(original), processed: reading(processed),
    sourceWidth: r.width, sourceHeight: r.height, inputWidth: r.width + 64, inputHeight: r.height + 64,
    verticalLines: [], horizontalLines: [], occupiedCells: [], removedInkFraction: 0, diagnostics: {} };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.recognize.mockImplementation(async (_uri, json) => response(json));
});
describe('ROI extraction orchestration (mocked native recognition)', () => {
  it('blocks landscape and unaligned pages', async () => {
    await expect(recognizePage({ ...page, width: 2400, height: 1500, alignment: { method: 'opencv-manual-v1', sourceWidth: 2400, sourceHeight: 1500, corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] } }, () => {})).rejects.toThrow(/upright BEEF/);
    await expect(recognizePage({ ...page, alignment: undefined }, () => {})).rejects.toThrow(/Align saved page/);
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it('sends original corrected file and exact pixel ROI; maps native coordinates without resizing', async () => {
    const { run } = await recognizePage(page, () => {});
    const crop = pixelRegion(beefTemplate.regions.learner_last_name[0], page.width, page.height);
    const request = mocks.recognize.mock.calls.find(c => JSON.parse(c[1]).fieldId === 'learner_last_name')!;
    expect(request[0]).toBe(page.uri);
    expect(JSON.parse(request[1])).toMatchObject({ x: crop.originX, y: crop.originY, width: crop.width, height: crop.height, cells: 20 });
    expect(run.fields.learner_last_name.elements[0].x).toBeCloseTo((crop.originX + 12)/page.width);
    expect(run.pageImageId).toBe(page.imageId);
    expect(run.preprocessing).toBe('native-roi-v3');
  });
  it('does not fill uncertain identity fields when original and processed readings disagree', async () => {
    mocks.recognize.mockImplementation(async (_uri, json) => response(json, 'RIVERA', 'RIVERA X'));
    const { run, values } = await recognizePage(page, () => {});
    expect(values.learner_last_name).toBe('');
    expect(run.fields.learner_last_name.warning).toBe('conflicting_readings');
    expect(run.fields.learner_last_name.evidence?.[0].originalText).toBe('RIVERA');
    expect(run.fields.learner_last_name.evidence?.[0].processedText).toBe('RIVERA X');
  });
  it('flags a format-valid processed model reading when grid noise invalidates the original', async () => {
    mocks.recognize.mockImplementation(async (_uri, json) => response(json, 'R|VERA', 'RIVERA'));
    const { run, values } = await recognizePage(page, () => {});
    expect(values.learner_last_name).toBe('RIVERA');
    expect(run.fields.learner_last_name.warning).toBe('preprocessing_review');
    expect(run.fields.learner_last_name.validation).toMatch(/uncertain/);
    expect(run.fields.learner_last_name.evidence?.[0].originalText).toBe('R|VERA');
  });
  it('preserves raw printed labels and rejects them as proposed values', async () => {
    mocks.recognize.mockImplementation(async (_uri, json) => response(json, 'Last Name'));
    const { run, values } = await recognizePage(page, () => {});
    expect(run.fields.learner_last_name.text).toBe('Last Name');
    expect(run.fields.learner_last_name.warning).toBe('label_detected');
    expect(values.learner_last_name).toBe('');
  });
  it('keeps unrelated field results when a native field fails; does not leak private exception text', async () => {
    mocks.recognize.mockImplementation(async (_uri, json) => {
      if (JSON.parse(json).fieldId === 'learner_last_name') throw new Error('private path');
      return response(json);
    });
    const { run, values } = await recognizePage(page, () => {});
    expect(values.learner_last_name).toBe('');
    expect(values.learner_first_name).toBe('RIVERA');
    expect(run.fields.learner_last_name.warning).toBe('recognition_failed');
    expect(JSON.stringify(run)).not.toContain('private path');
  });
  it('retains diagnostic cache images only with an explicit owner; never serializes URIs into history', async () => {
    mocks.recognize.mockImplementation(async (_uri, json) => ({ ...response(json), diagnostics: { originalCrop: 'file:///cache/diagnostic.png' } }));
    const retain = vi.fn(); const { run, diagnostics } = await recognizePage(page, () => {}, retain);
    expect(retain).toHaveBeenCalledWith('file:///cache/diagnostic.png');
    expect(diagnostics?.learner_last_name?.[0].diagnostics.originalCrop).toContain('diagnostic');
    expect(JSON.stringify(run)).not.toContain('file:');
  });
});
