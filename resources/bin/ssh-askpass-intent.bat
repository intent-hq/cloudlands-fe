@echo off
REM ssh-askpass-intent.bat - Native OS password dialog for SSH passphrase prompts (Windows)
REM
REM Used as SSH_ASKPASS to collect passphrases via a GUI dialog instead of terminal.
REM SSH passes the prompt text as the first argument.
REM
REM Usage:
REM   set SSH_ASKPASS=C:\path\to\ssh-askpass-intent.bat
REM   ssh-add %USERPROFILE%\.ssh\id_ed25519

set "SSH_ASKPASS_PROMPT=%~1"
if "%SSH_ASKPASS_PROMPT%"=="" set "SSH_ASKPASS_PROMPT=Enter passphrase:"

REM Use PowerShell to show a VisualBasic InputBox dialog and write the passphrase
REM directly to stdout. We avoid storing the passphrase in a batch variable because
REM batch special characters (!, ^, &, etc.) would be mangled.
REM The prompt is passed via environment variable to avoid quoting issues with
REM single quotes in SSH prompt text (e.g., "Enter passphrase for key '/path':").
REM -NoProfile: skip loading user profile for speed
powershell.exe -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; $result = [Microsoft.VisualBasic.Interaction]::InputBox($env:SSH_ASKPASS_PROMPT, 'Intent - SSH', ''); if ([string]::IsNullOrEmpty($result)) { exit 1 }; [Console]::Write($result)"
exit /b %ERRORLEVEL%

