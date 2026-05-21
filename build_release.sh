#!/bin/bash
set -e

GDRIVE_FOLDER="gdrive:Apps/healthfam/releases"
BUILDS_DIR="$(dirname "$0")/builds"
mkdir -p "$BUILDS_DIR"

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
APK_NAME="healthfam-v${VERSION}.apk"
APK_PATH="$BUILDS_DIR/$APK_NAME"

echo "🔧 네이티브 Android 코드 생성 중..."
npx expo prebuild --platform android --clean 2>&1 | tail -5

echo ""
echo "🔨 로컬 Gradle 빌드 중..."
export ANDROID_SDK_ROOT=~/Library/Android/sdk
cd android && ./gradlew assembleRelease 2>&1 | tail -5
cd ..

echo ""
echo "📦 APK 저장 중..."
cp android/app/build/outputs/apk/release/app-release.apk "$APK_PATH"
echo "✅ 저장됨: builds/$APK_NAME"

echo ""
echo "☁️  Google Drive 업로드 중..."
rclone copy "$APK_PATH" "$GDRIVE_FOLDER" --progress
echo "✅ 업로드 완료: $GDRIVE_FOLDER/$APK_NAME"
