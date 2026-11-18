const { withAppBuildGradle, withAndroidManifest, AndroidConfig, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withWindowsCmake(config) {
  config = withAppBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') throw new Error('T.A.L.A. expects the pinned Expo Groovy Android template.');
    let source = config.modResults.contents;
    if (!source.includes('// TALA short native paths')) {
      source = source.replace(/android\s*\{/, `android {
    // TALA short native paths: avoid Windows Ninja's 260-character object-file limit.
    externalNativeBuild {
        cmake {
            buildStagingDirectory = rootProject.file("../../../.cache/c")
        }
    }`);
      source = source.replace(/defaultConfig\s*\{/, `defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=250"
            }
        }`);
    }
    if (!source.includes('// TALA packaged ABIs')) {
      source = source.replace(/defaultConfig\s*\{/, `defaultConfig {
        // TALA packaged ABIs: match every native library to the React Native build.
        ndk {
            abiFilters.clear()
            abiFilters.addAll((findProperty('reactNativeArchitectures') ?: 'arm64-v8a,armeabi-v7a').split(','))
        }`);
    }
    if (!source.includes('// TALA shared C++ runtime')) {
      source = source.replace(/android\s*\{/, `android {
    // TALA shared C++ runtime: React Native and OpenCV both provide this library.
    packagingOptions {
        jniLibs { pickFirsts += ['**/libc++_shared.so'] }
    }`);
    }
    if (!source.includes('// TALA offline diagnostics')) {
      source = source.replace(/react\s*\{/, `react {
    // TALA offline diagnostics: native DEBUG enables diagnostics; embed JS for offline testing.
    if (findProperty('talaOfflineDebug') == 'true') { debuggableVariants = [] }`);
    }
    config.modResults.contents = source;
    return config;
  });
  config = withAndroidManifest(config, config => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/tala_network_security';
    return config;
  });
  return withDangerousMod(config, [
    'android',
    async config => {
      const xmlDirectory = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDirectory, { recursive: true });
      fs.writeFileSync(path.join(xmlDirectory, 'tala_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`);
      return config;
    },
  ]);
};
