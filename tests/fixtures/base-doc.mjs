export const baseTXTDoc = {
  type: 'txt',
  filename: '',
  body: '',
  slug: '',
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
    contains: {
      copyrightSection6_b_i: null,
      copyrightLicenseValid: null,
      license6_c_i: null,
      license6_c_ii: null
    },
    title: null,
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
      referenceSectionDraftReferences: [],
      copyrightDates: [],
      license6_b_ii: []
    },
    possibleIssues: {
      inlineCode: [],
      misspeled2119Keywords: [],
      copyrightLines6_i: []
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
