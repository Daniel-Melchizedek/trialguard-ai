param location string
param accountName string
param databaseName string = 'trialguard'
param containerName string = 'trials'

// EnableFreeTier: 1 free account per subscription (400 RU/s + 5 GB included).
// If you already used your free tier on another account, remove that capability and keep only EnableServerless.
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: ['/userEmail']
        kind: 'Hash'
      }
      indexingPolicy: {
        includedPaths: [
          { path: '/reminderDueDate/?' }
          { path: '/reminderSent/?' }
          { path: '/userEmail/?' }
        ]
        excludedPaths: [
          { path: '/*' }
        ]
      }
    }
  }
}

output endpoint string = cosmosAccount.properties.documentEndpoint
output accountName string = cosmosAccount.name
