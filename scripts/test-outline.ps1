# Synthetic fixtures only. The model uses real ProseMirror; the service test owns its data directory.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    & node node_modules/typescript/bin/tsc -p packages/openwriter/tsconfig.server.json
    if ($LASTEXITCODE -ne 0) { throw 'Outline server build failed' }
    foreach ($testFile in @('test-outline-model.mjs', 'test-outline-book.mjs')) {
        & node (Join-Path $root "packages/openwriter/scripts/$testFile")
        if ($LASTEXITCODE -ne 0) { throw "Outline test failed: $testFile" }
    }
} finally { Pop-Location }
