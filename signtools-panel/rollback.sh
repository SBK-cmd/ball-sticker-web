#!/usr/bin/env bash
# สร้างแพ็กเกจถอยกลับจากฐานเสถียร โดยไม่ checkout/reset หรือปล่อยรุ่น
set -Eeuo pipefail
export LC_ALL=C

STABLE_COMMIT='eb32bcd8baa9c1c4ae7834ad4fa58100324f9046'
STABLE_VERSION='1.13.48'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

usage() {
  cat <<'HELP'
ใช้: ./rollback.sh NEW_VERSION --current HIGHEST_VERSION [--out DIRECTORY] [--dry-run]
ตัวอย่าง: ./rollback.sh 1.13.59 --current 1.13.58

NEW_VERSION ต้องสูงกว่าเวอร์ชันสูงสุดที่ติดตั้งหรือปล่อยอยู่จริง (ตรวจเองก่อน)
ฐานถูกล็อกไว้ที่โค้ด 1.13.48 / eb32bcd ไม่รับ --from เพื่อกันเลือกฐานผิด
--dry-run ตรวจอินพุต/ฐาน/เครื่องมือเท่านั้น ไม่สร้างไฟล์และไม่ใช่ผลทดสอบแผง
สคริปต์ไม่อ่าน Worker ไม่อัปโหลด ไม่ deploy ไม่เปลี่ยนสาขา และไม่แก้ข้อมูลใบงาน
ต้องใช้ Linux/WSL, Bash, Git, Python 3, Node.js, GNU sed, zip และ tar
HELP
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# -gt 0 ]] || { usage >&2; exit 2; }
case "$1" in -h|--help) usage; exit 0 ;; -*) fail "ต้องใส่ NEW_VERSION ก่อนตัวเลือก" ;; esac
NEW_VERSION="$1"; shift
CURRENT_VERSION=''; OUT_DIR="$SCRIPT_DIR/rollback-output"; DRY_RUN=0
SEEN_CURRENT=0; SEEN_OUT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --current)
      [[ $# -ge 2 && "$2" != -* && $SEEN_CURRENT -eq 0 ]] || fail "--current ต้องมีค่าและใช้ได้ครั้งเดียว"
      CURRENT_VERSION="$2"; SEEN_CURRENT=1; shift 2 ;;
    --out)
      [[ $# -ge 2 && -n "$2" && "$2" != -* && $SEEN_OUT -eq 0 ]] || fail "--out ต้องมีค่าและใช้ได้ครั้งเดียว"
      OUT_DIR="$2"; SEEN_OUT=1; shift 2 ;;
    --dry-run) [[ $DRY_RUN -eq 0 ]] || fail "--dry-run ซ้ำ"; DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "ไม่รู้จักตัวเลือก: $1" ;;
  esac
done
[[ -n "$CURRENT_VERSION" ]] || fail "ต้องระบุ --current เป็นเลขสูงสุดที่ใช้อยู่/ปล่อยอยู่จริง"
for cmd in git python3 node sed zip tar mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || fail "ไม่พบเครื่องมือ: $cmd"
done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || fail "ต้องใช้ Python 3.9 ขึ้นไป"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || fail "ตัวจำลองต้องใช้ Node.js 18 ขึ้นไป"
sed --version >/dev/null 2>&1 || fail "build.sh เดิมต้องใช้ GNU sed — ให้รันบน Linux/WSL"
python3 - "$NEW_VERSION" "$CURRENT_VERSION" "$STABLE_VERSION" <<'PY'
import re, sys
pattern = r'(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})'
values = sys.argv[1:]
if any(not re.fullmatch(pattern, v) for v in values):
    sys.exit('ERROR: เวอร์ชันต้องเป็น X.Y.Z จำนวนเต็ม ไม่มีเลขศูนย์นำหน้า (แต่ละส่วนไม่เกิน 9 หลัก)')
new, current, stable = [tuple(map(int, v.split('.'))) for v in values]
if new <= current or new <= stable:
    sys.exit('ERROR: NEW_VERSION ต้องสูงกว่าทั้ง --current และฐานเสถียร')
PY
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)" || fail "ต้องรันสคริปต์ที่อยู่ใน Git repository นี้"
RESOLVED="$(git -C "$REPO_ROOT" rev-parse --verify "$STABLE_COMMIT^{commit}")" || fail "ไม่พบ commit ฐานเสถียร ให้ git fetch origin ก่อน"
[[ "$RESOLVED" == "$STABLE_COMMIT" ]] || fail "commit ฐานเสถียรไม่ตรง"
BASE_MANIFEST="$(git -C "$REPO_ROOT" show "$STABLE_COMMIT:signtools-panel/SignTools/CSXS/manifest.xml")"
[[ "$BASE_MANIFEST" == *"ExtensionBundleVersion=\"$STABLE_VERSION\""* ]] || fail "เวอร์ชันฐานไม่ตรง"
[[ -f "$SCRIPT_DIR/tests/panel-smoke.cjs" ]] || fail "ไม่พบ tests/panel-smoke.cjs ห้ามข้ามเทสต์ก่อนสร้าง ZIP"
OUT_DIR="$(python3 - "$OUT_DIR" <<'PY'
import os, sys
print(os.path.realpath(sys.argv[1]))
PY
)"
FINAL_DIR="$OUT_DIR/rollback-v$NEW_VERSION"
[[ ! -e "$FINAL_DIR" && ! -L "$FINAL_DIR" ]] || fail "มีผลลัพธ์รุ่นนี้แล้ว ไม่เขียนทับ: $FINAL_DIR"
# กันเอาต์พุตไปทับต้นฉบับหรือปะปนกับแพ็กเกจที่กำลังพัฒนา
case "$OUT_DIR/" in
  "$REPO_ROOT/signtools-panel/SignTools/"*|"$REPO_ROOT/signtools-worker/"*|"$REPO_ROOT/.git/"*)
    fail "ห้ามวางผลลัพธ์ในแผง, Worker หรือ .git" ;;
