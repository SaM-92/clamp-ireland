[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SqlAdminObjectId,

  [Parameter(Mandatory = $true)]
  [string]$SqlAdminLogin,

  [Parameter(Mandatory = $true)]
  [string]$GoogleClientId,

  [Parameter(Mandatory = $true)]
  [string]$GoogleClientSecret,

  [Parameter(Mandatory = $true)]
  [string]$AdminAllowedUserIds,

  [string]$AuthAllowedEmails = '',

  [Parameter(Mandatory = $true)]
  [string]$PublicImage,

  [Parameter(Mandatory = $true)]
  [string]$AdminImage,

  [string]$RegistryUsername = '',

  [System.Security.SecureString]$RegistryPassword,

  [string]$OperatorIpv4 = '98.71.6.33',

  [string]$SubscriptionId,

  [switch]$WhatIf,

  [string]$NamePrefix = 'clamp-ireland-dev',

  [string]$StorageNamePrefix = 'clampiredev',

  [string]$PublicAppName = 'ca-clamp-public-dev',

  [string]$AdminAppName = 'ca-clamp-admin-dev',

  [string]$PublicIdentityName = 'id-clamp-public-dev',

  [string]$AdminIdentityName = 'id-clamp-admin-dev',

  [int]$LogAnalyticsDailyQuotaGb = 1,

  [int]$LogAnalyticsRetentionDays = 30,

  [switch]$AllowPublicSignup,

  [switch]$AllowIndexing,

  [switch]$EnableTrafficAnalytics,

  [switch]$EnableAreaSummaries,

  [switch]$EnableLocalAiDemo,

  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:InfrastructureRoot = Join-Path $script:RepoRoot 'infra'
$script:DeployScriptsRoot = Join-Path $script:RepoRoot 'scripts\deploy'
$script:ResourceGroupName = 'rg-clamp-ireland-dev'
$script:ResourceGroupLocation = 'northeurope'
$script:EnvironmentLocation = 'northeurope'
$script:DataPlaneLocation = 'swedencentral'
$script:PublicOrigin = 'https://clamptracker.ie'
$script:AdminOrigin = 'https://admin.clamptracker.ie'
$script:TemporaryFiles = [System.Collections.Generic.List[string]]::new()
$script:ResolvedSubscriptionId = $null
$script:Tags = @{
  workload   = 'clamp-ireland'
  environment = 'development'
  managedBy  = 'scripts/deploy/deploy-infra.ps1'
}

function Write-StageBanner {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $line = ''.PadLeft(80, '=')
  Write-Host ''
  Write-Host $line -ForegroundColor Cyan
  Write-Host $Message -ForegroundColor Cyan
  Write-Host $line -ForegroundColor Cyan
}

function Test-Ipv4Literal {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Literal
  )

  try {
    $parsed = [System.Net.IPAddress]::Parse($Literal)
  }
  catch {
    return $false
  }

  return $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
}

function Assert-FileExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file not found: $Path"
  }
}

function Assert-DigestPinnedImage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image,

    [Parameter(Mandatory = $true)]
    [string]$ParameterName
  )

  if ($Image -notmatch '^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)?@sha256:[0-9a-f]{64}$') {
    throw "$ParameterName must be a digest-pinned GHCR image reference like ghcr.io/sam-92/clamp-ireland/public@sha256:<64 hex>."
  }
}

