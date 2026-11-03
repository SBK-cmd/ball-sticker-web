@echo off
setlocal
set "VER=1.13.29"
set "SRC=%~dp0SignTools"
set "EXT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXT%\SignTools"

echo ============================================
echo   Sign Tools installer - version %VER%
echo ============================================
echo   Running from: %~dp0
echo.

if not exist "%SRC%\CSXS\manifest.xml" (
  echo [ERROR] Cannot find the SignTools folder next to this file.
  echo Please EXTRACT the zip first, then run this file from inside the extracted folder.
  pause
  exit /b 1
)
findstr /L /C:"%VER%" "%SRC%\CSXS\manifest.xml" >nul
if errorlevel 1 (
  echo [ERROR] The SignTools folder next to this file is an OLD version.
  echo Delete old extracted folders, extract the NEW zip again, and run this file from there.
  pause
  exit /b 1
)

:checkai
tasklist /FI "IMAGENAME eq Illustrator.exe" 2>nul | find /I "Illustrator.exe" >nul
if not errorlevel 1 (
  echo [!] Illustrator is still running.
  echo     Close Illustrator completely ^(File ^> Exit^), then press any key to continue...
  pause >nul
  goto checkai
)

for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

if exist "%DEST%" rmdir /s /q "%DEST%"
if exist "%EXT%\ThaiFontPreview" (
  rmdir /s /q "%EXT%\ThaiFontPreview"
  echo  Removed old Thai Font Preview panel - it is now inside Sign Tools
)
if exist "%TEMP%\cep_cache" (
  for /d %%d in ("%TEMP%\cep_cache\*signtools*" "%TEMP%\cep_cache\*thaifontpreview*") do rmdir /s /q "%%d"
)

mkdir "%DEST%"
xcopy "%SRC%" "%DEST%" /e /i /y /q >nul

findstr /L /C:"%VER%" "%DEST%\CSXS\manifest.xml" >nul
if errorlevel 1 (
  echo [ERROR] Copy failed. Target: %DEST%
  pause
  exit /b 1
)

echo.
echo  OK - Sign Tools %VER% installed to:
echo  %DEST%
echo.
echo  Installed panels:
dir /b "%EXT%"
echo.
echo  Open Illustrator, then: Window ^> Extensions ^> Sign Tools
echo  The panel should show 6 tabs and "v%VER%" at the bottom right.
echo.
pause
