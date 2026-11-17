const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function validateRelease({ version, versionCode, packageVersions, lockVersions, previous, sourceFingerprint }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a numeric major.minor.patch app version.');
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('Invalid Android version code.');
  if ([...packageVersions, ...lockVersions].some(v => v !== version)) throw new Error('App, root/scanner packages, and lockfile versions must match.');
  if (previous) {
    if (!Number.isInteger(previous.versionCode)) throw new Error('The previous Android version code is missing from build evidence.');
    if (versionCode < previous.versionCode) throw new Error('Android version code cannot decrease.');
    if (versionCode === previous.versionCode) {
      if (version !== previous.appVersion || !previous.sourceFingerprint || sourceFingerprint !== previous.sourceFingerprint) {
        throw new Error('This version code was already built with different or unrecorded source. Increment the app version and Android version code.');
      }
      return 'rebuild';
    }
    const newer = version.split('.').map(Number), older = previous.appVersion.split('.').map(Number);
    const index = newer.findIndex((v, i) => v !== older[i]);
    if (index < 0 || newer[index] < older[index]) throw new Error('A new Android release must also increase the app version.');
  }
  return 'new-release';
}

function inspect(root) {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
  const config = read('apps/scanner/app.json').expo;
  const lock = read('package-lock.json');
  const files = [];
  const ignored = new Set(['node_modules', 'build', '.gradle', '.cxx', '.kotlin', 'androidTest']);
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (ignored.has(entry.name) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(file); else if (entry.isFile()) files.push(file);
    }
  }
  for (const dir of ['apps/scanner/src', 'apps/scanner/assets', 'apps/scanner/modules', 'apps/scanner/plugins', 'packages/core/src']) walk(dir);
  files.push('apps/scanner/app.json', 'apps/scanner/package.json', 'apps/scanner/index.ts', 'apps/scanner/metro.config.js', 'apps/scanner/android-toolchain.json', 'package.json', 'package-lock.json', 'packages/core/package.json', 'scripts/build-android.ps1', 'scripts/check-android-version.cjs');
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) {
    const bytes = fs.readFileSync(path.join(root, file));
    const content = bytes.includes(0) ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n');
    hash.update(file).update('\0').update(content).update('\0');
  }
  const sourceFingerprint = hash.digest('hex');
  const previousPath = path.join(root, 'docs/evidence/build-result.json');
  const previous = fs.existsSync(previousPath) ? read('docs/evidence/build-result.json') : null;
  const result = {
    version: config.version, versionCode: config.android.versionCode, sourceFingerprint,
    previousVersion: previous?.appVersion ?? null, previousVersionCode: previous?.versionCode ?? null,
  };
  result.mode = validateRelease({ ...result,
    packageVersions: [read('package.json').version, read('apps/scanner/package.json').version],
    lockVersions: [lock.version, lock.packages[''].version, lock.packages['apps/scanner'].version], previous,
  });
  return result;
}
module.exports = { validateRelease, inspect };
if (require.main === module) {
  try { console.log(JSON.stringify(inspect(path.resolve(__dirname, '..')))); }
  catch (error) { console.error(`Version check failed: ${error.message}`); process.exitCode = 1; }
}
