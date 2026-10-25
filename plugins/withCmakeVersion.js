const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Pins the CMake used for React Native's C++ codegen. CMake 3.22.1 (the AGP default) ships
 * ninja 1.10, which fails on Windows with "Filename longer than 260 characters" even when
 * LongPathsEnabled is on; CMake 3.31 ships ninja 1.12 with long-path support.
 */
module.exports = function withCmakeVersion(config, { version = '3.31.6' } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    const marker = '// withCmakeVersion';
    if (!cfg.modResults.contents.includes(marker)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /^android \{\n/m,
        `android {\n    ${marker}\n    externalNativeBuild { cmake { version "${version}" } }\n`,
      );
    }
    return cfg;
  });
};
