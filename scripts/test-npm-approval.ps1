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
function Invoke-WebRequest {
  $script:polls++
  if ($script:polls -lt $script:approvedAfter) { return [pscustomobject]@{ StatusCode = 202; Content = '{}' } }
  return [pscustomobject]@{ StatusCode = 200; Content = '{"token":"one-time-token"}' }
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
