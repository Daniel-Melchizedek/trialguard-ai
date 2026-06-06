param acsName string

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: '${acsName}-email'
  location: 'global'
  properties: {
    dataLocation: 'United States'
  }
}

resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
  }
}

// Single ACS resource with domain linked — defining it twice (as original code did) causes ARM validation error
resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: acsName
  location: 'global'
  properties: {
    dataLocation: 'United States'
    linkedDomains: [emailDomain.id]
  }
}

@secure()
output acsConnectionString string = acs.listKeys().primaryConnectionString
output senderAddress string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
