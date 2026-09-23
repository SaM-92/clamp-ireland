// Historical module. Never change shared inference roles implicitly.
param accountName string
param principalIds array

var inferenceRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = { name: accountName }
resource access 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in principalIds: {
  name: guid(account.id, principalId, inferenceRole)
  scope: account
  properties: {
    roleDefinitionId: inferenceRole
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}]
