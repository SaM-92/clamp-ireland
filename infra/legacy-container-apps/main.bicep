// Retired: incompatible with durable SQLite. Do not deploy.
targetScope = 'subscription'
import { ClientNetwork } from './network-types.bicep'

@allowed(['northeurope'])
param location string = 'northeurope'

@allowed(['rg-clamp-ireland-dev'])
param resourceGroupName string = 'rg-clamp-ireland-dev'

@description('Approved individual public IPv4 addresses only, without CIDR suffixes. No default or public fallback.')
param clientNetwork ClientNetwork

@minLength(64)
@maxLength(64)
param publicImageDigest string

@minLength(64)
@maxLength(64)
param adminImageDigest string

param supabaseUrl string
@secure()
param supabaseAnonKey string
@secure()
param supabaseServiceRoleKey string
@secure()
@description('Exactly two distinct confirmed Supabase UUIDs, comma-separated. Both profiles must be eligible administrators.')
param adminAllowedUserIds string

@description('Existing, approved test-only AI resource in this subscription; no new model is provisioned.')
param aiResourceGroup string
param aiAccountName string
param aiEndpoint string
param aiDeployment string = 'gpt-5-mini'

@secure()
@minLength(3)
param budgetContactEmail string

@description('Alert amount in the subscription billing currency, NOT automatically EUR. Covers this resource group only, not shared AI or Supabase. Notifications do not stop spending.')
@minValue(1)
param monthlyBudgetInBillingCurrency int
param budgetStartDate string = utcNow('yyyy-MM-01')

var tags = { workload: 'clamp-ireland', environment: 'development', purpose: 'owner-cofounder-testing' }

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module stack './stack.bicep' = {
  name: 'clamp-dev-stack'
  scope: group
  params: {
    location: location
    tags: tags
    clientNetwork: clientNetwork
    publicImage: 'ghcr.io/sam-92/clamp-ireland/public@sha256:${publicImageDigest}'
    adminImage: 'ghcr.io/sam-92/clamp-ireland/admin@sha256:${adminImageDigest}'
    supabaseUrl: supabaseUrl
    supabaseAnonKey: supabaseAnonKey
    supabaseServiceRoleKey: supabaseServiceRoleKey
    adminAllowedUserIds: adminAllowedUserIds
    aiEndpoint: aiEndpoint
    aiDeployment: aiDeployment
    budgetContactEmail: budgetContactEmail
    monthlyBudgetInBillingCurrency: monthlyBudgetInBillingCurrency
    budgetStartDate: budgetStartDate
  }
}

module inference './inference-roles.bicep' = {
  name: 'clamp-dev-inference-access'
  scope: resourceGroup(aiResourceGroup)
  params: {
    accountName: aiAccountName
    principalIds: [stack.outputs.publicPrincipalId, stack.outputs.adminPrincipalId]
  }
}

output publicOrigin string = stack.outputs.publicOrigin
output adminOrigin string = stack.outputs.adminOrigin
output storageAccountName string = stack.outputs.storageAccountName
