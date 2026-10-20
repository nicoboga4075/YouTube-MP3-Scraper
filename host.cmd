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
    set "LTS_NODE_VERSION=22.23.3"
    IF NOT EXIST "%NVM_HOME%\22.23.3\node.exe" "%NVM_HOME%\nvm.exe" install 22.23.3 >nul 2>&1
)

IF DEFINED LTS_NODE_VERSION (
    IF EXIST "%NVM_HOME%\%LTS_NODE_VERSION%\node.exe" (
        "%NVM_HOME%\%LTS_NODE_VERSION%\node.exe" -v >> "%LOG_FILE%" 2>&1
        "%NVM_HOME%\%LTS_NODE_VERSION%\npm.cmd" -v >> "%LOG_FILE%" 2>&1
        "%NVM_HOME%\%LTS_NODE_VERSION%\node.exe" "C:\yt-dlp\host.js" 2>> "%LOG_FILE%"
        goto :end
    )
)

set "NODE_HOME=%LOCALAPPDATA%\Programs\nodejs"
IF NOT EXIST "%NODE_HOME%" ( 
	mkdir "%LOCALAPPDATA%\Programs\nodejs"
	curl -L -o "%TEMP%\node-v22.23.3-win-x64.zip" https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip
	tar -xf "%TEMP%\node-v22.23.3-win-x64.zip" -C "%LOCALAPPDATA%\Programs\nodejs" --strip-components=1
	del "%TEMP%\node-v22.23.3-win-x64.zip"
)

IF EXIST "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    "%NODE_HOME%\node.exe" -v >> "%LOG_FILE%" 2>&1
    "%NODE_HOME%\npm.cmd" -v >> "%LOG_FILE%" 2>&1
	"%NODE_HOME%\node.exe" "C:\yt-dlp\host.js" 2>> "%LOG_FILE%"
)

:run_host
node "C:\yt-dlp\host.js" 2>> "%LOG_FILE%"

:end
