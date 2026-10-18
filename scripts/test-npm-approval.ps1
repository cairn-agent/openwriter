# Regression lock for npm's browser approval during a release: npm 11.16 fails
# a publish at once with EOTP when it has no terminal, and masks the approval
# link in its plain error text. Uses a stand-in npm, browser and done link;
# contacts no registry and publishes nothing.
. "$PSScriptRoot/delivery-common.ps1"

$failures = 0
function Assert-True {
  param([string]$Name, [bool]$Condition)
  $state = if ($Condition) { 'pass' } else { $script:failures++; 'FAIL' }
  Write-Host "  [$state] $Name"
}

# The real done check, through the real npm and node, against a local done link
# that answers as the registry does once an approval is given: the token to
# the logged-in account, 404 to a request without its login. Runs before the
# stand-ins below replace the check.
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
$seen = [hashtable]::Synchronized(@{})
$server = [powershell]::Create().AddScript({
  param($listener, $seen)
  while ($listener.IsListening) {
    try { $context = $listener.GetContext() } catch { return }
    $seen.auth = $context.Request.Headers['Authorization']
    $approved = $seen.auth -eq 'Bearer stand-in-login'
    $context.Response.StatusCode = if ($approved) { 200 } else { 404 }
    $body = [Text.Encoding]::UTF8.GetBytes($(if ($approved) { '{"token":"one-time-token"}' } else { '{}' }))
    $context.Response.ContentType = 'application/json'
    $context.Response.OutputStream.Write($body, 0, $body.Length)
    $context.Response.Close()
  }
}).AddArgument($listener).AddArgument($seen)
$serving = $server.BeginInvoke()
$npmrc = Join-Path ([IO.Path]::GetTempPath()) "ow-npm-approval-$PID.npmrc"
[IO.File]::WriteAllText($npmrc, "//127.0.0.1:$port/:_authToken=stand-in-login`n")
$priorUserConfig = $env:NPM_CONFIG_USERCONFIG
$env:NPM_CONFIG_USERCONFIG = $npmrc
try {
  $token = $null
  try { $token = Get-DeliveryNpmApprovalToken -DoneUrl "http://127.0.0.1:$port/-/v1/done?authId=0f1e2d3c" } catch { Write-Host "    $($_.Exception.Message)" }
  Assert-True 'the done link is checked with the account login, as npm checks it' ($seen.auth -eq 'Bearer stand-in-login')
  Assert-True 'an approved done link hands back its one-time token' ($token -eq 'one-time-token')
} finally {
  $env:NPM_CONFIG_USERCONFIG = $priorUserConfig
  Remove-Item $npmrc -ErrorAction SilentlyContinue
  $listener.Stop(); $listener.Close()
  [void]$serving.AsyncWaitHandle.WaitOne(5000); $server.Dispose()
}

# Stand-ins, found before the real commands because functions resolve first.
$fakeAuthUrl = 'https://www.npmjs.com/auth/cli/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
$fakeDoneUrl = 'https://registry.npmjs.org/-/v1/done?authId=0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
function npm {
  $script:calls += , @($args)
  if ($script:npmBehaviour -eq 'eotp' -and $args -notcontains '--otp') {
    'npm error code EOTP'
    'npm error   https://www.npmjs.com/auth/cli/***'
    '{'
    "  `"authUrl`": `"$fakeAuthUrl`","
    "  `"doneUrl`": `"$fakeDoneUrl`""
    '}'
    $global:LASTEXITCODE = 1
  } elseif ($script:npmBehaviour -eq 'fail') {
    'npm error code E403'
    $global:LASTEXITCODE = 1
  } elseif ($script:npmBehaviour -eq 'login') {
    "Login at:`n$fakeAuthUrl"
    $global:LASTEXITCODE = 0
  } else {
    '+ openwriter@9.9.9'
    $global:LASTEXITCODE = 0
  }
}
function Start-Process { param($FilePath) $script:opened += , $FilePath }
function Invoke-DeliveryNpmDoneCheck {
  $script:polls++
  if ($script:polls -lt $script:approvedAfter) { return [pscustomobject]@{ status = 202 } }
  return [pscustomobject]@{ status = 200; token = 'one-time-token' }
}
function Reset-StandIns {
  param([string]$Behaviour, [int]$ApprovedAfter = 2)
  $script:npmBehaviour = $Behaviour; $script:approvedAfter = $ApprovedAfter
  $script:calls = @(); $script:opened = @(); $script:polls = 0
}

Reset-StandIns -Behaviour 'eotp'
Invoke-DeliveryNpmWithBrowser -Arguments @('publish', 'x.tgz', '--json') -PollSeconds 1
Assert-True 'an approval challenge opens the real link, not the masked one' ($opened.Count -eq 1 -and $opened[0] -eq $fakeAuthUrl)
Assert-True 'the run waits until the approval is given' ($polls -eq 2)
Assert-True 'the same command runs once more with the one-time token' ($calls.Count -eq 2 -and ($calls[1] -join ' ') -eq 'publish x.tgz --json --otp one-time-token')

Reset-StandIns -Behaviour 'eotp' -ApprovedAfter 1000
$threw = $false
try { Invoke-DeliveryNpmWithBrowser -Arguments @('publish', 'x.tgz', '--json') -ApprovalTimeoutSeconds 2 -PollSeconds 1 } catch { $threw = $true }
Assert-True 'an approval never given fails at the bound without a retry' ($threw -and $calls.Count -eq 1)

Reset-StandIns -Behaviour 'fail'
$threw = $false
try { Invoke-DeliveryNpmWithBrowser -Arguments @('publish', 'x.tgz', '--json') } catch { $threw = $true }
Assert-True 'a failure with no approval challenge fails without waiting' ($threw -and $polls -eq 0 -and $calls.Count -eq 1)

Reset-StandIns -Behaviour 'login'
Invoke-DeliveryNpmWithBrowser -Arguments @('login', '--auth-type=web')
Assert-True 'a login opens its link once and runs once' ($opened.Count -eq 1 -and $calls.Count -eq 1)

if ($failures -gt 0) { throw "$failures npm approval check(s) failed." }
