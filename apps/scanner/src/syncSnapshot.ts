import {
  activeFixedFields, fieldKeys, fixedReadiness, readinessProblems, type Draft, type FixedDraft, type RawField, type Region,
} from '@tala/core';

export type AcceptedDraft = Draft | FixedDraft;
type Evidence = {
  original: string;
  imageId: string;
  runId: string;
  engine: string;
  regions?: Region[];
  confidence?: number | null;
  warning?: string;
};
type ConfirmedField = { key: string; mobileValue: string; confirmed: true; ocr: Evidence | null };
export type SyncSnapshot = {
  create: { clientSubmissionId: string; templateId: string; templateVersion: number; capturedAt: string };
  pages: { number: number; imageId: string; uri: string }[];
  fields: { fields: ConfirmedField[] };
};

function fixed(draft: AcceptedDraft): draft is FixedDraft {
  return 'kind' in draft && draft.kind === 'fixed-template-draft-v1';
}

function singleCropConfidence(field: RawField): number | null | undefined {
  if (field.evidence?.length !== 1 || (field.regions?.length ?? 1) !== 1) return undefined;
  const part = field.evidence[0];
  const originalMatches = part.originalText.trim() === field.text && part.originalReading.trim() === field.readingText;
  const processedMatches = part.processedText.trim() === field.text && part.processedReading.trim() === field.readingText;
  if (originalMatches && processedMatches) {
    return part.originalConfidence === part.processedConfidence ? part.originalConfidence : undefined;
  }
  if (originalMatches) return part.originalConfidence;
  if (processedMatches) return part.processedConfidence;
}

function beefFields(draft: Draft): ConfirmedField[] {
  const imageId = draft.pages[1]!.imageId;
  const run = [...draft.ocrHistory].reverse().find(item => item.pageImageId === imageId);
  return fieldKeys.map(key => {
    const field = run?.fields[key];
    const ocr = field && run ? {
      original: field.text, imageId, runId: run.id, engine: run.engine,
      regions: field.regions, confidence: singleCropConfidence(field), warning: field.warning,
    } : null;
    return { key, mobileValue: draft.values[key], confirmed: true, ocr };
  });
}

function fixedFields(draft: FixedDraft): ConfirmedField[] {
  const history = [...draft.history].reverse();
  return activeFixedFields(draft).map(field => {
    const image = draft.pages[field.page];
    const run = field.mode === 'ocr' && image && history.find(item =>
      item.page === field.page && item.pageImageId === image.imageId &&
      item.templateId === draft.templateId && item.templateVersion === draft.templateVersion,
    );
    const reading = run ? run.fields[field.id] : undefined;
    const evidence = reading && run && reading.pageImageId === run.pageImageId && reading.fieldId === field.id
      ? { original: reading.text, imageId: run.pageImageId, runId: run.id, engine: run.engine,
          confidence: reading.confidence, regions: [reading.region], warning: reading.warning ?? reading.error }
      : null;
    return { key: field.id, mobileValue: draft.values[field.id], confirmed: true, ocr: evidence };
  });
}

export function makeSyncSnapshot(draft: AcceptedDraft): SyncSnapshot {
  const isFixed = fixed(draft);
  const problems = isFixed ? fixedReadiness(draft) : readinessProblems(draft);
  if (draft.state !== 'ready' || problems.length) {
    throw new Error('Save the reviewed draft with every required page and confirmed field before submitting.');
  }
  const first = draft.pages[1]!;
  const capturedAt = new Date(first.acceptedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new Error('The first page has no valid saved date. Accept the page again.');
  const additional = isFixed ? draft.values.sss_additional_sheet_used === 'Yes' : true;
  const pageNumbers = isFixed ? (additional ? [1, 3] : [1]) : [1, 2];
  const pages = pageNumbers.map(number => {
    const page = (draft.pages as Record<number, typeof first | undefined>)[number]!;
    return { number, uri: page.uri, imageId: page.imageId };
  });
  return {
    create: { clientSubmissionId: draft.id, templateId: draft.templateId,
      templateVersion: draft.templateVersion, capturedAt: capturedAt.toISOString() },
    pages,
    fields: { fields: isFixed ? fixedFields(draft) : beefFields(draft) },
  };
}
