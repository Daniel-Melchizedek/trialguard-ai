param location string
param acsName string

// Azure Communication Services does not support all regions; eastus is broadly available
resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: acsName
  location: 'global'
  properties: {
    dataLocation: 'United States'
  }
}

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: '${acsName}-email'
  location: 'global'
  properties: {
    dataLocation: 'United States'
  }
}

// Azure-managed domain for quick start (no DNS setup required)
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
  }
}

output acsConnectionString string = listKeys(acs.id, acs.apiVersion).primaryConnectionString
output senderAddress string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
