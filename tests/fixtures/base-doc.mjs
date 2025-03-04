export const baseTXTDoc = {
  type: 'txt',
  filename: '',
  body: '',
  header: {
    category: null
  },
  data: {
    pageCount: 1,
    header: {
      authors: [],
      date: null,
      source: null,
      expires: null
    },
    content: {
      abstract: null,
      introduction: null,
      securityConsiderations: null,
      authorAddress: null,
      references: null,
      ianaConsiderations: null
    },
    title: null,
    slug: null,
    extractedElements: {
      fqdnDomains: [],
      ipv4: [],
      ipv6: [],
      keywords2119: [],
      boilerplate2119Keywords: [],
      obsoletesRfc: [],
      updatesRfc: [],
      nonReferenceSectionRfc: [],
      referenceSectionRfc: [],
      nonReferenceSectionDraftReferences: [],
      referenceSectionDraftReferences: []
    },
    possibleIssues: {
      inlineCode: [],
      misspeled2119Keywords: []
    }
  }
}

export const baseXMLDoc = {
  type: 'xml',
  filename: '',
  externalEntities: [],
  data: {
    rfc: { _attr: { category: 'std' } }
  }
}
