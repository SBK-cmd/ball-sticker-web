# Sign Tools for CorelDRAW — ตัวติดตั้ง: คัดลอกลงโฟลเดอร์ Addons ของ CorelDRAW ทุกเวอร์ชันที่พบในเครื่อง
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
function Msg($t, $icon = 'Information') { [System.Windows.Forms.MessageBox]::Show($t, 'Sign Tools for CorelDRAW', 'OK', $icon) | Out-Null }

# ต้องใช้สิทธิ์ผู้ดูแล (เขียนลง Program Files)
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
$pkg = Split-Path -Parent (Split-Path -Parent $PSCommandPath)     # โฟลเดอร์ SignTools ที่แตกจาก zip
$addon = Join-Path $pkg '_addon'

if (Get-Process -Name CorelDRW, CorelDRW64 -ErrorAction SilentlyContinue) {
  Msg "ปิด CorelDRAW ก่อน แล้วกดตกลงเพื่อติดตั้งต่อ" 'Warning'
  if (Get-Process -Name CorelDRW -ErrorAction SilentlyContinue) { Msg "CorelDRAW ยังเปิดอยู่ — ติดตั้งไม่ได้" 'Error'; exit 1 }
}

# หา CorelDRAW ทุกเวอร์ชัน: ...\Corel\<ชุดโปรแกรม>\Programs64 (64 บิต) / Programs (32 บิต)
$roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432) | Where-Object { $_ } | Select-Object -Unique
$targets = @()
foreach ($r in $roots) {
  $c = Join-Path $r 'Corel'
  if (-not (Test-Path $c)) { continue }
  foreach ($suite in Get-ChildItem $c -Directory) {
    foreach ($p in 'Programs64', 'Programs') {
      $d = Join-Path $suite.FullName $p
      if (Test-Path (Join-Path $d 'CorelDRW.exe')) { $targets += $d }
    }
  }
}
# ตำแหน่งจากรีจิสทรี (กรณีติดตั้งไว้ที่อื่น)
foreach ($k in 'HKLM:\SOFTWARE\Corel\CorelDRAW', 'HKLM:\SOFTWARE\WOW6432Node\Corel\CorelDRAW') {
  if (-not (Test-Path $k)) { continue }
  foreach ($v in Get-ChildItem $k) {
    try { $dir = (Get-ItemProperty $v.PSPath -Name ProgramsDir -ErrorAction Stop).ProgramsDir } catch { $dir = $null }
    if ($dir -and (Test-Path (Join-Path $dir 'CorelDRW.exe'))) { $targets += $dir.TrimEnd('\') }
  }
}
$targets = $targets | Select-Object -Unique
if (-not $targets) { Msg "ไม่พบ CorelDRAW ในเครื่องนี้" 'Error'; exit 1 }

$done = @()
foreach ($t in $targets) {
  $dst = Join-Path $t 'Addons\SignTools'
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $addon '*') -Destination $dst -Recurse -Force -Exclude 'install-corel.ps1'
  $app = Join-Path $dst 'app'
  if (Test-Path $app) { Remove-Item $app -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  Get-ChildItem $pkg -Force | Where-Object { $_.Name -notin '_addon', 'install-corel.bat' } | ForEach-Object { Copy-Item $_.FullName -Destination $app -Recurse -Force }
  $done += $t
}

# WebView2 Runtime (Windows 11 มีอยู่แล้ว · Windows 10 ส่วนใหญ่มีจาก Edge)
$wv = $false
foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') {
  try { $pv = (Get-ItemProperty $k -Name pv -ErrorAction Stop).pv; if ($pv -and $pv -ne '0.0.0.0') { $wv = $true } } catch { }
}
$list = ($done | ForEach-Object { '• ' + $_ }) -join "`n"
if (-not $wv) {
  Msg "ติดตั้ง Sign Tools แล้ว:`n$list`n`nเครื่องนี้ยังไม่มี Microsoft Edge WebView2 Runtime — จะเปิดหน้าดาวน์โหลดให้ ติดตั้งแล้วค่อยเปิด CorelDRAW" 'Warning'
  Start-Process 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
} else {
  Msg "ติดตั้ง Sign Tools แล้ว:`n$list`n`nเปิด CorelDRAW แล้วไปที่ Window › Dockers › Sign Tools"
}
