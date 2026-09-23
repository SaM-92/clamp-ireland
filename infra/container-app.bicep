// Public or admin Container App for clamptracker.ie, on the Consumption-only
// managed environment from environment.bicep. Adapted from
// infra/legacy-container-apps/app.bicep (Supabase/VM era, retired) for Azure
// SQL + private Blob + Google-only auth. Env var names must stay in sync with
// src/lib/env.ts - that file is the single source of truth for what the app
// actually reads.
import { ClientNetwork } from './network-types.bicep'

param name string
@allowed(['public', 'admin'])
param kind string
param location string = 'northeurope'
param tags object
@description('Ingress IP allowlist for this test deployment. Empty means no external IP may reach it - fail closed, not fail open.')
param clientNetwork ClientNetwork
param environmentId string
param identityId string
param identityClientId string
@description('Digest-pinned GHCR image, e.g. ghcr.io/sam-92/clamp-ireland/public@sha256:...')
param image string
@description('This app\'s own public origin, e.g. https://clamptracker.ie or https://admin.clamptracker.ie')
param origin string

@description('Container registry hostname. Only needed if the GHCR package is private (GHCR defaults new packages to private) - leave registryUsername empty to skip pull-credential configuration entirely for a public package.')
param registryServer string = 'ghcr.io'
@description('GHCR username (or "USERNAME" placeholder) for a private package pull. Leave empty if the package is public.')
param registryUsername string = ''
@secure()
@description('A GHCR PAT/token with read:packages scope, or empty if the package is public.')
param registryPassword string = ''

param azureSqlServer string
param azureSqlDatabase string
param azureStorageAccountName string

@secure()
param googleClientId string = ''
@secure()
param googleClientSecret string = ''
@description('Comma-separated allowed emails for the private admin app, or empty to allow Google auth without an explicit email allowlist.')
@secure()
param authAllowedEmails string = ''
@secure()
param adminAllowedUserIds string = ''

param allowPublicSignup bool = false
param allowIndexing bool = false
param enableTrafficAnalytics bool = false
param enableAreaSummaries bool = false
param enableLocalAiDemo bool = false
param aiProvider string = 'azure'
param azureOpenAiEndpoint string = ''
param azureOpenAiDeployment string = 'gpt-5-mini'

var sharedSettings = [
  { name: 'AZURE_SQL_SERVER', value: azureSqlServer }
  { name: 'AZURE_SQL_DATABASE', value: azureSqlDatabase }
  { name: 'AZURE_SQL_AUTH_MODE', value: 'entra' }
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: azureStorageAccountName }
  { name: 'AZURE_STORAGE_AUTH_MODE', value: 'managed-identity' }
  { name: 'AUTH_PUBLIC_ORIGIN', value: origin }
  { name: 'ALLOW_PUBLIC_SIGNUP', value: allowPublicSignup ? 'true' : 'false' }
  { name: 'ALLOW_INDEXING', value: allowIndexing ? 'true' : 'false' }
  { name: 'ENABLE_TRAFFIC_ANALYTICS', value: enableTrafficAnalytics ? 'true' : 'false' }
  { name: 'ENABLE_AREA_SUMMARIES', value: enableAreaSummaries ? 'true' : 'false' }
  { name: 'ENABLE_LOCAL_AI_DEMO', value: enableLocalAiDemo ? 'true' : 'false' }
  { name: 'AI_PROVIDER', value: aiProvider }
  { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenAiDeployment }
  { name: 'AZURE_OPENAI_AUTH_MODE', value: 'entra' }
  { name: 'NODE_OPTIONS', value: kind == 'public' ? '--max-old-space-size=1536' : '--max-old-space-size=384' }
]

var usesPrivateRegistry = !empty(registryUsername)

var secrets = concat(
  [
    { name: 'google-client-id', value: googleClientId }
    { name: 'google-client-secret', value: googleClientSecret }
    { name: 'auth-allowed-emails', value: authAllowedEmails }
  ],
  kind == 'admin' ? [{ name: 'admin-accounts', value: adminAllowedUserIds }] : [],
  usesPrivateRegistry ? [{ name: 'registry-password', value: registryPassword }] : []
)

var secretEnv = concat(
  [
    { name: 'GOOGLE_CLIENT_ID', secretRef: 'google-client-id' }
    { name: 'GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }
    { name: 'AUTH_ALLOWED_EMAILS', secretRef: 'auth-allowed-emails' }
  ],
  kind == 'admin'
    ? [
        { name: 'ADMIN_ALLOWED_USER_IDS', secretRef: 'admin-accounts' }
        { name: 'ADMIN_SITE_URL', value: origin }
      ]
    : [{ name: 'SITE_URL', value: origin }]
)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        ipSecurityRestrictions: [for (ip, index) in clientNetwork.allowedClientIpv4: {
          name: 'approved-client-${index}'
          action: 'Allow'
          ipAddressRange: '${ip}/32'
          description: 'Explicitly approved test connection'
        }]
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      secrets: secrets
      registries: usesPrivateRegistry ? [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: kind
          image: image
          resources: {
            cpu: kind == 'public' ? json('1.0') : json('0.25')
            memory: kind == 'public' ? '2Gi' : '0.5Gi'
          }
          env: concat(sharedSettings, secretEnv)
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '5' } } }]
      }
    }
  }
}

output origin string = 'https://${app.properties.configuration.ingress.fqdn}'
output principalId string = reference(identityId, '2023-01-31').principalId
