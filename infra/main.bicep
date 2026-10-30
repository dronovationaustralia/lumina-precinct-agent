// Lumina Precinct Agent on Azure.
//
//   - Azure Database for PostgreSQL Flexible Server 16 (Burstable), PostGIS allowlisted
//   - App Service plan (Linux) hosting the Next.js standalone server (`node server.js`)
//   - Web app for the hackathon deployment; optional second web app for the Quest app
//
// The web apps connect as `lumina_agent`, a read-only login created by `npm run db:setup --
// --agent-login` after this deployment. They never hold the admin password.
//
// Deploy (see docs/deploy-azure.md):
//   az deployment group create -g rg-lumina-precinct -f infra/main.bicep -p infra/main.parameters.json \
//     -p pgAdminPassword=... agentDbPassword=... modelApiKey=...

targetScope = 'resourceGroup'

@description('Azure region. Australia East is Sydney.')
param location string = resourceGroup().location

@description('Prefix for resource names.')
@minLength(3)
@maxLength(20)
param namePrefix string = 'lumina-precinct'

@description('PostgreSQL admin login (not "postgres" or "azure_superuser").')
param pgAdminLogin string = 'luminaadmin'

@secure()
@description('PostgreSQL admin password for a new server (12+ characters). Not needed with existingPostgresHost. Never given to the web apps.')
param pgAdminPassword string = ''

@secure()
@minLength(16)
@description('Password for the read-only lumina_agent login the web apps use. Pass the same value as AGENT_DB_PASSWORD to db:setup.')
param agentDbPassword string

@secure()
@description('Meta Model API key.')
param modelApiKey string

@secure()
@minLength(32)
@description('Signs session cookies: 32+ random characters (different from your local one).')
param authSecret string

@description('Optional: Microsoft Entra app (client) ID for "Sign in with Microsoft".')
param authMicrosoftClientId string = ''

@secure()
@description('Optional: client secret of that Entra app.')
param authMicrosoftClientSecret string = ''

@description('Muse Spark model id.')
param museSparkModel string = 'muse-spark-1.3'

@description('App Service plan SKU. B1 is enough for the demo; P0v3 or higher for more headroom.')
param appServiceSku string = 'B1'

@description('PostgreSQL compute SKU (Burstable tier).')
param postgresSku string = 'Standard_B1ms'

@description('Also create a second web app for the Quest app (VR Start), so the hackathon app can stay frozen.')
param deployQuestApp bool = false

@description('Your public IP, to allow db:setup from your machine. Leave empty to add it later with the CLI.')
param clientIp string = ''

@description('Allowed CORS origin for browser clients such as the Quest web app.')
param corsAllowOrigin string = '*'

@description('Use an existing PostgreSQL server instead of creating one: its host name, e.g. myserver.postgres.database.azure.com. Leave empty to create a new server.')
param existingPostgresHost string = ''

@description('Database name on the server.')
param databaseName string = 'lumina'

var suffix = take(uniqueString(resourceGroup().id), 6)
var pgName = '${namePrefix}-pg-${suffix}'
var planName = '${namePrefix}-plan-${suffix}'
var webName = '${namePrefix}-${suffix}'
var questName = '${namePrefix}-quest-${suffix}'
var dbName = databaseName
var createPostgres = empty(existingPostgresHost)

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (createPostgres) {
  name: pgName
  location: location
  sku: {
    name: postgresSku
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
}

// Server operations are serialised (dependsOn) because Flexible Server rejects concurrent updates.
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (createPostgres) {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'POSTGIS'
    source: 'user-override'
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (createPostgres) {
  parent: pg
  name: dbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [pgExtensions]
}

// 0.0.0.0 is Azure's convention for "allow connections from Azure services" (the web apps).
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (createPostgres) {
  parent: pg
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [pgDatabase]
}

resource pgAllowClient 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (createPostgres && !empty(clientIp)) {
  parent: pg
  name: 'AllowDeveloperMachine'
  properties: {
    startIpAddress: clientIp
    endIpAddress: clientIp
  }
  dependsOn: [pgAllowAzure]
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: appServiceSku
  }
  properties: {
    reserved: true
  }
}

var pgHost = createPostgres ? pg!.properties.fullyQualifiedDomainName : existingPostgresHost
var agentDbUrl = 'postgres://lumina_agent:${uriComponent(agentDbPassword)}@${pgHost}:5432/${dbName}?sslmode=require'

var appSettings = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
  { name: 'LUMINA_PROVIDER', value: 'meta' }
  { name: 'MODEL_API_KEY', value: modelApiKey }
  { name: 'MUSE_SPARK_MODEL', value: museSparkModel }
  { name: 'AUTH_SECRET', value: authSecret }
  { name: 'AUTH_URL', value: 'https://${webName}.azurewebsites.net' }
  { name: 'AUTH_MICROSOFT_CLIENT_ID', value: authMicrosoftClientId }
  { name: 'AUTH_MICROSOFT_CLIENT_SECRET', value: authMicrosoftClientSecret }
  { name: 'DATABASE_URL_RO', value: agentDbUrl }
  { name: 'CORS_ALLOW_ORIGIN', value: corsAllowOrigin }
  { name: 'RATE_LIMIT_PER_MIN', value: '20' }
]

var siteConfig = {
  linuxFxVersion: 'NODE|22-lts'
  appCommandLine: 'node server.js'
  alwaysOn: true
  healthCheckPath: '/api/v1/health'
  http20Enabled: true
  minTlsVersion: '1.2'
  ftpsState: 'Disabled'
  appSettings: appSettings
}

resource web 'Microsoft.Web/sites@2024-04-01' = {
  name: webName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: siteConfig
  }
  tags: {
    purpose: 'hackathon'
  }
}

resource quest 'Microsoft.Web/sites@2024-04-01' = if (deployQuestApp) {
  name: questName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: siteConfig
  }
  tags: {
    purpose: 'quest'
  }
}

output webAppName string = web.name
output webAppUrl string = 'https://${web.properties.defaultHostName}'
output questAppName string = deployQuestApp ? questName : ''
output postgresHost string = pgHost
output postgresServerName string = createPostgres ? pgName : split(existingPostgresHost, '.')[0]
output adminConnectionTemplate string = 'postgres://${pgAdminLogin}:<password>@${pgHost}:5432/${dbName}?sslmode=require'
