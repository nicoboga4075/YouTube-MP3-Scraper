@echo off
chcp 65001 >nul

set "LOG_FILE=C:\yt-dlp\stdio.log"

node -v >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    node -v >> "%LOG_FILE%" 2>&1
    goto run_host
)

set "NVM_HOME=%LOCALAPPDATA%\nvm"
IF EXIST "%NVM_HOME%" (
    "%NVM_HOME%\nvm.exe" version >> "%LOG_FILE%" 2>&1
    set "FIRST_NODE_VERSION="
    for /f "tokens=1" %%v in ('dir /b /ad "%NVM_HOME%" ^| findstr /R "^[0-9]\+\.[0-9]\+\.[0-9]\+$"') do (
        set "FIRST_NODE_VERSION=%%v"
        goto :have_version
    )
    "%NVM_HOME%\nvm.exe" install 22.22.0 >nul 2>&1
    set "FIRST_NODE_VERSION=22.22.0"
)

:have_version
IF DEFINED FIRST_NODE_VERSION (
    IF EXIST "%NVM_HOME%\%FIRST_NODE_VERSION%\node.exe" (
        "%NVM_HOME%\%FIRST_NODE_VERSION%\node.exe" -v >> "%LOG_FILE%" 2>&1
        "%NVM_HOME%\%FIRST_NODE_VERSION%\npm.cmd" -v >> "%LOG_FILE%" 2>&1
        "%NVM_HOME%\%FIRST_NODE_VERSION%\node.exe" "C:\yt-dlp\host.js" 2>> "%LOG_FILE%"
        goto :end
    )
)

set "NODE_HOME=%LOCALAPPDATA%\Programs\nodejs"
IF NOT EXIST "%NODE_HOME%" ( 
	mkdir "%LOCALAPPDATA%\Programs\nodejs"
	curl -L -o "%TEMP%\node-v22.22.0-win-x64.zip" https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip
	tar -xf "%TEMP%\node-v22.22.0-win-x64.zip" -C "%LOCALAPPDATA%\Programs\nodejs" --strip-components=1
	del "%TEMP%\node-v22.22.0-win-x64.zip"
)

IF EXIST "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    "%NODE_HOME%\node.exe" -v >> "%LOG_FILE%" 2>&1
    "%NODE_HOME%\npm.cmd" -v >> "%LOG_FILE%" 2>&1
	"%NODE_HOME%\node.exe" "C:\yt-dlp\host.js" 2>> "%LOG_FILE%"
)

:run_host
node "C:\yt-dlp\host.js" 2>> "%LOG_FILE%"

:end