function Convert-SecureStringToPlainText {
  param(
    [AllowNull()]
    [System.Security.SecureString]$Value
  )

  if ($null -eq $Value -or $Value.Length -eq 0) {
    return ''
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

function Normalize-CommaSeparatedList {
  param(
    [AllowEmptyString()]
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $items = @(
    $Value -split ',' |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -Unique
  )

  return ($items -join ',')
}

function Get-PropertyValue {
  param(
    $Object,

    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Format-CommandForDisplay {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $parts = foreach ($argument in $Arguments) {
    if ($argument -match '\s') {
      '"' + $argument.Replace('"', '\"') + '"'
    }
    else {
      $argument
    }
  }

  return 'az ' + ($parts -join ' ')
}

function Invoke-AzCli {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [switch]$Raw
  )

  $fullArguments = [System.Collections.Generic.List[string]]::new()
  foreach ($argument in $Arguments) {
    [void]$fullArguments.Add($argument)
  }

  if ($script:ResolvedSubscriptionId -and -not ($fullArguments -contains '--subscription') -and -not ($fullArguments -contains '-s') -and $fullArguments[0] -ne 'account') {
    [void]$fullArguments.Add('--subscription')
    [void]$fullArguments.Add($script:ResolvedSubscriptionId)
  }

  if (-not ($fullArguments -contains '--only-show-errors')) {
    [void]$fullArguments.Add('--only-show-errors')
  }

  if (-not $Raw -and -not ($fullArguments -contains '--output') -and -not ($fullArguments -contains '-o')) {
    [void]$fullArguments.Add('--output')
    [void]$fullArguments.Add('json')
  }

  $commandText = Format-CommandForDisplay -Arguments $fullArguments.ToArray()
  $output = & az @($fullArguments.ToArray()) 2>&1
  $exitCode = $LASTEXITCODE
  $text = (($output | Out-String).Trim())

  if ($exitCode -ne 0) {
    if ([string]::IsNullOrWhiteSpace($text)) {
      $text = '(no stderr/stdout captured)'
    }

    throw "Azure CLI command failed with exit code $exitCode.`nCommand: $commandText`n$text"
  }

  if ($Raw) {
    return $text
  }

  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  try {
    return $text | ConvertFrom-Json
  }
  catch {
    throw "Azure CLI returned non-JSON output for command: $commandText`n$text"
  }
}

function Try-Invoke-AzCli {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [switch]$Raw
  )

  try {
    return [pscustomobject]@{
      Succeeded = $true
      Result    = Invoke-AzCli -Arguments $Arguments -Raw:$Raw
      Error     = $null
    }
  }
  catch {
    return [pscustomobject]@{
      Succeeded = $false
      Result    = $null
      Error     = $_.Exception.Message
    }
  }
}

function New-ParameterFile {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Parameters,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $parameterPayload = @{
    '$schema'      = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
    contentVersion = '1.0.0.0'
    parameters     = @{}
  }

  foreach ($parameterName in $Parameters.Keys) {
    $parameterPayload.parameters[$parameterName] = @{
      value = $Parameters[$parameterName]
    }
  }

  $temporaryFile = New-TemporaryFile
  $parameterFile = [System.IO.Path]::ChangeExtension($temporaryFile.FullName, ".$Label.parameters.json")
  Move-Item -LiteralPath $temporaryFile.FullName -Destination $parameterFile -Force
  ($parameterPayload | ConvertTo-Json -Depth 32) | Set-Content -LiteralPath $parameterFile -Encoding UTF8
  [void]$script:TemporaryFiles.Add($parameterFile)
  return $parameterFile
}

function Get-DeploymentOutputs {
  param(
    $DeploymentResult
  )

  if ($null -eq $DeploymentResult) {
    return $null
  }

  $properties = Get-PropertyValue -Object $DeploymentResult -Name 'properties'
  if ($null -ne $properties) {
    $outputs = Get-PropertyValue -Object $properties -Name 'outputs'
    if ($null -ne $outputs) {
      return $outputs
    }
  }

  return (Get-PropertyValue -Object $DeploymentResult -Name 'outputs')
}

function Get-OutputValue {
  param(
    $Outputs,

    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($null -eq $Outputs) {
    return $null
  }

  $property = $Outputs.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  $outputValue = $property.Value
  $valueProperty = Get-PropertyValue -Object $outputValue -Name 'value'
  if ($null -ne $valueProperty) {
    return $valueProperty
  }

  return $outputValue
}

function Get-NormalizedIpv4List {
  param(
    [string[]]$Addresses
  )

  if ($null -eq $Addresses) {
    Write-Output -NoEnumerate @()
    return
  }

  $normalized = @(
    $Addresses |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -Unique |
      Sort-Object
  )

  foreach ($address in $normalized) {
    if (-not (Test-Ipv4Literal -Literal $address)) {
      throw "Expected an IPv4 literal but got '$address'."
    }
  }

  # PowerShell unwraps a single-element array into a scalar when it is captured
  # via a plain function return; -NoEnumerate keeps 1-element (and 0-element)
  # lists as real arrays so downstream ConvertTo-Json emits a JSON array, which
  # ARM/Bicep array-typed parameters (e.g. storage.bicep's ipRules) require.
  Write-Output -NoEnumerate $normalized
}

function Merge-Ipv4Lists {
  param(
    [string[]]$First = @(),
    [string[]]$Second = @()
  )

  return Get-NormalizedIpv4List -Addresses (@($First) + @($Second))
}

function Test-Ipv4ListEqual {
  param(
    [string[]]$Left = @(),
    [string[]]$Right = @()
  )

  $leftNormalized = @((Get-NormalizedIpv4List -Addresses $Left))
  $rightNormalized = @((Get-NormalizedIpv4List -Addresses $Right))

  if ($leftNormalized.Count -ne $rightNormalized.Count) {
    return $false
  }

  for ($index = 0; $index -lt $leftNormalized.Count; $index++) {
    if ($leftNormalized[$index] -ne $rightNormalized[$index]) {
      return $false
    }
  }

  return $true
}

function Convert-OutboundIpValueToList {
  param(
    $Value,

    [Parameter(Mandatory = $true)]
    [string]$Source
  )

  if ($null -eq $Value) {
    return @()
  }

  $ipCandidates = [System.Collections.Generic.List[string]]::new()

  if ($Value -is [string]) {
    foreach ($item in ($Value -split ',')) {
      $trimmed = $item.Trim()
      if ($trimmed) {
        [void]$ipCandidates.Add($trimmed)
      }
    }
  }
  elseif ($Value -is [System.Collections.IEnumerable]) {
    foreach ($item in @($Value)) {
      if ($item -is [string]) {
        $trimmed = $item.Trim()
        if ($trimmed) {
          [void]$ipCandidates.Add($trimmed)
        }
        continue
      }

      $embeddedIp = Get-PropertyValue -Object $item -Name 'ipAddress'
      if ($embeddedIp) {
        [void]$ipCandidates.Add(([string]$embeddedIp).Trim())
      }
    }
  }
  else {
    throw "Unsupported outbound IP payload from ${Source}: $($Value.GetType().FullName)"
  }

  return Get-NormalizedIpv4List -Addresses $ipCandidates.ToArray()
}

function Get-ContainerAppEnvironmentOutboundIpv4s {
  param(
    [Parameter(Mandatory = $true)]
    [string]$EnvironmentName,

    [int]$RetryCount = 1,

    [int]$RetryDelaySeconds = 0
  )

  $queryPaths = @(
    'properties.outboundIpAddresses',
    'outboundIpAddresses',
    'properties.outboundIpAddressRanges'
  )

  for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
    $foundOutboundProperty = $false

    foreach ($queryPath in $queryPaths) {
      $queryResult = Invoke-AzCli -Arguments @(
        'containerapp', 'env', 'show',
        '--name', $EnvironmentName,
        '--resource-group', $script:ResourceGroupName,
        '--query', $queryPath
      )

      if ($null -ne $queryResult) {
        $foundOutboundProperty = $true
        $parsed = Convert-OutboundIpValueToList -Value $queryResult -Source "az containerapp env show --query $queryPath"
        if ($parsed.Count -gt 0 -or $attempt -eq $RetryCount) {
          return $parsed
        }
      }
    }

    $environment = Invoke-AzCli -Arguments @(
      'containerapp', 'env', 'show',
      '--name', $EnvironmentName,
      '--resource-group', $script:ResourceGroupName
    )

    $properties = Get-PropertyValue -Object $environment -Name 'properties'
    $candidates = @(
      [pscustomobject]@{
        Path  = 'properties.outboundIpAddresses'
        Value = Get-PropertyValue -Object $properties -Name 'outboundIpAddresses'
      },
      [pscustomobject]@{
        Path  = 'outboundIpAddresses'
        Value = Get-PropertyValue -Object $environment -Name 'outboundIpAddresses'
      },
      [pscustomobject]@{
        Path  = 'properties.outboundIpAddressRanges'
        Value = Get-PropertyValue -Object $properties -Name 'outboundIpAddressRanges'
      }
    )

    foreach ($candidate in $candidates) {
      if ($null -ne $candidate.Value) {
        $foundOutboundProperty = $true
        $parsed = Convert-OutboundIpValueToList -Value $candidate.Value -Source "az containerapp env show ($($candidate.Path))"
        if ($parsed.Count -gt 0 -or $attempt -eq $RetryCount) {
          return $parsed
        }
      }
    }

    if (-not $foundOutboundProperty) {
      # Consumption-only Container Apps environments without VNet integration never
      # publish outbound IPs (Azure manages a dynamic, unpublished pool in that mode).
      # Treat "property absent" the same as "property present but empty": fall back to
      # the operator-only allowlist below instead of aborting the whole deployment.
      if ($attempt -eq $RetryCount) {
        Write-Warning "Container Apps environment '$EnvironmentName' does not publish outbound IP addresses (expected for a Consumption environment without VNet integration). Checked query paths: $($queryPaths -join ', ')."
        return @()
      }
    }

    if ($attempt -lt $RetryCount) {
      Write-Warning "Container Apps environment '$EnvironmentName' currently reports zero outbound IPv4s. Waiting $RetryDelaySeconds seconds before retry $($attempt + 1) of $RetryCount."
      Start-Sleep -Seconds $RetryDelaySeconds
    }
  }

  return @()
}

function Resolve-SubscriptionContext {
  $arguments = @('account', 'show')
  if ($SubscriptionId) {
    $arguments += @('--subscription', $SubscriptionId)
  }

  $account = Invoke-AzCli -Arguments $arguments
  $script:ResolvedSubscriptionId = [string](Get-PropertyValue -Object $account -Name 'id')

  if (-not $script:ResolvedSubscriptionId) {
    throw 'Unable to resolve the active Azure subscription ID from az account show.'
  }

  return $account
}

function Confirm-MutatingRun {
  if ($WhatIf) {
    return
  }

  if ($Force) {
    Write-Host 'Confirmation bypassed via -Force.' -ForegroundColor Yellow
    return
  }

  $confirmation = Read-Host 'Type YES to continue'
  if ($confirmation -cne 'YES') {
    throw 'Confirmation did not match YES. Aborting without making Azure changes.'
  }
}

function Ensure-ResourceGroup {
  if ($WhatIf) {
    $exists = Invoke-AzCli -Arguments @('group', 'exists', '--name', $script:ResourceGroupName) -Raw
    if ($exists -ne 'true') {
      throw "Resource group '$($script:ResourceGroupName)' does not exist. -WhatIf mode cannot safely continue with group-scope dry runs until the resource group already exists."
    }

    Write-Host "Confirmed existing resource group $($script:ResourceGroupName) for -WhatIf mode." -ForegroundColor Green
    return
  }

  $result = Invoke-AzCli -Arguments @(
    'group', 'create',
    '--name', $script:ResourceGroupName,
    '--location', $script:ResourceGroupLocation,
    '--tags', ('managedBy=scripts/deploy/deploy-infra.ps1'), ('workload=clamp-ireland'), ('environment=development')
  )

  Write-Host "Resource group ready: $($result.name) in $($result.location)." -ForegroundColor Green
}

function Invoke-BicepGroupDeployment {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DeploymentName,

    [Parameter(Mandatory = $true)]
    [string]$TemplateFile,

    [Parameter(Mandatory = $true)]
    [hashtable]$TemplateParameters
  )

  Assert-FileExists -Path $TemplateFile
  $parameterFile = New-ParameterFile -Parameters $TemplateParameters -Label $DeploymentName

  if ($WhatIf) {
    [void](Invoke-AzCli -Arguments @(
      'deployment', 'group', 'what-if',
      '--resource-group', $script:ResourceGroupName,
      '--name', $DeploymentName,
      '--template-file', $TemplateFile,
      '--parameters', "@$parameterFile"
    ) -Raw)

    $priorDeployment = Try-Invoke-AzCli -Arguments @(
      'deployment', 'group', 'show',
      '--resource-group', $script:ResourceGroupName,
      '--name', $DeploymentName
    )

    if ($priorDeployment.Succeeded) {
      return $priorDeployment.Result
    }

    return $null
  }

  return Invoke-AzCli -Arguments @(
    'deployment', 'group', 'create',
    '--resource-group', $script:ResourceGroupName,
    '--name', $DeploymentName,
    '--template-file', $TemplateFile,
    '--parameters', "@$parameterFile"
  )
}

function Invoke-EnvironmentDeployment {
  $deployment = Invoke-BicepGroupDeployment -DeploymentName 'clamp-environment' -TemplateFile (Join-Path $script:InfrastructureRoot 'environment.bicep') -TemplateParameters @{
    location                  = $script:EnvironmentLocation
    tags                      = $script:Tags
    namePrefix                = $NamePrefix
    logAnalyticsDailyQuotaGb  = $LogAnalyticsDailyQuotaGb
    logAnalyticsRetentionDays = $LogAnalyticsRetentionDays
  }

  $outputs = Get-DeploymentOutputs -DeploymentResult $deployment
  $environmentName = Get-OutputValue -Outputs $outputs -Name 'environmentName'
  if (-not $environmentName) {
    $environmentName = "cae-$NamePrefix"
  }

  $environmentId = Get-OutputValue -Outputs $outputs -Name 'environmentId'
  if (-not $environmentId) {
    $environmentId = "/subscriptions/$($script:ResolvedSubscriptionId)/resourceGroups/$($script:ResourceGroupName)/providers/Microsoft.App/managedEnvironments/$environmentName"
  }

  return [pscustomobject]@{
    Name                    = $environmentName
    Id                      = $environmentId
    LogAnalyticsWorkspaceId = Get-OutputValue -Outputs $outputs -Name 'logAnalyticsWorkspaceId'
  }
}

function Get-ManagedIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $lookup = Try-Invoke-AzCli -Arguments @(
    'identity', 'show',
    '--name', $Name,
    '--resource-group', $script:ResourceGroupName
  )

  if (-not $lookup.Succeeded) {
    return $null
  }

  return [pscustomobject]@{
    Name        = [string](Get-PropertyValue -Object $lookup.Result -Name 'name')
    Id          = [string](Get-PropertyValue -Object $lookup.Result -Name 'id')
    ClientId    = [string](Get-PropertyValue -Object $lookup.Result -Name 'clientId')
    PrincipalId = [string](Get-PropertyValue -Object $lookup.Result -Name 'principalId')
  }
}

function Ensure-ManagedIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $existing = Get-ManagedIdentity -Name $Name
  if ($null -ne $existing) {
    Write-Host "Managed identity ready: $($existing.Name)." -ForegroundColor Green
    return $existing
  }

  if ($WhatIf) {
    throw "Managed identity '$Name' does not exist. -WhatIf mode cannot safely continue because later deployments require the real identity resource ID and client ID."
  }

  $created = Invoke-AzCli -Arguments @(
    'identity', 'create',
    '--name', $Name,
    '--resource-group', $script:ResourceGroupName,
    '--location', $script:ResourceGroupLocation,
    '--tags', ('managedBy=scripts/deploy/deploy-infra.ps1'), ('workload=clamp-ireland'), ('environment=development')
  )

  return [pscustomobject]@{
    Name        = [string](Get-PropertyValue -Object $created -Name 'name')
    Id          = [string](Get-PropertyValue -Object $created -Name 'id')
    ClientId    = [string](Get-PropertyValue -Object $created -Name 'clientId')
    PrincipalId = [string](Get-PropertyValue -Object $created -Name 'principalId')
  }
}