esac
printf 'ฐาน: %s (%s)\nปัจจุบันที่ผู้ใช้ระบุ: %s\nรุ่นถอยกลับใหม่: %s\nผลลัพธ์: %s\n' \
  "$STABLE_VERSION" "$STABLE_COMMIT" "$CURRENT_VERSION" "$NEW_VERSION" "$FINAL_DIR"
if [[ $DRY_RUN -eq 1 ]]; then
  printf 'DRY RUN ผ่าน — ยังไม่ได้สร้าง ZIP/รันเทสต์/ตรวจเวอร์ชันบนเซิร์ฟเวอร์\n'
  exit 0
fi

WORK_DIR=''; STAGE_DIR=''; LOCK_DIR=''
cleanup() {
  [[ -z "$WORK_DIR" ]] || rm -rf -- "$WORK_DIR"
  [[ -z "$STAGE_DIR" ]] || rm -rf -- "$STAGE_DIR"
  [[ -z "$LOCK_DIR" ]] || rmdir -- "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p -- "$OUT_DIR"
# ล็อกทั้งปลายทาง กันสองคำสั่งสร้างเลขรุ่นเดียวกันและเขียนทับกัน
LOCK_CANDIDATE="$OUT_DIR/.rollback.lock"
mkdir -- "$LOCK_CANDIDATE" 2>/dev/null || fail "ปลายทางถูกล็อก: $LOCK_CANDIDATE (ตรวจว่าไม่มีงานกำลังรันก่อนลบล็อกเอง)"
LOCK_DIR="$LOCK_CANDIDATE"
[[ ! -e "$FINAL_DIR" && ! -L "$FINAL_DIR" ]] || fail "มีผลลัพธ์รุ่นนี้แล้ว ไม่เขียนทับ"
# กันใช้เลขต่ำกว่าหรือเท่ากับแพ็กเกจที่เคยสร้างไว้ในปลายทางนี้
python3 - "$OUT_DIR" "$NEW_VERSION" <<'PY'
import pathlib, re, sys
root, new = pathlib.Path(sys.argv[1]), tuple(map(int, sys.argv[2].split('.')))
for item in root.iterdir():
    m = re.fullmatch(r'rollback-v([0-9]+\.[0-9]+\.[0-9]+)', item.name)
    if m and tuple(map(int, m[1].split('.'))) >= new:
        sys.exit('ERROR: มีแพ็กเกจเลขเท่ากันหรือสูงกว่าในปลายทางแล้ว: ' + item.name)
PY
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/signtools-rollback.XXXXXXXX")"
STAGE_DIR="$(mktemp -d "$OUT_DIR/.rollback-stage.XXXXXXXX")"
printf 'ดึงโค้ดฐานเสถียร (ไม่ใช้ไฟล์ใน working tree)...\n'
git -C "$REPO_ROOT" archive "$STABLE_COMMIT" signtools-panel | tar -xf - -C "$WORK_DIR"
BUILD_DIR="$WORK_DIR/signtools-panel"
# build.sh ดั้งเดิมเปลี่ยนเฉพาะเลขรุ่นใน manifest และตัวติดตั้งสองไฟล์
bash "$BUILD_DIR/build.sh" "$NEW_VERSION"
ZIP_FILE="$BUILD_DIR/SignTools-v$NEW_VERSION.zip"
[[ -s "$ZIP_FILE" ]] || fail "สร้าง ZIP ไม่สำเร็จ"

# เทียบทุกไบต์ของ ZIP กับ Git ฐานเสถียร อนุญาตเฉพาะการเปลี่ยนเลขรุ่น 3 ไฟล์
python3 - "$REPO_ROOT" "$STABLE_COMMIT" "$STABLE_VERSION" "$NEW_VERSION" "$ZIP_FILE" "$WORK_DIR/unpacked" "$STAGE_DIR" "$CURRENT_VERSION" <<'PY'
import datetime, hashlib, json, pathlib, re, stat, subprocess, sys, zipfile
repo, commit, old, new, zip_path, unpack_dir, stage_dir, current = sys.argv[1:]
entries = subprocess.check_output(['git', '-C', repo, 'ls-tree', '-r', '-z', commit, '--', 'signtools-panel/'])
expected, modes = {}, {}
for item in entries.split(b'\0'):
    if not item:
        continue
    meta, name = item.split(b'\t', 1)
    mode, kind, oid = meta.decode().split()
    rel = name.decode().removeprefix('signtools-panel/')
    if rel.startswith('SignTools/') or rel in ('README.txt', 'install-mac.command', 'install-windows.bat'):
        if kind != 'blob' or mode not in ('100644', '100755'):
            sys.exit('ERROR: ฐานมีไฟล์ชนิดที่ไม่อนุญาต: ' + rel)
        expected[rel] = subprocess.check_output(['git', '-C', repo, 'cat-file', 'blob', oid])
        modes[rel] = mode
manifest = 'SignTools/CSXS/manifest.xml'
text = expected[manifest].decode('utf-8')
text, a = re.subn(r'ExtensionBundleVersion="[0-9.]+"', f'ExtensionBundleVersion="{new}"', text)
text, b = re.subn(r'(<Extension Id="com\.ballsticker\.signtools\.panel" Version=")[0-9.]+', lambda m: m[1] + new, text)
if (a, b) != (1, 1):
    sys.exit('ERROR: รูปแบบเวอร์ชัน manifest ฐานผิดปกติ')
expected[manifest] = text.encode('utf-8')
win = 'install-windows.bat'
expected[win], count = re.subn(rb'^set "VER=[0-9.]+"', ('set "VER=' + new + '"').encode(), expected[win], flags=re.M)
if count != 1:
    sys.exit('ERROR: รูปแบบเวอร์ชันตัวติดตั้ง Windows ผิดปกติ')
mac = 'install-mac.command'
expected[mac], count = re.subn(rb'Sign Tools [0-9]+\.[0-9]+\.[0-9]+ installed', ('Sign Tools ' + new + ' installed').encode(), expected[mac])
if count != 1:
    sys.exit('ERROR: รูปแบบเวอร์ชันตัวติดตั้ง Mac ผิดปกติ')
actual_hashes = {}
with zipfile.ZipFile(zip_path) as z:
    bad = z.testzip()
    if bad:
        sys.exit('ERROR: ZIP CRC เสีย: ' + bad)
    names = [i.filename for i in z.infolist()]
    if len(names) != len(set(names)):
        sys.exit('ERROR: ZIP มีชื่อไฟล์ซ้ำ')
    for info in z.infolist():
        p = pathlib.PurePosixPath(info.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in info.filename or stat.S_ISLNK(info.external_attr >> 16):
            sys.exit('ERROR: ZIP มี path/ชนิดไฟล์ที่ไม่ปลอดภัย: ' + info.filename)
        if info.is_dir() and not any(n.startswith(info.filename) for n in expected):
            sys.exit('ERROR: ZIP มีโฟลเดอร์เกินจากฐาน: ' + info.filename)
    files = {i.filename for i in z.infolist() if not i.is_dir()}
    if files != set(expected):
        sys.exit('ERROR: ไฟล์ ZIP ไม่ตรงกับฐาน: ' + repr(sorted(files ^ set(expected))))
    for rel, data in expected.items():
        actual = z.read(rel)
        if actual != data:
            sys.exit('ERROR: โค้ดเปลี่ยนเกินเลขรุ่นที่อนุญาต: ' + rel)
        if modes[rel] == '100755' and not (z.getinfo(rel).external_attr >> 16) & stat.S_IXUSR:
            sys.exit('ERROR: สิทธิ์ executable หาย: ' + rel)
        actual_hashes[rel] = hashlib.sha256(actual).hexdigest()
    z.extractall(unpack_dir)
sha = hashlib.sha256(pathlib.Path(zip_path).read_bytes()).hexdigest()
stage = pathlib.Path(stage_dir)
name = pathlib.Path(zip_path).name
(stage / (name + '.sha256')).write_text(sha + '  ' + name + '\n', encoding='utf-8')
metadata = {
    'release_version': new, 'highest_version_supplied': current,
    'stable_version': old, 'stable_commit': commit, 'channel': 'beta-only',
    'uploaded': False, 'server_version_checked': False,
    'created_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'zip_file': name, 'sha256': sha, 'size_bytes': pathlib.Path(zip_path).stat().st_size,
    'checks': {'zip_crc': 'passed', 'all_release_files_compared_to_stable_git': 'passed',
               'only_version_metadata_changed': 'passed', 'panel_simulator': 'pending',
               'illustrator': 'not-tested', 'graphtec': 'not-tested', 'nas': 'not-tested'},
    'release_file_count': len(expected), 'release_file_sha256': actual_hashes,
}
(stage / 'rollback.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
notes = (f'เบต้า {new}: ถอยโค้ดแผงกลับฐานเสถียร {old} ({commit[:7]}) โดยเพิ่มเลขรุ่นเพื่อให้ระบบอัปเดตได้ '
         'ไม่มีฟีเจอร์ใหม่ ไม่เปลี่ยน Worker/ฐานข้อมูล/ใบงาน ต้องลองปุ่ม ② และตัดจริงใน Illustrator ก่อนทำงานถัดไป '
         'ห้ามปล่อยให้ลูกค้า ยังไม่ได้ทดสอบบนเครื่องจริง\n')
(stage / 'release-notes.txt').write_text(notes, encoding='utf-8')
print(f'ตรวจ ZIP ผ่าน: {len(expected)} ไฟล์ เทียบตรงฐานทั้งหมด ยกเว้นเลขรุ่น 3 ไฟล์')
PY
printf 'รันตัวจำลองแผงจาก ZIP ที่แตกแล้ว...\n'
node "$SCRIPT_DIR/tests/panel-smoke.cjs" "$WORK_DIR/unpacked" "$NEW_VERSION" > "$STAGE_DIR/panel-smoke.log" 2>&1 || {
  cat "$STAGE_DIR/panel-smoke.log" >&2
  fail "ตัวจำลองแผงไม่ผ่าน — ไม่ส่งแพ็กเกจออก"
}
cat "$STAGE_DIR/panel-smoke.log"
python3 - "$STAGE_DIR/rollback.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
data = json.loads(p.read_text(encoding='utf-8'))
data['checks']['panel_simulator'] = 'passed (mock DOM/CEP, not Illustrator)'
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PY
cp -- "$ZIP_FILE" "$STAGE_DIR/"
# อยู่ filesystem เดียวกัน จึงส่งโฟลเดอร์ผลลัพธ์ทีเดียวเมื่อผ่านทุกเทสต์
[[ ! -e "$FINAL_DIR" && ! -L "$FINAL_DIR" ]] || fail "ปลายทางรุ่นนี้ถูกสร้างระหว่างทำงาน ไม่เขียนทับ"
mv -T -- "$STAGE_DIR" "$FINAL_DIR"
STAGE_DIR=''
printf '\nสำเร็จ: %s/SignTools-v%s.zip\n' "$FINAL_DIR" "$NEW_VERSION"
printf 'ยังไม่ได้อัปโหลด/ปล่อยรุ่น และยังไม่ได้ทดสอบ Illustrator, Graphtec หรือ NAS จริง\n'
