@secure()
param sqlAdminObjectId string

@secure()
param sqlAdminLogin string

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'sql-clamp-${uniqueString(subscription().id, resourceGroup().name)}'
  location: 'swedencentral'
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'User'
      login: sqlAdminLogin
      sid: sqlAdminObjectId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: 'clamp'
  location: 'swedencentral'
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    createMode: 'Default'
    collation: 'Latin1_General_100_BIN2_UTF8'
    maxSizeBytes: 34359738368
    minCapacity: json('0.5')
    autoPauseDelay: 15
    requestedBackupStorageRedundancy: 'Local'
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    zoneRedundant: false
  }
}

resource backupRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: database
  name: 'default'
  properties: {
    retentionDays: 7
    diffBackupIntervalInHours: 24
  }
}