function Resolve-SqlState {
  param(
    $DeploymentResult
  )

  $outputs = Get-DeploymentOutputs -DeploymentResult $DeploymentResult
  $serverName = Get-OutputValue -Outputs $outputs -Name 'serverName'
  if ($serverName) {
    return [pscustomobject]@{
      ServerName          = $serverName
      ServerFqdn          = [string](Get-OutputValue -Outputs $outputs -Name 'serverFqdn')
      DatabaseName        = [string](Get-OutputValue -Outputs $outputs -Name 'databaseName')
      SqlServerResourceId = [string](Get-OutputValue -Outputs $outputs -Name 'sqlServerResourceId')
    }
  }

  $servers = Invoke-AzCli -Arguments @(
    'resource', 'list',
    '--resource-group', $script:ResourceGroupName,
    '--resource-type', 'Microsoft.Sql/servers'
  )

  $matchingServers = @(
    @($servers) |
      Where-Object {
        $tags = Get-PropertyValue -Object $_ -Name 'tags'
        ($null -ne $tags) -and
        ((Get-PropertyValue -Object $tags -Name 'workload') -eq 'clamp-ireland') -and
        ((Get-PropertyValue -Object $tags -Name 'environment') -eq 'development')
      }
  )

  if ($matchingServers.Count -ne 1) {
    throw "Unable to resolve a unique Azure SQL server in resource group '$($script:ResourceGroupName)'. Expected exactly one tagged Microsoft.Sql/servers resource, found $($matchingServers.Count)."
  }

  $name = [string](Get-PropertyValue -Object $matchingServers[0] -Name 'name')
  $id = [string](Get-PropertyValue -Object $matchingServers[0] -Name 'id')
  return [pscustomobject]@{
    ServerName          = $name
    ServerFqdn          = "$name.database.windows.net"
    DatabaseName        = 'clamp'
    SqlServerResourceId = $id
  }
}

