/**
 * Dynamic part of the Expo config (static values stay in app.json).
 * ANDROID_VERSION_CODE lets CI give every build a higher versionCode, so a newer APK installs
 * over the old one; Android refuses updates whose versionCode is not greater.
 */
module.exports = ({ config }) => {
  const versionCode = Number(process.env.ANDROID_VERSION_CODE);
  return {
    ...config,
    android: {
      ...config.android,
      versionCode: Number.isInteger(versionCode) && versionCode > 0 ? versionCode : 1,
    },
  };
};
