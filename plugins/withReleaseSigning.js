const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signs release builds with the project's own upload/release key instead of the public React Native
 * debug key (anyone holding that key could publish an "update" that installs over this app).
 *
 * The key never lives in the repository. Gradle reads it from environment variables
 * (GitHub Actions secrets, or a local shell):
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 * When they are missing, the release build falls back to the debug key and the APK must be
 * treated as a TEST build only.
 */
const MARKER = '// withReleaseSigning';

const SIGNING_CONFIG = `
        ${MARKER}
        release {
            def ksPath = System.getenv('ANDROID_KEYSTORE_PATH')
            if (ksPath) {
                storeFile file(ksPath)
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    if (!/signingConfigs \{\n/.test(src) || !/release \{\n(\s*\/\/.*\n)*\s*signingConfig signingConfigs\.debug/.test(src)) {
      throw new Error('withReleaseSigning: app/build.gradle layout changed, update the plugin.');
    }
    src = src.replace(/signingConfigs \{\n/, (m) => `${m}${SIGNING_CONFIG}\n`);
    src = src.replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      `$1signingConfig(System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug)`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
};
