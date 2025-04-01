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
      expires: null,
      intendedStatus: null
    },
    content: {
      abstract: ['This document obsoletes RFC 5678.'],
      introduction: null,
      securityConsiderations: null,
      authorAddress: null,
      references: null,
      ianaConsiderations: null
    },
    contains: {
      copyrightSection6_b_i: null
    },
    title: null,
    slug: 'draft-ietf-beep-boop-01',
    extractedElements: {
      fqdnDomains: [],
      ipv4: [],
      ipv6: [],
      keywords2119: [],
      boilerplate2119Keywords: [],
      obsoletesRfc: ['5678'],
      updatesRfc: ['1234'],
      nonReferenceSectionRfc: [],
      referenceSectionRfc: [],
      nonReferenceSectionDraftReferences: [],
      referenceSectionDraftReferences: [],
      bracketedRfcReferences: [],
      bracketedRfcNonReferences: []
    },
    possibleIssues: {
      linesWithSpaces: [],
      inlineCode: [],
      misspeled2119Keywords: [],
      isCopyrightNoticeNumbered: null,
      isAbstractNumbered: null,
      isPKorBM: null,
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
