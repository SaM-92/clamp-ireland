// Container Apps environment for the clamptracker.ie deployment.
// Consumption-only (no custom VNet / workload profile), to avoid the billed
// load balancer and static ingress/egress IPs that a custom-VNet environment
// adds. See .azure/deployment-plan.md "Conditional-approval checks" section.
param location string = 'northeurope'
param tags object
param namePrefix string = 'clamp-ireland-dev'
@description('Daily ingestion cap in GiB, to bound Log Analytics spend. -1 disables the cap.')
param logAnalyticsDailyQuotaGb int = 1
@description('Days of Log Analytics retention. 30 is the included/no-extra-cost default.')
param logAnalyticsRetentionDays int = 30

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${namePrefix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logAnalyticsRetentionDays
    workspaceCapping: {
      dailyQuotaGb: logAnalyticsDailyQuotaGb
    }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${namePrefix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
    // No workloadProfiles entry: this keeps the environment on the default
    // Consumption plan only, matching the approved low-cost architecture.
  }
}

output environmentId string = environment.id
output environmentName string = environment.name
output logAnalyticsWorkspaceId string = logAnalytics.id
