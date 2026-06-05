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

// Cosmos DB — serverless, lowest cost
module cosmosdb 'modules/cosmosdb.bicep' = {
  name: 'cosmosdb'
  params: {
    location: location
    accountName: cosmosAccountName
  }
}

// Azure Communication Services — 100 free emails/day
module communication 'modules/communication.bicep' = {
  name: 'communication'
  params: {
    acsName: acsName
  }
}

// Azure Functions — Linux Consumption plan (pay-per-execution)
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

// Key Vault — reads Cosmos key from module output (avoids cross-deployment listKeys issue)
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    keyVaultName: keyVaultName
    functionAppPrincipalId: functions.outputs.principalId
    cosmosKey: cosmosdb.outputs.primaryKey
    acsConnectionString: communication.outputs.acsConnectionString
    emailSender: communication.outputs.senderAddress
  }
}

output functionAppUrl string = functions.outputs.functionAppUrl
output functionAppName string = functions.outputs.functionAppName
output cosmosEndpoint string = cosmosdb.outputs.endpoint
