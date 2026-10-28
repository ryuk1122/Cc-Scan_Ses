// iOS trial settings are separate from the Android release version.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: 'com.cedulascan.pro.ses.trial',
    buildNumber: '1',
    infoPlist: {
      ...config.ios?.infoPlist,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
});
