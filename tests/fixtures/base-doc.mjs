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
      previous6_b_i_copyright: false,
      pagesFound: 0,
      draftParagraphOutSixMonthValidity: false,
      acceptableParagraphNotingThatDraft: false,
      idIndication: false,
      copyrightSection6_b_i: null,
      copyrightLicenseValid: null,
      license6_c_i: null,
      license6_c_ii: null,
      revisedBsdLicense6_i: null,
      submissionCompliance: false
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
      copyrightDates: [],
      license6_b_ii: [],
      license6_b_i: [],
      bracketedRfcReferences: [],
      bracketedRfcNonReferences: [],
      lastPageExpiration: null,
      draftStatusReferences: []
    },
    possibleIssues: {
      unexpectedIndentation: [],
      isTableOfContentsExists: null,
      linesWithSpaces: [],
      inlineCode: [],
      misspeled2119Keywords: [],
      pageLineWithFormFeed: [],
      paragraphPointingToTheListOfCurrentId: [],
      copyrightLines6_i: [],
      isCopyrightNoticeNumbered: null,
      isAbstractNumbered: null,
      isPKorBM: null,
      hyphenatedLines: [],
      updatesRfcWithLetter: [],
      obsoletesWithLetter: [],
      missingPageNumbering: [],
      submissionCompliancePage: null
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