function Resolve-StorageState {
  param(
    $DeploymentResult
  )

  $outputs = Get-DeploymentOutputs -DeploymentResult $DeploymentResult
  $storageAccountName = Get-OutputValue -Outputs $outputs -Name 'storageAccountName'
  if ($storageAccountName) {
    return [pscustomobject]@{
      StorageAccountName = $storageAccountName
      StorageAccountId   = [string](Get-OutputValue -Outputs $outputs -Name 'storageAccountId')
    }
  }

  $accounts = Invoke-AzCli -Arguments @(
    'resource', 'list',
    '--resource-group', $script:ResourceGroupName,
    '--resource-type', 'Microsoft.Storage/storageAccounts'
  )

  $matchingAccounts = @(
    @($accounts) |
      Where-Object {
        $tags = Get-PropertyValue -Object $_ -Name 'tags'
        ($null -ne $tags) -and
        ((Get-PropertyValue -Object $tags -Name 'workload') -eq 'clamp-ireland') -and
        ((Get-PropertyValue -Object $tags -Name 'environment') -eq 'development')
      }
  )

  if ($matchingAccounts.Count -ne 1) {
    throw "Unable to resolve a unique Storage account in resource group '$($script:ResourceGroupName)'. Expected exactly one tagged Microsoft.Storage/storageAccounts resource, found $($matchingAccounts.Count)."
  }

  return [pscustomobject]@{
    StorageAccountName = [string](Get-PropertyValue -Object $matchingAccounts[0] -Name 'name')
    StorageAccountId   = [string](Get-PropertyValue -Object $matchingAccounts[0] -Name 'id')
  }
}

