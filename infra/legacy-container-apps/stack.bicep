// Retired with the Container Apps / hosted database topology.
import { ClientNetwork } from './network-types.bicep'
param location string
param tags object
param clientNetwork ClientNetwork
param publicImage string
param adminImage string
param supabaseUrl string
@secure()
param supabaseAnonKey string
@secure()
param supabaseServiceRoleKey string
@secure()
param adminAllowedUserIds string
param aiEndpoint string
param aiDeployment string
@secure()
param budgetContactEmail string
param monthlyBudgetInBillingCurrency int
param budgetStartDate string

var publicName = 'ca-clamp-dev-public'
var adminName = 'ca-clamp-dev-admin'
var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var readerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
var delegatorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a')

resource publicIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-clamp-dev-public'
  location: location
  tags: tags
}
resource adminIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-clamp-dev-admin'
  location: location
  tags: tags
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stclamp${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
      ipRules: [for ip in clientNetwork.allowedClientIpv4: { action: 'Allow', value: parseCidr('${ip}/32').network }]
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: { blob: { enabled: true, keyType: 'Account' } }
    }
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: false
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
  }
}
resource evidence 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'report-images'
  properties: { publicAccess: 'None' }
}
resource writer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(evidence.id, publicIdentity.id, contributorRole)
  scope: evidence
  properties: {
    roleDefinitionId: contributorRole
    principalId: publicIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource reader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(evidence.id, adminIdentity.id, readerRole)
  scope: evidence
  properties: {
    roleDefinitionId: readerRole
    principalId: adminIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource delegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, adminIdentity.id, delegatorRole)
  scope: storage
  properties: {
    roleDefinitionId: delegatorRole
    principalId: adminIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-clamp-dev'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: { destination: 'none' }
    zoneRedundant: false
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}

var publicOrigin = 'https://${publicName}.${environment.properties.defaultDomain}'
var adminOrigin = 'https://${adminName}.${environment.properties.defaultDomain}'

module publicApp './app.bicep' = {
  name: 'clamp-public'
  params: {
    name: publicName
    kind: 'public'
    location: location
    tags: tags
    clientNetwork: clientNetwork
    environmentId: environment.id
    identityId: publicIdentity.id
    identityClientId: publicIdentity.properties.clientId
    image: publicImage
    origin: publicOrigin
    supabaseUrl: supabaseUrl
    supabaseAnonKey: supabaseAnonKey
    supabaseServiceRoleKey: supabaseServiceRoleKey
    storageAccountName: storage.name
    aiEndpoint: aiEndpoint
    aiDeployment: aiDeployment
  }
  dependsOn: [writer]
}
module adminApp './app.bicep' = {
  name: 'clamp-admin'
  params: {
    name: adminName
    kind: 'admin'
    location: location
    tags: tags
    clientNetwork: clientNetwork
    environmentId: environment.id
    identityId: adminIdentity.id
    identityClientId: adminIdentity.properties.clientId
    image: adminImage
    origin: adminOrigin
    supabaseUrl: supabaseUrl
    supabaseAnonKey: supabaseAnonKey
    supabaseServiceRoleKey: supabaseServiceRoleKey
    adminAllowedUserIds: adminAllowedUserIds
    storageAccountName: storage.name
    aiEndpoint: aiEndpoint
    aiDeployment: aiDeployment
  }
  dependsOn: [reader, delegator]
}
resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'clamp-dev-monthly-alert'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetInBillingCurrency
    timeGrain: 'Monthly'
    timePeriod: { startDate: '${budgetStartDate}T00:00:00Z' }
    notifications: {
      actualHalf: {
        enabled: true
        contactEmails: [budgetContactEmail]
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
      }
      actualFull: {
        enabled: true
        contactEmails: [budgetContactEmail]
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
      }
      forecastFull: {
        enabled: true
        contactEmails: [budgetContactEmail]
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
      }
    }
  }
}

output publicPrincipalId string = publicIdentity.properties.principalId
output adminPrincipalId string = adminIdentity.properties.principalId
output publicOrigin string = publicApp.outputs.origin
output adminOrigin string = adminApp.outputs.origin
output storageAccountName string = storage.name
