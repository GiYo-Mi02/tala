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
    config.modResults.contents = source;
    return config;
  });
};