function Deploy-Sql {
  param(
    [string[]]$AllowedIpv4s
  )

  $firewallRules = @()
  $ruleIndex = 0
  foreach ($ipAddress in (Get-NormalizedIpv4List -Addresses $AllowedIpv4s)) {
    $ruleName = if ($ipAddress -eq $OperatorIpv4) { 'operator-ipv4' } else { "cae-egress-$ruleIndex" }
    $firewallRules += @{
      name           = $ruleName
      startIpAddress = $ipAddress
      endIpAddress   = $ipAddress
    }
    $ruleIndex++
  }

  $deployment = Invoke-BicepGroupDeployment -DeploymentName 'clamp-sql' -TemplateFile (Join-Path $script:InfrastructureRoot 'sql.bicep') -TemplateParameters @{
    sqlAdminObjectId = $SqlAdminObjectId
    sqlAdminLogin    = $SqlAdminLogin
    location         = $script:DataPlaneLocation
    tags             = $script:Tags
    namePrefix       = $NamePrefix
    firewallRules    = $firewallRules
  }

  return Resolve-SqlState -DeploymentResult $deployment
}

function Deploy-Storage {
  param(
    [string[]]$AllowedIpv4s
  )

  $deployment = Invoke-BicepGroupDeployment -DeploymentName 'clamp-storage' -TemplateFile (Join-Path $script:InfrastructureRoot 'storage.bicep') -TemplateParameters @{
    location   = $script:DataPlaneLocation
    tags       = $script:Tags
    namePrefix = $StorageNamePrefix
    ipRules    = (Get-NormalizedIpv4List -Addresses $AllowedIpv4s)
  }

  return Resolve-StorageState -DeploymentResult $deployment
}

function Resolve-ContainerAppState {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    $DeploymentResult,

    [Parameter(Mandatory = $true)]
    [string]$FallbackPrincipalId
  )

  $outputs = Get-DeploymentOutputs -DeploymentResult $DeploymentResult
  $origin = Get-OutputValue -Outputs $outputs -Name 'origin'
  $principalId = Get-OutputValue -Outputs $outputs -Name 'principalId'
  if ($origin) {
    return [pscustomobject]@{
      Name        = $Name
      Origin      = [string]$origin
      PrincipalId = if ($principalId) { [string]$principalId } else { $FallbackPrincipalId }
    }
  }

  $appLookup = Try-Invoke-AzCli -Arguments @(
    'containerapp', 'show',
    '--name', $Name,
    '--resource-group', $script:ResourceGroupName
  )

  if (-not $appLookup.Succeeded) {
    if ($WhatIf) {
      return [pscustomobject]@{
        Name        = $Name
        Origin      = ''
        PrincipalId = $FallbackPrincipalId
      }
    }

    throw $appLookup.Error
  }

  $properties = Get-PropertyValue -Object $appLookup.Result -Name 'properties'
  $configuration = Get-PropertyValue -Object $properties -Name 'configuration'
  $ingress = Get-PropertyValue -Object $configuration -Name 'ingress'
  $fqdn = [string](Get-PropertyValue -Object $ingress -Name 'fqdn')

  return [pscustomobject]@{
    Name        = $Name
    Origin      = if ($fqdn) { "https://$fqdn" } else { '' }
    PrincipalId = $FallbackPrincipalId
  }
}

