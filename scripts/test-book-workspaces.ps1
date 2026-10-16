# Synthetic fixtures only; never reads or changes a real profile.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    & node node_modules/typescript/bin/tsc -p packages/openwriter/tsconfig.server.json
    if ($LASTEXITCODE -ne 0) { throw 'Book workspace server build failed' }
    Copy-Item -LiteralPath packages/openwriter/server/guidance -Destination packages/openwriter/dist/server -Recurse -Force
    foreach ($test in @('test-doc-guidance.mjs', 'test-book-workspaces.mjs')) {
        & node (Join-Path $root "packages/openwriter/scripts/$test")
        if ($LASTEXITCODE -ne 0) { throw "Book workspace check failed: $test" }
    }
} finally { Pop-Location }
