param([switch]$NoBrowser, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed' }
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
}
if (!$NoBuild) {
    Push-Location frontend
    try {
        if (!(Test-Path -LiteralPath 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    } finally { Pop-Location }
}
try {
    $existingDesk = Invoke-RestMethod 'http://127.0.0.1:8010/api/desk/health' -TimeoutSec 2
    if ($existingDesk.status -eq 'ok' -and $existingDesk.storage -eq (Join-Path $PSScriptRoot 'data')) {
        if (!$NoBrowser) { Start-Process 'http://127.0.0.1:8010/' }
        Write-Host 'This ResearchDesk workspace is already running at http://127.0.0.1:8010.'
        return
    }
} catch { }
if ($NoBrowser) {
    & .\.venv\Scripts\python.exe -m uvicorn researchdesk:app --host 127.0.0.1 --port 8010
    exit $LASTEXITCODE
}
New-Item -ItemType Directory -Force -Path data | Out-Null
$deskProcess = Start-Process -FilePath (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') -ArgumentList @('-m','uvicorn','researchdesk:app','--host','127.0.0.1','--port','8010') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput 'data\server.log' -RedirectStandardError 'data\server-error.log'
try {
    $deskReady = $false
    for ($deskAttempt = 0; $deskAttempt -lt 30; $deskAttempt++) {
        $deskProcess.Refresh()
        if ($deskProcess.HasExited) { throw 'ResearchDesk failed to start. Check data\server-error.log; port 8010 may already be occupied.' }
        try {
            $deskHealth = Invoke-RestMethod 'http://127.0.0.1:8010/api/desk/health' -TimeoutSec 2
            if ($deskHealth.status -eq 'ok') { $deskReady = $true; break }
        } catch { Start-Sleep -Milliseconds 300 }
    }
    if (!$deskReady) { throw 'ResearchDesk did not become ready; check data\server-error.log' }
    Start-Process 'http://127.0.0.1:8010/'
    Write-Host 'ResearchDesk is running at http://127.0.0.1:8010. Keep this window open; Ctrl+C stops the app.'
    Wait-Process -Id $deskProcess.Id
} finally {
    $deskProcess.Refresh()
    if (!$deskProcess.HasExited) { Stop-Process -Id $deskProcess.Id }
}
