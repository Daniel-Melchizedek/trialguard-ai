@description('Short environment tag (dev, prod)')
param environmentName string = 'dev'

@description('Azure region for all resources')
param location string = resourceGroup().location

var prefix = 'tg${environmentName}'
var cosmosAccountName = '${prefix}-cosmos-${uniqueString(resourceGroup().id)}'
var acsName = '${prefix}-acs-${uniqueString(resourceGroup().id)}'
var keyVaultName = '${prefix}-kv-${uniqueString(resourceGroup().id)}'
var functionAppName = '${prefix}-func-${uniqueString(resourceGroup().id)}'
var storageAccountName = 'tgst${uniqueString(resourceGroup().id)}'

// Cosmos DB (free tier + serverless — lowest possible cost)
module cosmosdb 'modules/cosmosdb.bicep' = {
  name: 'cosmosdb'
  params: {
    location: location
    accountName: cosmosAccountName
  }
}

// Azure Communication Services (100 free emails/day on free tier)
module communication 'modules/communication.bicep' = {
  name: 'communication'
  params: {
    location: location
    acsName: acsName
  }
}

// Azure Functions on Consumption plan (pay-per-execution, ~1M free invocations/month)
module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    appName: functionAppName
    storageAccountName: storageAccountName
    cosmosEndpoint: cosmosdb.outputs.endpoint
    keyVaultUri: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/'
  }
}

// Reference the deployed Cosmos DB account to read its key
resource cosmosAccountRef 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

// Key Vault — secrets stored here; Function App reads via managed identity (no key in app settings)
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    keyVaultName: keyVaultName
    functionAppPrincipalId: functions.outputs.principalId
    cosmosKey: cosmosAccountRef.listKeys().primaryMasterKey
    acsConnectionString: communication.outputs.acsConnectionString
    emailSender: communication.outputs.senderAddress
  }
  dependsOn: [cosmosdb, communication, functions]
}

output functionAppUrl string = functions.outputs.functionAppUrl
output functionAppName string = functions.outputs.functionAppName
output cosmosEndpoint string = cosmosdb.outputs.endpoint
