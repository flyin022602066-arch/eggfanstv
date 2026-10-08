@echo off
setlocal
set "CANVAS_DESKTOP_DATA_DIR=S:\project\eggfans beeftv\.local\EggfansTV"
set "APP_DIR=S:\project\eggfans beeftv\backend\cmd\desktop\build\bin"
if not exist "%APP_DIR%\EggfansTV.exe" (
    echo EggfansTV.exe not found: %APP_DIR%\EggfansTV.exe
    exit /b 1
)
start "" /d "%APP_DIR%" "%APP_DIR%\EggfansTV.exe"
endlocal
