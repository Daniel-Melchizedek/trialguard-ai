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
var openAiAccountName = '${prefix}-oai-${uniqueString(resourceGroup().id)}'
var aiFoundryAccountName = '${prefix}-aif-${uniqueString(resourceGroup().id)}'
var aiFoundryProjectName = 'trialguard'

// Endpoints are deterministic from names — computed here to avoid circular module dependencies
var openAiEndpoint = 'https://${openAiAccountName}.openai.azure.com/'
var aiProjectEndpoint = 'https://${aiFoundryAccountName}.cognitiveservices.azure.com/api/projects/${aiFoundryProjectName}'

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
// Deployed before OpenAI and AI Foundry so its principalId can be used for role assignments
module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    appName: functionAppName
    storageAccountName: storageAccountName
    cosmosEndpoint: cosmosdb.outputs.endpoint
    keyVaultUri: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/'
    openAiEndpoint: openAiEndpoint
    aiProjectEndpoint: aiProjectEndpoint
  }
}

// Azure OpenAI — gpt-4o-mini for direct completions + managed identity role grant
module openai 'modules/openai.bicep' = {
  name: 'openai'
  params: {
    location: location
    openAiAccountName: openAiAccountName
    functionAppPrincipalId: functions.outputs.principalId
  }
}

// Azure AI Foundry — AIServices account + project + agent role grant
module aifoundry 'modules/aifoundry.bicep' = {
  name: 'aifoundry'
  params: {
    location: location
    accountName: aiFoundryAccountName
    projectName: aiFoundryProjectName
    functionAppPrincipalId: functions.outputs.principalId
  }
}

// Key Vault — reads secrets from module outputs
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    keyVaultName: keyVaultName
    functionAppPrincipalId: functions.outputs.principalId
    cosmosKey: cosmosdb.outputs.primaryKey
    acsConnectionString: communication.outputs.acsConnectionString
    emailSender: communication.outputs.senderAddress
    openAiKey: openai.outputs.primaryKey
    openAiEndpoint: openAiEndpoint
  }
}

output functionAppUrl string = functions.outputs.functionAppUrl
output functionAppName string = functions.outputs.functionAppName
output cosmosEndpoint string = cosmosdb.outputs.endpoint
output openAiEndpoint string = openAiEndpoint
output aiProjectEndpoint string = aiProjectEndpoint
