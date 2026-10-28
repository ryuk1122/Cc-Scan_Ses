#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=1
export EXPO_NO_TELEMETRY=1
export EXPO_PUBLIC_BACKEND_URL=https://cc-scan-ses.onrender.com
cat modules/cedula-scanner/ios/MrzCandidates.swift scripts/test-ios-mrz.swift > /tmp/cedulascan-ios-mrz.swift
swift /tmp/cedulascan-ios-mrz.swift
# This is a device build. An iOS Simulator .app cannot be installed on an iPhone.
VENDOR=modules/cedula-scanner/ios/vendor/zxing
if [ ! -d "$VENDOR/.git" ]; then
  git clone --depth 1 --branch v2.2.1 https://github.com/zxing-cpp/zxing-cpp.git "$VENDOR"
fi
cp "$VENDOR/LICENSE" modules/cedula-scanner/ios/ZXING-LICENSE.txt
npx expo prebuild --platform ios --no-install
cd ios
pod install
SCHEME=$(node -p "require('../app.json').expo.name.replace(/[^a-zA-Z0-9]/g, '')")
mkdir -p build
if ! xcodebuild -workspace "$SCHEME.xcworkspace" -scheme "$SCHEME" \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' build > build/ios-build.log 2>&1; then
  node -e 'const fs=require("fs");const a=fs.readFileSync("build/ios-build.log","utf8").split("\n");console.error(a.filter(x=>/ error:|fatal error:|BUILD FAILED/.test(x)).slice(0,80).join("\n"));console.error(a.slice(-35).join("\n"));'
  exit 1
fi
echo 'iPhone Release build succeeded'
APP="build/Build/Products/Release-iphoneos/$SCHEME.app"
test -d "$APP"
test -f "$APP/main.jsbundle"
mkdir -p ../ios-trial/Payload
cp -R "$APP" ../ios-trial/Payload/
cp ../modules/cedula-scanner/ios/ZXING-LICENSE.txt ../ios-trial/
cd ../ios-trial
zip -qry CedulaScan-Pro-iOS-Prueba.ipa Payload
shasum -a 256 CedulaScan-Pro-iOS-Prueba.ipa > SHA256SUMS.txt
rm -rf Payload
