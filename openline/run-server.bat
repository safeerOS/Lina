@echo off
setlocal
rem Starts the OpenLine server on the LAN address with a self-signed certificate.
rem Tailscale Funnel is not started. Settings live in server\.env (not committed).

cd /d "%~dp0server"

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created server\.env from the example.
  echo Edit it ^(at least HTTP_GATEWAY_API_KEY and LINA_STREAM_TOKEN^), then run this again.
  notepad ".env"
  exit /b 1
)

findstr /r /c:"^HTTP_GATEWAY_API_KEY=change-me" ".env" >nul && (
  echo HTTP_GATEWAY_API_KEY in server\.env is still "change-me". Set a long random key first.
  exit /b 1
)

where node >nul 2>&1 || (
  echo Node.js 22 or newer is required: https://nodejs.org
  exit /b 1
)

if not exist "node_modules" (
  echo Installing locked dependencies...
  call npm ci || exit /b 1
)

echo Building...
call npm run build --silent || exit /b 1

echo.
echo Console and phones use the https URL printed below. No Tailscale Funnel.
echo Press Ctrl+C to stop.
echo.
node --disable-warning=ExperimentalWarning --env-file=.env dist/index.js
