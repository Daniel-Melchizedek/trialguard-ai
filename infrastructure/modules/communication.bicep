param acsName string

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

// Azure-managed domain — no custom DNS setup required
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
  }
}

// Link email domain to ACS so the sender address is authorised
resource acsWithDomain 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: acsName
  location: 'global'
  properties: {
    dataLocation: 'United States'
    linkedDomains: [emailDomain.id]
  }
  dependsOn: [acs]
}

@secure()
output acsConnectionString string = acsWithDomain.listKeys().primaryConnectionString
output senderAddress string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
