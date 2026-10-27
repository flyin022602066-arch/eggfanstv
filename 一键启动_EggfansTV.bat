@echo off
setlocal

rem Windows one-click launcher for the packaged Eggfans TV desktop app.
call "%~dp0run-eggfans-tv.cmd"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Eggfans TV failed to start. Exit code: %EXIT_CODE%
    pause
)

endlocal & exit /b %EXIT_CODE%