function Deploy-ContainerApp {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('public', 'admin')]
    [string]$Kind,

    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$Image,

    [Parameter(Mandatory = $true)]
    $Identity,

    [Parameter(Mandatory = $true)]
    [string]$Origin,

    [Parameter(Mandatory = $true)]
    $EnvironmentState,

    [Parameter(Mandatory = $true)]
    $SqlState,

    [Parameter(Mandatory = $true)]
    $StorageState
  )

  $deploymentName = if ($Kind -eq 'public') { 'clamp-public-app' } else { 'clamp-admin-app' }
  $deployment = Invoke-BicepGroupDeployment -DeploymentName $deploymentName -TemplateFile (Join-Path $script:InfrastructureRoot 'container-app.bicep') -TemplateParameters @{
    name                   = $Name
    kind                   = $Kind
    location               = $script:EnvironmentLocation
    tags                   = $script:Tags
    clientNetwork          = @{ allowedClientIpv4 = @($OperatorIpv4) }
    environmentId          = $EnvironmentState.Id
    identityId             = $Identity.Id
    identityClientId       = $Identity.ClientId
    image                  = $Image
    origin                 = $Origin
    azureSqlServer         = $SqlState.ServerFqdn
    azureSqlDatabase       = $SqlState.DatabaseName
    azureStorageAccountName = $StorageState.StorageAccountName
    googleClientId         = $GoogleClientId
    googleClientSecret     = $GoogleClientSecret
    registryUsername       = $RegistryUsername
    registryPassword       = $script:RegistryPasswordPlainText
    authAllowedEmails      = $AuthAllowedEmails
    adminAllowedUserIds    = if ($Kind -eq 'admin') { $AdminAllowedUserIds } else { '' }
    allowPublicSignup      = [bool]$AllowPublicSignup
    allowIndexing          = [bool]$AllowIndexing
    enableTrafficAnalytics = [bool]$EnableTrafficAnalytics
    enableAreaSummaries    = [bool]$EnableAreaSummaries
    enableLocalAiDemo      = [bool]$EnableLocalAiDemo
  }

  return Resolve-ContainerAppState -Name $Name -DeploymentResult $deployment -FallbackPrincipalId $Identity.PrincipalId
}

function Ensure-StorageBlobContributorRole {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PrincipalId,

    [Parameter(Mandatory = $true)]
    [string]$Scope,

    [Parameter(Mandatory = $true)]
    [string]$DisplayName
  )

  $existingAssignments = Invoke-AzCli -Arguments @(
    'role', 'assignment', 'list',
    '--assignee-object-id', $PrincipalId,
    '--scope', $Scope,
    '--role', 'Storage Blob Data Contributor'
  )

  if (@($existingAssignments).Count -gt 0) {
    Write-Host "RBAC already present for $DisplayName on the storage account scope." -ForegroundColor Green
    return
  }

  if ($WhatIf) {
    Write-Host "What-if: would create Storage Blob Data Contributor for $DisplayName on $Scope." -ForegroundColor Yellow
    return
  }

  [void](Invoke-AzCli -Arguments @(
    'role', 'assignment', 'create',
    '--assignee-object-id', $PrincipalId,
    '--assignee-principal-type', 'ServicePrincipal',
    '--role', 'Storage Blob Data Contributor',
    '--scope', $Scope
  ))

  Write-Host "RBAC created for $DisplayName." -ForegroundColor Green
}

function Write-SqlGrantScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SqlFilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$IdentityDisplayNames
  )

  $content = @(
    '-- Generated by scripts\deploy\deploy-infra.ps1.'
    '-- Identity display names here are the user-assigned managed identity names, not the Container App resource names.'
    ''
  )

  foreach ($identityDisplayName in $IdentityDisplayNames) {
    $content += @(
      "CREATE USER [$identityDisplayName] FROM EXTERNAL PROVIDER;"
      "ALTER ROLE db_datareader ADD MEMBER [$identityDisplayName];"
      "ALTER ROLE db_datawriter ADD MEMBER [$identityDisplayName];"
      'GO'
      ''
    )
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $SqlFilePath) -Force | Out-Null
  ($content -join [Environment]::NewLine) | Set-Content -LiteralPath $SqlFilePath -Encoding UTF8
}

Assert-DigestPinnedImage -Image $PublicImage -ParameterName 'PublicImage'
Assert-DigestPinnedImage -Image $AdminImage -ParameterName 'AdminImage'

