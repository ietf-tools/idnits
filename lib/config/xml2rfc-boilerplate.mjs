/**
 * Boilerplate text that xml2rfc's prep tool puts in <front><boilerplate>.
 *
 * GENERATED FILE, do not edit: run scripts/generate-xml2rfc-boilerplate.py to regenerate it.
 * From xml2rfc 3.34.1 (commit 9c796f9458c0b8844c7056a4d9894318ed0857e0): xml2rfc/boilerplate_rfc_7841.py,
 * xml2rfc/boilerplate_tlp.py, xml2rfc/boilerplate_id_guidelines.py and the dates
 * in xml2rfc/writers/preptool.py.
 *
 * Each paragraph is the content of a <t> element, whitespace collapsed, with the
 * placeholders of the prep tool: {scheme}, {rfc_number}, {group_name}, {year} and
 * {expiration_date}.
 */
export const XML2RFC_BOILERPLATE_SOURCE = {
  version: '3.34.1',
  commit: '9c796f9458c0b8844c7056a4d9894318ed0857e0'
}

// URLs in the boilerplate use https from this date of the document, http before
// (self.boilerplate_https_date in preptool.py)
export const BOILERPLATE_HTTPS_DATE = '2017-08-21'

// TLP version of the copyright notice by date of the document, from the first date
// it applies (boilerplate_insert_copyright_notice() in preptool.py). The stream is
// the part of the TLP text used, or null for "IETF" in the IETF stream and "alt" in
// the others. There is no copyright notice before the first date.
export const TLP_PERIODS = [
  {
    from: '2009-02-15',
    tlp: '2.0',
    stream: 'n/a'
  },
  {
    from: '2009-09-12',
    tlp: '3.0',
    stream: 'n/a'
  },
  {
    from: '2009-12-28',
    tlp: '5.0',
    stream: null
  }
]

