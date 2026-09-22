import { ClientNetwork } from './network-types.bicep'
param name string
@allowed(['public', 'admin'])
param kind string
param location string
param tags object
param clientNetwork ClientNetwork
param environmentId string
param identityId string
param identityClientId string
param image string
param origin string
param supabaseUrl string
@secure()
param supabaseAnonKey string
@secure()
param supabaseServiceRoleKey string
@secure()
param adminAllowedUserIds string = ''
param storageAccountName string
param aiEndpoint string
param aiDeployment string

var settings = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: supabaseUrl }
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', secretRef: 'supabase-anon' }
  { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-service' }
  { name: 'NEXT_PUBLIC_REGISTRATION_ENABLED', value: 'false' }
  { name: 'NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', value: 'false' }
  { name: 'ALLOW_INDEXING', value: 'false' }
  { name: 'ENABLE_TRAFFIC_ANALYTICS', value: 'false' }
  { name: 'ENABLE_AREA_SUMMARIES', value: 'false' }
  { name: 'ENABLE_LOCAL_AI_DEMO', value: 'false' }
  { name: 'AI_PROVIDER', value: 'azure' }
  { name: 'AZURE_OPENAI_ENDPOINT', value: aiEndpoint }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: aiDeployment }
  { name: 'AZURE_OPENAI_AUTH_MODE', value: 'entra' }
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storageAccountName }
  { name: 'AZURE_STORAGE_AUTH_MODE', value: 'managed-identity' }
  { name: 'NODE_OPTIONS', value: '--max-old-space-size=256' }
]

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
      secrets: concat([
        { name: 'supabase-anon', value: supabaseAnonKey }
        { name: 'supabase-service', value: supabaseServiceRoleKey }
      ], kind == 'admin' ? [{ name: 'admin-accounts', value: adminAllowedUserIds }] : [])
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
          env: concat(settings, kind == 'admin' ? [
            { name: 'ADMIN_ALLOWED_USER_IDS', secretRef: 'admin-accounts' }
            { name: 'ADMIN_SITE_URL', value: origin }
          ] : [{ name: 'SITE_URL', value: origin }])
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
