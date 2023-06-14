export const baseTXTDoc = {
  type: 'txt',
  filename: '',
  body: '',
  data: {
    pageCount: 1,
    header: {
      authors: [],
      date: null,
      source: null,
      expires: null
    },
    title: null,
    slug: null
  }
}

export const baseXMLDoc = {
  type: 'xml',
  filename: '',
  externalEntities: [],
  data: {
    rfc: { }
  }
}
