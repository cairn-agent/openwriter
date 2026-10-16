$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    & node node_modules/typescript/bin/tsc -p packages/openwriter/tsconfig.server.json
    if ($LASTEXITCODE -ne 0) { throw 'Feedback server build failed' }
    & npm run build:guidance --workspace=openwriter
    if ($LASTEXITCODE -ne 0) { throw 'Guidance copy failed' }
    foreach ($testFile in @('test-pending-feedback.mjs', 'test-feedback-service.mjs', 'test-doc-guidance.mjs')) {
        & node (Join-Path $root "packages/openwriter/scripts/$testFile")
        if ($LASTEXITCODE -ne 0) { throw "Feedback test failed: $testFile" }
    }
} finally { Pop-Location }
