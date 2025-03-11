export const baseTXTDoc = {
  type: 'txt',
  filename: '',
  body: '',
  header: {
    category: null
  },
  data: {
    pageCount: 1,
    content: {
      abstract: ['This document obsoletes RFC 5678.']
    },
    extractedElements: {
      obsoletesRfc: ['5678'],
      updatesRfc: ['1234']
    },
    header: {
      authors: [],
      date: null,
      source: null,
      expires: null,
      intendedStatus: null
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
    slug: 'draft-ietf-beep-boop-01',
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
      linesWithSpaces: [],
      inlineCode: [],
      misspeled2119Keywords: [],
      hyphenatedLines: [],
      updatesRfcWithLetter: [],
      obsoletesWithLetter: []
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
