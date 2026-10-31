#!/bin/bash
# ประกอบแผงสำหรับ CorelDRAW จากซอร์สแผง Illustrator: ./build-app.sh <panel-src-dir> <version>
set -e
SRC=${1:?panel src}; VER=${2:?version}; HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/app
rm -rf "$OUT"; mkdir -p "$OUT/CSXS" "$OUT/corel"
cp -r "$SRC/index.html" "$SRC/css" "$SRC/js" "$OUT/"; [ -d "$SRC/icons" ] && cp -r "$SRC/icons" "$OUT/" || true
[ -d "$SRC/img" ] && cp -r "$SRC/img" "$OUT/" || true
[ -d "$SRC/fonts" ] && cp -r "$SRC/fonts" "$OUT/" || true
cp "$HERE/web/shim.js" "$HERE/web/buffer.js" "$HERE/web/corel.css" "$OUT/corel/"
cat > "$OUT/CSXS/manifest.xml" <<M
<?xml version="1.0" encoding="UTF-8"?>
<!-- Sign Tools for CorelDRAW — ไฟล์นี้ใช้บอกเวอร์ชันเท่านั้น -->
<ExtensionManifest ExtensionBundleId="th.co.ballsticker.signtools.corel" ExtensionBundleVersion="$VER" Version="1.0" />
M
python3 - "$OUT" <<'PY'
import sys, re, os, glob
out = sys.argv[1]
p = os.path.join(out, 'index.html'); s = open(p, encoding='utf8').read()
s = s.replace('<script src="js/config.js"></script>',
  '<script src="corel/buffer.js"></script>\n<script src="corel/shim.js"></script>\n<script src="js/config.js"></script>\n'
  '<script>ST_CONFIG.product = \'cdr\'; ST_CONFIG.dataSub = \'\\\\Corel\';</script>', 1)
s = s.replace('</head>', '<link rel="stylesheet" href="corel/corel.css">\n</head>', 1)
s = s.replace('<section id="tab-home" class="pane active">', '<section id="tab-home" class="pane active">\n  <div class="corelsoon">CorelDRAW เวอร์ชันแรก: ใช้ได้เฉพาะ <b>ส่งตัด</b> ก่อน · เครื่องมืออื่นกำลังทยอยเปิด</div>', 1)
assert 'corel/shim.js' in s
for f in [p] + glob.glob(os.path.join(out, 'js', '*.js')):
    t = s if f == p else open(f, encoding='utf8').read()
    t = t.replace('Illustrator', 'CorelDRAW')
    open(f, 'w', encoding='utf8').write(t)
PY
# ลบสิ่งที่ใช้เฉพาะ Illustrator
rm -f "$OUT/js/fonts.js.map"
echo "app $VER → $OUT"
