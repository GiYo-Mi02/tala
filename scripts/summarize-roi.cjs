// Replay captured native ML Kit outputs through the actual TypeScript field policy.
// This does not run OCR: native inputs/results are produced by FieldRoiTest offline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
async function main() {
  const root = path.resolve(__dirname, '..');
  process.chdir(root);
  const rows = JSON.parse(fs.readFileSync('docs/evidence/roi-comparison.json', 'utf8'));
  await esbuild.build({ entryPoints: ['apps/scanner/src/ocr.ts'], outfile: '.cache/roi-replay.cjs', bundle: true, platform: 'node',
    plugins: [{ name: 'captured-native-readings', setup(build) {
      build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: 'crypto', namespace: 'fixture' }));
      build.onResolve({ filter: /modules\/tala-ocr$/ }, () => ({ path: 'native', namespace: 'fixture' }));
      build.onResolve({ filter: /^\.\/repository$/ }, () => ({ path: 'repository', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'crypto'
        ? 'export const randomUUID = () => "evidence-replay";'
        : args.path === 'repository' ? 'export const discardCache = async () => {};'
        : 'export default { diagnosticsEnabled: false, recognizeField: async (_, json) => globalThis.talaCapturedReading(JSON.parse(json)) };' }));
    } }] });
  const { recognizePage } = require(path.join(root, '.cache/roi-replay.cjs'));
  const comparisons = [];
  for (const asset of [...new Set(rows.map(r => r.asset))]) {
    const records = rows.filter(r => r.asset === asset);
    globalThis.talaCapturedReading = request => {
      const part = records.find(r => r.fieldId === request.fieldId).parts[request.part];
      return { ...part, diagnostics: {} };
    };
    const result = await recognizePage({ page: 1, uri: 'file:///native-test/corrected.png', imageId: asset,
      width: 1060, height: 1499, acceptedAt: 'native-test', alignment: { method: 'opencv-manual-v1',
        sourceWidth: 1060, sourceHeight: 1499, corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] } }, () => {});
    comparisons.push({ asset, sha256: crypto.createHash('sha256').update(fs.readFileSync(
      `apps/scanner/modules/tala-ocr/android/src/androidTest/assets/${asset}`)).digest('hex'), fields: records.map(r => {
      const expected = r.fieldId === 'birth_date' ? '2012-02-29' : r.expected;
      const field = result.run.fields[r.fieldId];
      const proposed = result.values[r.fieldId];
      return { fieldId: r.fieldId, expected, original: field.originalNormalized, processed: field.processedNormalized,
        proposed, status: proposed === expected ? 'correct' : proposed === '' ? 'missing' : 'incorrect',
        warning: field.warning ?? null, validation: field.validation ?? null,
        oldNativeParts: r.oldParts, sourceRegions: field.regions };
    }) });
  }
  fs.writeFileSync('docs/evidence/roi-field-results.json', JSON.stringify({
    scope: 'Two immutable digital images of the same fictional enrollment form, upright orientation. Not the phone screenshot or a physical camera accuracy test.',
    engine: 'Bundled ML Kit Latin 16.0.1', comparisons,
  }, null, 2) + '\n');
  if (comparisons.some(row => row.fields.some(f => f.status !== 'correct'))) process.exitCode = 1;
  for (const row of comparisons) {
    console.log(row.asset, row.fields.filter(f => f.status === 'correct').length + '/7 correct');
    row.fields.forEach(f => console.log(f.fieldId, JSON.stringify(f.expected), '=>', JSON.stringify(f.proposed), f.status, f.warning || ''));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
