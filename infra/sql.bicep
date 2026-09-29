@description('Entra object ID for the Azure SQL administrator. Pass privately; do not store in parameter files.')
@secure()
param sqlAdminObjectId string

@description('Entra login/U P N for the Azure SQL administrator. Pass privately; do not store in parameter files.')
@secure()
param sqlAdminLogin string

param location string = 'swedencentral'
param tags object
param namePrefix string = 'clamp-ireland-dev'
@description('Explicit SQL public-endpoint firewall allowlist. Leave empty to fail closed until approved IPs are added.')
param firewallRules array = []

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'sql-${namePrefix}-${uniqueString(subscription().id, resourceGroup().name)}'
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    // Firewall rules only apply on the public endpoint, so this must stay
    // enabled for the approved deny-by-default allowlist model to work.
    publicNetworkAccess: 'Enabled'
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
  location: location
  // Basic (5 DTU, ~EUR 5/month) is always on. The earlier free serverless tier auto-paused
  // after 60 idle minutes, so the first visitor after a quiet hour waited 30-60s for resume.
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    createMode: 'Default'
    collation: 'Latin1_General_100_BIN2_UTF8'
    maxSizeBytes: 2147483648
    requestedBackupStorageRedundancy: 'Local'
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

resource sqlFirewallRules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for rule in firewallRules: {
  parent: server
  name: rule.name
  properties: {
    startIpAddress: rule.startIpAddress
    endIpAddress: rule.endIpAddress
  }
}]

output serverName string = server.name
// environment().suffixes.sqlServerHostname already includes the leading dot
// (e.g. '.database.windows.net'), so no separator is needed here.
output serverFqdn string = '${server.name}${environment().suffixes.sqlServerHostname}'
output databaseName string = database.name
output sqlServerResourceId string = server.id
