#!/bin/sh
# ใช้: ./build.sh 1.13.9  → ตั้งเวอร์ชันทุกไฟล์ให้ตรงกัน แล้วสร้าง zip
set -e
V="$1"; [ -n "$V" ] || { echo "usage: build.sh X.Y.Z"; exit 1; }
cd "$(dirname "$0")"
sed -i -E "s/ExtensionBundleVersion=\"[0-9.]+\"/ExtensionBundleVersion=\"$V\"/; s/(<Extension Id=\"com.ballsticker.signtools.panel\" Version=\")[0-9.]+/\1$V/" SignTools/CSXS/manifest.xml
sed -i -E "s/^set \"VER=[0-9.]+\"/set \"VER=$V\"/" install-windows.bat
sed -i -E "s/Sign Tools [0-9]+\.[0-9]+\.[0-9]+ installed/Sign Tools $V installed/" install-mac.command
grep -q "ExtensionBundleVersion=\"$V\"" SignTools/CSXS/manifest.xml && grep -q "VER=$V" install-windows.bat && grep -q "Tools $V installed" install-mac.command || { echo "version sync failed"; exit 1; }
rm -f "SignTools-v$V.zip"; zip -qrX "SignTools-v$V.zip" SignTools README.txt install-mac.command install-windows.bat
echo "built SignTools-v$V.zip"
