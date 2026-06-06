param bingSearchName string

resource bingSearch 'Microsoft.Bing/accounts@2020-06-10' = {
  name: bingSearchName
  location: 'global'
  kind: 'Bing.Search.v7'
  sku: {
    name: 'S1'
  }
}

@secure()
output bingSearchKey string = bingSearch.listKeys().key1