// RFC 7841 "Status of This Memo" paragraphs, by stream, category and consensus
export const RFC_STATUS_OF_MEMO = {
  IETF: {
    std: {
      true: [
        'This is an Internet Standards Track document.',
        'This document is a product of the Internet Engineering Task Force (IETF). It represents the consensus of the IETF community. It has received public review and has been approved for publication by the Internet Engineering Steering Group (IESG). Further information on Internet Standards is available in Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    bcp: {
      true: [
        'This memo documents an Internet Best Current Practice.',
        'This document is a product of the Internet Engineering Task Force (IETF). It represents the consensus of the IETF community. It has received public review and has been approved for publication by the Internet Engineering Steering Group (IESG). Further information on BCPs is available in Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    exp: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
        'This document defines an Experimental Protocol for the Internet community. This document is a product of the Internet Engineering Task Force (IETF). It represents the consensus of the IETF community. It has received public review and has been approved for publication by the Internet Engineering Steering Group (IESG). Not all documents approved by the IESG are candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
        'This document defines an Experimental Protocol for the Internet community. This document is a product of the Internet Engineering Task Force (IETF). It has been approved for publication by the Internet Engineering Steering Group (IESG). Not all documents approved by the IESG are candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    historic: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Engineering Task Force (IETF). It represents the consensus of the IETF community. It has received public review and has been approved for publication by the Internet Engineering Steering Group (IESG). Not all documents approved by the IESG are candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Engineering Task Force (IETF). It has been approved for publication by the Internet Engineering Steering Group (IESG). Not all documents approved by the IESG are candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    info: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Engineering Task Force (IETF). It represents the consensus of the IETF community. It has received public review and has been approved for publication by the Internet Engineering Steering Group (IESG). Not all documents approved by the IESG are candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Engineering Task Force (IETF). It has been approved for publication by the Internet Engineering Steering Group (IESG). Not all documents approved by the IESG are candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    }
  },
  IAB: {
    historic: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Architecture Board (IAB) and represents information that the IAB has deemed valuable to provide for permanent record. It represents the consensus of the Internet Architecture Board (IAB). Documents approved for publication by the IAB are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Architecture Board (IAB) and represents information that the IAB has deemed valuable to provide for permanent record. Documents approved for publication by the IAB are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    info: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Architecture Board (IAB) and represents information that the IAB has deemed valuable to provide for permanent record. It represents the consensus of the Internet Architecture Board (IAB). Documents approved for publication by the IAB are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Architecture Board (IAB) and represents information that the IAB has deemed valuable to provide for permanent record. Documents approved for publication by the IAB are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    }
  },
  IRTF: {
    exp: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
        'This document defines an Experimental Protocol for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the consensus of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
        'This document defines an Experimental Protocol for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the individual opinion(s) of one or more members of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
        'This document defines an Experimental Protocol for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    historic: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the consensus of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the individual opinion(s) of one or more members of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    },
    info: {
      true: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the consensus of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the individual opinion(s) of one or more members of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. Documents approved for publication by the IRSG are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    }
  },
  independent: {
    exp: {
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
        'This document defines an Experimental Protocol for the Internet community. This is a contribution to the RFC Series, independently of any other RFC stream. The RFC Editor has chosen to publish this document at its discretion and makes no statement about its value for implementation or deployment. Documents approved for publication by the RFC Editor are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: ['']
    },
    historic: {
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for the historical record.',
        'This document defines a Historic Document for the Internet community. This is a contribution to the RFC Series, independently of any other RFC stream. The RFC Editor has chosen to publish this document at its discretion and makes no statement about its value for implementation or deployment. Documents approved for publication by the RFC Editor are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ],
      false: ['']
    },
    info: {
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This is a contribution to the RFC Series, independently of any other RFC stream. The RFC Editor has chosen to publish this document at its discretion and makes no statement about its value for implementation or deployment. Documents approved for publication by the RFC Editor are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    }
  },
  editorial: {
    info: {
      'n/a': [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        'This document is a product of the RFC Series Policy Definition Process. It represents the consensus of the RFC Series Working Group approved by the RFC Series Approval Board. Such documents are not candidates for any level of Internet Standard; see Section 2 of RFC 7841.',
        'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
      ]
    }
  }
}

// "Copyright Notice" paragraphs, by TLP version and part (stream, "n/a" for all
// streams, or the ipr variant: "noModification", "noDerivatives", "pre5378")
export const TLP_COPYRIGHT_NOTICE = {
  '2.0': {
    draft: [
      'This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.'
    ],
    'n/a': [
      'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
      "This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents in effect on the date of publication of this document (http://trustee.ietf.org/license-info). Please review these documents carefully, as they describe your rights and restrictions with respect to this document."
    ],
    noModification: [
      'This document may not be modified, and derivative works of it may not be created, except to format it for publication as an RFC or to translate it into languages other than English.'
    ],
    noDerivatives: [
      'This document may not be modified, and derivative works of it may not be created, and it may not be published except as an Internet-Draft.'
    ],
    pre5378: [
      'This document may contain material from IETF Documents or IETF Contributions published or made publicly available before November 10, 2008. The person(s) controlling the copyright in some of this material may not have granted the IETF Trust the right to allow modifications of such material outside the IETF Standards Process. Without obtaining an adequate license from the person(s) controlling the copyright in such materials, this document may not be modified outside the IETF Standards Process, and derivative works of it may not be created outside the IETF Standards Process, except to format it for publication as an RFC or to translate it into languages other than English.'
    ]
  },
  '3.0': {
    draft: [
      'This Internet-Draft is submitted to IETF in full conformance with the provisions of BCP 78 and BCP 79.'
    ],
    'n/a': [
      'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
      "This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents (http://trustee.ietf.org/license-info) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document. Code Components extracted from this document must include Simplified BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the BSD License."
    ],
    noModification: [
      'This document may not be modified, and derivative works of it may not be created, except to format it for publication as an RFC or to translate it into languages other than English.'
    ],
    noDerivatives: [
      'This document may not be modified, and derivative works of it may not be created, and it may not be published except as an Internet-Draft.'
    ],
    pre5378: [
      'This document may contain material from IETF Documents or IETF Contributions published or made publicly available before November 10, 2008. The person(s) controlling the copyright in some of this material may not have granted the IETF Trust the right to allow modifications of such material outside the IETF Standards Process. Without obtaining an adequate license from the person(s) controlling the copyright in such materials, this document may not be modified outside the IETF Standards Process, and derivative works of it may not be created outside the IETF Standards Process, except to format it for publication as an RFC or to translate it into languages other than English.'
    ]
  },
  '4.0': {
    draft: [
      'This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.'
    ],
    IETF: [
      'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
      "This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents (http://trustee.ietf.org/license-info) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document. Code Components extracted from this document must include Simplified BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the Simplified BSD License."
    ],
    alt: [
      'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
      "This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents (http://trustee.ietf.org/license-info) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document."
    ],
    noModification: [
      'This document may not be modified, and derivative works of it may not be created, except to format it for publication as an RFC or to translate it into languages other than English.'
    ],
    noDerivatives: [
      'This document may not be modified, and derivative works of it may not be created, and it may not be published except as an Internet-Draft.'
    ],
    pre5378: [
      'This document may contain material from IETF Documents or IETF Contributions published or made publicly available before November 10, 2008. The person(s) controlling the copyright in some of this material may not have granted the IETF Trust the right to allow modifications of such material outside the IETF Standards Process. Without obtaining an adequate license from the person(s) controlling the copyright in such materials, this document may not be modified outside the IETF Standards Process, and derivative works of it may not be created outside the IETF Standards Process, except to format it for publication as an RFC or to translate it into languages other than English.'
    ]
  },
  '5.0': {
    draft: [
      'This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.'
    ],
    IETF: [
      'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
      'This document is subject to BCP 78 and the IETF Trust\'s Legal Provisions Relating to IETF Documents (<eref target="{scheme}://trustee.ietf.org/license-info"/>) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document. Code Components extracted from this document must include Revised BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the Revised BSD License.'
    ],
    alt: [
      'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
      'This document is subject to BCP 78 and the IETF Trust\'s Legal Provisions Relating to IETF Documents (<eref target="{scheme}://trustee.ietf.org/license-info"/>) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document.'
    ],
    noModification: [
      'This document may not be modified, and derivative works of it may not be created, except to format it for publication as an RFC or to translate it into languages other than English.'
    ],
    noDerivatives: [
      'This document may not be modified, and derivative works of it may not be created, and it may not be published except as an Internet-Draft.'
    ],
    pre5378: [
      'This document may contain material from IETF Documents or IETF Contributions published or made publicly available before November 10, 2008. The person(s) controlling the copyright in some of this material may not have granted the IETF Trust the right to allow modifications of such material outside the IETF Standards Process. Without obtaining an adequate license from the person(s) controlling the copyright in such materials, this document may not be modified outside the IETF Standards Process, and derivative works of it may not be created outside the IETF Standards Process, except to format it for publication as an RFC or to translate it into languages other than English.'
    ]
  }
}

// Earlier versions of RFC_STATUS_OF_MEMO and TLP_COPYRIGHT_NOTICE, newest first:
// the paragraphs (by keys, null where there were none) that xml2rfc generated
// until the release of the given date, which replaced them in the given commit
export const RFC_STATUS_OF_MEMO_HISTORY = [
  {
    until: '2023-01-19',
    commit: '6b9aede79e25665c199064c362fc6524f8292882',
    slots: [
      {
        keys: ['editorial', 'info', 'n/a'],
        paragraphs: null
      }
    ]
  },
  {
    until: '2021-06-25',
    commit: '1b1afe391a355a7dc9763c9b1388f7fdbecf7562',
    slots: [
      {
        keys: ['IRTF', 'exp', 'true'],
        paragraphs: [
          'This document is not an Internet Standards Track specification; it is published for examination, experimental implementation, and evaluation.',
          'This document defines an Experimental Protocol for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the consensus of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not a candidate for any level of Internet Standard; see Section 2 of RFC 7841.',
          'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
        ]
      },
      {
        keys: ['IRTF', 'historic', 'true'],
        paragraphs: [
          'This document is not an Internet Standards Track specification; it is published for the historical record.',
          'This document defines a Historic Document for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the consensus of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not a candidate for any level of Internet Standard; see Section 2 of RFC 7841.',
          'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
        ]
      },
      {
        keys: ['IRTF', 'historic', 'false'],
        paragraphs: [
          'This document is not an Internet Standards Track specification; it is published for the historical record.',
          'This document defines a Historic Document for the Internet community. This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the individual opinion(s) of one or more members of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not a candidate for any level of Internet Standard; see Section 2 of RFC 7841.',
          'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
        ]
      },
      {
        keys: ['IRTF', 'info', 'true'],
        paragraphs: [
          'This document is not an Internet Standards Track specification; it is published for informational purposes.',
          'This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the consensus of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not a candidate for any level of Internet Standard; see Section 2 of RFC 7841.',
          'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
        ]
      },
      {
        keys: ['IRTF', 'info', 'false'],
        paragraphs: [
          'This document is not an Internet Standards Track specification; it is published for informational purposes.',
          'This document is a product of the Internet Research Task Force (IRTF). The IRTF publishes the results of Internet-related research and development activities. These results might not be suitable for deployment. This RFC represents the individual opinion(s) of one or more members of the {group_name} Research Group of the Internet Research Task Force (IRTF). Documents approved for publication by the IRSG are not a candidate for any level of Internet Standard; see Section 2 of RFC 7841.',
          'Information about the current status of this document, any errata, and how to provide feedback on it may be obtained at <eref target="{scheme}://www.rfc-editor.org/info/rfc{rfc_number}" />.'
        ]
      }
    ]
  }
]

export const TLP_COPYRIGHT_NOTICE_HISTORY = [
  {
    until: '2021-10-29',
    commit: '8e4eb0405ccd499f0ad400fcfd637a19942dfe7d',
    slots: [
      {
        keys: ['5.0', 'IETF'],
        paragraphs: [
          'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
          'This document is subject to BCP 78 and the IETF Trust\'s Legal Provisions Relating to IETF Documents (<eref target="{scheme}://trustee.ietf.org/license-info"/>) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document. Code Components extracted from this document must include Simplified BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the Simplified BSD License.'
        ]
      }
    ]
  },
  {
    until: '2020-02-18',
    commit: '2b6fdc06e8a99b891efc8c210ab43dbdedd450a8',
    slots: [
      {
        keys: ['5.0', 'alt'],
        paragraphs: [
          'Copyright (c) {year} IETF Trust and the persons identified as the document authors. All rights reserved.',
          "This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents ({scheme}://trustee.ietf.org/license-info) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document."
        ]
      }
    ]
  }
]

// Internet-Draft "Status of This Memo" paragraphs
export const DRAFT_STATUS_OF_MEMO = [
  'This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.',
  'Internet-Drafts are working documents of the Internet Engineering Task Force (IETF). Note that other groups may also distribute working documents as Internet-Drafts. The list of current Internet-Drafts is at <eref target="{scheme}://datatracker.ietf.org/drafts/current/"/>.',
  'Internet-Drafts are draft documents valid for a maximum of six months and may be updated, replaced, or obsoleted by other documents at any time. It is inappropriate to use Internet-Drafts as reference material or to cite them other than as "work in progress."',
  'This Internet-Draft will expire on {expiration_date}.'
]