if (-not (Test-Ipv4Literal -Literal $OperatorIpv4)) {
  throw "OperatorIpv4 must be a single IPv4 host address. Got '$OperatorIpv4'."
}

$AdminAllowedUserIds = Normalize-CommaSeparatedList -Value $AdminAllowedUserIds
if (-not $AdminAllowedUserIds) {
  throw 'AdminAllowedUserIds must contain at least one value.'
}

$AuthAllowedEmails = Normalize-CommaSeparatedList -Value $AuthAllowedEmails
$RegistryUsername = $RegistryUsername.Trim()
$script:RegistryPasswordPlainText = Convert-SecureStringToPlainText -Value $RegistryPassword

if (-not $RegistryUsername) {
  if ($script:RegistryPasswordPlainText) {
    Write-Warning 'RegistryPassword was supplied without RegistryUsername; the GHCR registry credential path will be skipped and the password will not be passed to the Container App deployments.'
  }

  $script:RegistryPasswordPlainText = ''
}
elseif (-not $script:RegistryPasswordPlainText) {
  throw 'RegistryPassword must be supplied when RegistryUsername is non-empty.'
}

foreach ($requiredTemplate in @(
  (Join-Path $script:InfrastructureRoot 'environment.bicep'),
  (Join-Path $script:InfrastructureRoot 'sql.bicep'),
  (Join-Path $script:InfrastructureRoot 'storage.bicep'),
  (Join-Path $script:InfrastructureRoot 'container-app.bicep')
)) {
  Assert-FileExists -Path $requiredTemplate
}

