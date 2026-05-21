#!/bin/bash
set -e

GDRIVE_FOLDER="gdrive:Apps/healthfam/releases"
BUILDS_DIR="$(dirname "$0")/builds"
mkdir -p "$BUILDS_DIR"

echo "🔨 EAS 빌드 시작..."
BUILD_OUTPUT=$(npx eas-cli build --platform android --profile preview --non-interactive 2>&1)
echo "$BUILD_OUTPUT"

APK_URL=$(echo "$BUILD_OUTPUT" | grep -o 'https://expo\.dev/artifacts/eas/[^ ]*\.apk' | tail -1)
if [ -z "$APK_URL" ]; then
  echo "❌ APK URL을 찾지 못했습니다."
  exit 1
fi

# 버전 추출 (package.json 기준)
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
APK_NAME="healthfam-v${VERSION}.apk"
APK_PATH="$BUILDS_DIR/$APK_NAME"

echo ""
echo "📥 APK 다운로드 중... ($APK_URL)"
curl -L -o "$APK_PATH" "$APK_URL"
echo "✅ 저장됨: builds/$APK_NAME"

echo ""
echo "☁️  Google Drive 업로드 중... ($GDRIVE_FOLDER)"
rclone copy "$APK_PATH" "$GDRIVE_FOLDER" --progress
echo "✅ 업로드 완료: $GDRIVE_FOLDER/$APK_NAME"
