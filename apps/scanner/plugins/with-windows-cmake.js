const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withWindowsCmake(config) {
  return withAppBuildGradle(config, config => {
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
    config.modResults.contents = source;
    return config;
  });
};
