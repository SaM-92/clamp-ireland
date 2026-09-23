targetScope = 'subscription'

@description('Entra object ID supplied privately for read-only SQL feasibility validation.')
@secure()
param sqlAdminObjectId string

@description('Entra login supplied privately; never store it in a parameter file.')
@secure()
param sqlAdminLogin string

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-clamp-ireland-dev'
  location: 'northeurope'
  tags: {
    application: 'clamp-ireland'
    environment: 'dev'
  }
}

module database './sql.bicep' = {
  name: 'clamp-sql-free-preflight'
  scope: rg
  params: {
    sqlAdminObjectId: sqlAdminObjectId
    sqlAdminLogin: sqlAdminLogin
  }
}