try {
  Write-StageBanner -Message 'Stage 1-2: Resolving Azure account context and confirmation gate'
  $account = Resolve-SubscriptionContext
  $tenantId = [string](Get-PropertyValue -Object $account -Name 'tenantId')
  $subscriptionName = [string](Get-PropertyValue -Object $account -Name 'name')
  $subscriptionIdForDisplay = [string](Get-PropertyValue -Object $account -Name 'id')
  $user = Get-PropertyValue -Object $account -Name 'user'
  $userName = [string](Get-PropertyValue -Object $user -Name 'name')
  Write-Host "Subscription : $subscriptionName ($subscriptionIdForDisplay)"
  Write-Host "Tenant       : $tenantId"
  if ($userName) {
    Write-Host "Signed-in as : $userName"
  }
  if ($WhatIf) {
    Write-Host 'Mode         : WHAT-IF only (no mutating Azure deployment commands will run)' -ForegroundColor Yellow
  }
  else {
    Write-Host 'Mode         : APPLY (Azure changes will be made after explicit confirmation)' -ForegroundColor Yellow
  }
  Confirm-MutatingRun

  Write-StageBanner -Message 'Stage 3: Creating or confirming resource group'
  Ensure-ResourceGroup

  Write-StageBanner -Message 'Stage 4: Deploying the Log Analytics workspace and Container Apps environment'
  $environmentState = Invoke-EnvironmentDeployment
  Write-Host "Environment name : $($environmentState.Name)"
  Write-Host "Environment ID   : $($environmentState.Id)"

  Write-StageBanner -Message 'Stage 5: Creating or confirming the two user-assigned managed identities'
  $publicIdentity = Ensure-ManagedIdentity -Name $PublicIdentityName
  $adminIdentity = Ensure-ManagedIdentity -Name $AdminIdentityName
  Write-Host "Public identity : $($publicIdentity.Name)"
  Write-Host "Admin identity  : $($adminIdentity.Name)"

  Write-StageBanner -Message 'Stage 6: Querying Container Apps environment outbound IPs and building fail-closed allowlists'
  $initialEnvironmentOutboundIps = @(Get-ContainerAppEnvironmentOutboundIpv4s -EnvironmentName $environmentState.Name -RetryCount 1)
  $initialFirewallIps = @(Merge-Ipv4Lists -First @($OperatorIpv4) -Second $initialEnvironmentOutboundIps)
  if ($initialEnvironmentOutboundIps.Count -eq 0) {
    Write-Warning "The Container Apps environment currently reports zero outbound IPv4s. SQL and Storage will be deployed with only the operator IP ($OperatorIpv4). Re-run this script after the apps exist to reconcile the real egress IPs."
  }
  else {
    Write-Host "Environment outbound IPv4s: $($initialEnvironmentOutboundIps -join ', ')"
  }
  Write-Host "Initial SQL/Storage allowlist: $($initialFirewallIps -join ', ')"

  Write-StageBanner -Message 'Stage 7: Deploying Azure SQL and private Blob storage with deny-by-default firewalls'
  $sqlState = Deploy-Sql -AllowedIpv4s $initialFirewallIps
  $storageState = Deploy-Storage -AllowedIpv4s $initialFirewallIps
  Write-Host "SQL server FQDN    : $($sqlState.ServerFqdn)"
  Write-Host "Storage account    : $($storageState.StorageAccountName)"

  Write-StageBanner -Message 'Stage 8: Deploying the public and admin Container Apps with operator-only ingress'
  $publicAppState = Deploy-ContainerApp -Kind 'public' -Name $PublicAppName -Image $PublicImage -Identity $publicIdentity -Origin $script:PublicOrigin -EnvironmentState $environmentState -SqlState $sqlState -StorageState $storageState
  $adminAppState = Deploy-ContainerApp -Kind 'admin' -Name $AdminAppName -Image $AdminImage -Identity $adminIdentity -Origin $script:AdminOrigin -EnvironmentState $environmentState -SqlState $sqlState -StorageState $storageState

  Write-StageBanner -Message 'Stage 9: Ensuring Storage Blob Data Contributor role assignments for both identities'
  Ensure-StorageBlobContributorRole -PrincipalId $publicIdentity.PrincipalId -Scope $storageState.StorageAccountId -DisplayName $publicIdentity.Name
  Ensure-StorageBlobContributorRole -PrincipalId $adminIdentity.PrincipalId -Scope $storageState.StorageAccountId -DisplayName $adminIdentity.Name

  Write-StageBanner -Message 'Stage 10: Re-querying outbound IPs after first app revisions and reconciling SQL/Storage firewalls'
  $reconciledEnvironmentOutboundIps = @(Get-ContainerAppEnvironmentOutboundIpv4s -EnvironmentName $environmentState.Name -RetryCount 6 -RetryDelaySeconds 15)
  $reconciledFirewallIps = @(Merge-Ipv4Lists -First @($OperatorIpv4) -Second $reconciledEnvironmentOutboundIps)
  if (-not (Test-Ipv4ListEqual -Left $initialFirewallIps -Right $reconciledFirewallIps)) {
    Write-Warning 'The environment outbound IP set changed after the apps existed. SQL and Storage are being redeployed now with the reconciled allowlist. During the window between stage 7 and this reconciliation, app-to-data-plane traffic may have been fail-closed.'
    $sqlState = Deploy-Sql -AllowedIpv4s $reconciledFirewallIps
    $storageState = Deploy-Storage -AllowedIpv4s $reconciledFirewallIps
  }
  elseif ($reconciledEnvironmentOutboundIps.Count -eq 0) {
    Write-Warning 'The environment still reports zero outbound IPv4s even after app deployment. SQL and Storage remain operator-only for now; rerun this script later to reconcile the actual egress IPs when Azure surfaces them.'
  }
  else {
    Write-Host "Reconciled environment outbound IPv4s: $($reconciledEnvironmentOutboundIps -join ', ')" -ForegroundColor Green
  }

  Write-StageBanner -Message 'Stage 11: Generating the manual SQL grant script and follow-up instructions'
  $grantScriptPath = Join-Path $script:DeployScriptsRoot 'grant-sql-users.sql'
  Write-SqlGrantScript -SqlFilePath $grantScriptPath -IdentityDisplayNames @($publicIdentity.Name, $adminIdentity.Name)
  $relativeGrantScriptPath = 'scripts\deploy\grant-sql-users.sql'
  $sqlcmdInstruction = "sqlcmd -S $($sqlState.ServerFqdn) -d clamp -G -i $relativeGrantScriptPath"
  Write-Host "Generated SQL grant script: $grantScriptPath" -ForegroundColor Green
  Write-Host 'Identity display names in that script are the managed identity resource names, not the Container App names.'
  Write-Host "Run next as the Entra SQL admin: $sqlcmdInstruction" -ForegroundColor Yellow
  Write-Host 'Also confirm ADMIN_ALLOWED_USER_IDS was supplied with the intended comma-separated Google user IDs before relying on admin sign-in.' -ForegroundColor Yellow
  Write-Host 'DNS is not created by this script. Create DNS records for clamptracker.ie and admin.clamptracker.ie that point at, or CNAME to, the Container App FQDNs, then perform custom-domain validation/binding and managed certificate setup separately (for example via az containerapp hostname add once DNS resolves).' -ForegroundColor Yellow

  Write-StageBanner -Message 'Stage 12: Final deployment summary and next manual steps'
  $publicReachableOrigin = if ($publicAppState.Origin) { $publicAppState.Origin } else { '(not available in -WhatIf before first create)' }
  $adminReachableOrigin = if ($adminAppState.Origin) { $adminAppState.Origin } else { '(not available in -WhatIf before first create)' }
  Write-Host "Public app current FQDN : $publicReachableOrigin"
  Write-Host "Admin app current FQDN  : $adminReachableOrigin"
  Write-Host "SQL server FQDN         : $($sqlState.ServerFqdn)"
  Write-Host "Storage account         : $($storageState.StorageAccountName)"
  Write-Host "Resource group          : $($script:ResourceGroupName)"
  Write-Host 'GHCR registry auth      : Supply -RegistryUsername <github-username> and -RegistryPassword <SecureString PAT with read:packages> when the GHCR packages are private; leave both empty when the packages are public.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Next manual steps:' -ForegroundColor Yellow
  Write-Host "  1. Run $sqlcmdInstruction as the Entra SQL admin to create contained users for $($publicIdentity.Name) and $($adminIdentity.Name)."
  Write-Host "  2. Create DNS records for clamptracker.ie and admin.clamptracker.ie so they point or CNAME to the current Container App FQDNs."
  Write-Host '  3. After DNS resolves, bind and validate each custom domain and issue managed certificates as a separate step; this script intentionally does not attempt az containerapp hostname add.'
}
finally {
  foreach ($temporaryFile in $script:TemporaryFiles) {
    Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
  }
}
