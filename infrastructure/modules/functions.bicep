param location string
param appName string
param storageAccountName string
param cosmosEndpoint string
param keyVaultUri string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: false
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'functionapp'
  tags: {
    'azd-service-name': 'backend'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosEndpoint
        }
        {
          name: 'COSMOS_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/cosmos-key/)'
        }
        {
          name: 'COSMOS_DATABASE'
          value: 'trialguard'
        }
        {
          name: 'COSMOS_CONTAINER'
          value: 'trials'
        }
        {
          name: 'ACS_CONNECTION_STRING'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/acs-connection-string/)'
        }
        {
          name: 'EMAIL_SENDER'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/email-sender/)'
        }
      ]
      cors: {
        allowedOrigins: ['*']
        supportCredentials: false
      }
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      nodeVersion: '~20'
    }
    httpsOnly: true
  }
}

output principalId string = functionApp.identity.principalId
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
