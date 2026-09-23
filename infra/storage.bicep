@description('Deployment region for private Blob storage. Sweden Central is required for the approved low-cost plan.')
param location string = 'swedencentral'

param tags object

@description('Lowercase alphanumeric prefix for the globally unique storage account name.')
@maxLength(14)
param namePrefix string = 'clampiredev'

@description('Explicit Storage public-endpoint firewall allowlist. Leave empty to fail closed until approved IPs are added.')
param ipRules array = []

var storageAccountName = 'st${namePrefix}${take(uniqueString(subscription().id, resourceGroup().name), 8)}'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
      ipRules: [for ip in ipRules: {
        value: ip
        action: 'Allow'
      }]
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource reportImagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'report-images'
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
