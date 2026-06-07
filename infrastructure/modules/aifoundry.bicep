param location string
param accountName string
param projectName string
param functionAppPrincipalId string

// AI Foundry account (AIServices kind — supports projects and agent service)
resource foundryAccount 'Microsoft.CognitiveServices/accounts@2026-03-01' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
  }
}

// gpt-4o-mini deployment for agent use
resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2026-03-01' = {
  parent: foundryAccount
  name: 'gpt-4o-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 1
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

// AI Foundry project — visible in foundry.azure.com
resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2026-03-01' = {
  name: projectName
  location: location
  parent: foundryAccount
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'TrialGuard AI'
    description: 'Generates personalised daily trial tips for TrialGuard users'
  }
  dependsOn: [gpt4oMiniDeployment]
}

// Azure AI Developer role on the project — allows function app to create/run agents
resource foundryProjectRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryProject.id, functionAppPrincipalId, 'Azure AI Developer')
  scope: foundryProject
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '64702f94-c441-49e6-a78b-ef80e0188fee' // Azure AI Developer
    )
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output accountEndpoint string = foundryAccount.properties.endpoint
output projectEndpoint string = 'https://${accountName}.cognitiveservices.azure.com/api/projects/${foundryProject.name}'
output projectName string = foundryProject.name
