export const abstractTXTBlock = `
    Abstract
    This document specifies a way to derive an Extended Community from a
    Route Target and describes some example use cases.
`

export const abstractNumberedTXTBlock = `
    1. Abstract
    This document specifies a way to derive an Extended Community from a
    Route Target and describes some example use cases.
`

export const abstractWithReferencesTXTBlock = `
    Abstract
    This document specifies a way to derive an Extended Community from a
    Route Target and describes some example use cases.
    See reference below [1]
`

export const tableOfContentsTXTBlock = `
    Table of Contents
    1. Introduction .................................................... 3
    2. Background ...................................................... 4
    3. Problem Statement ............................................... 5
    4. Proposed Solution ............................................... 6
    5. Security Considerations ......................................... 7
    6. IANA Considerations ............................................. 8
    7. References ...................................................... 9
`

export const introductionTXTBlock = `
    1. Introduction
    The purpose of this document is to define the structure and standards
    for creating documents in accordance with current guidelines.
`

export const backgroundTXTBlock = `
    2. Background
    In recent years, the need for standardized document formats has
    increased due to growing collaboration between organizations.
`

export const problemStatementTXTBlock = `
    3. Problem Statement
    Current document standards are inconsistent, leading to confusion
    and miscommunication among stakeholders.
`

export const proposedSolutionTXTBlock = `
    4. Proposed Solution
    This document introduces a structured approach to document creation,
    ensuring clarity and consistency across all sections.
`

export const securityConsiderationsTXTBlock = `
    5. Security Considerations
    Security implications must be considered when sharing documents, and
    sensitive information should be appropriately protected [RFC1234].
`

export const ianaConsiderationsTXTBlock = `
    6. IANA Considerations
    No specific actions are required by IANA for this document.
`

export const referencesTXTBlockShort = `
    7. References
    [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119, March 1997.
    [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119
              Key Words", RFC 8174, May 2017.
`
export const metaTXTBlock = `




idr                                                            Z. Zhang
Internet-Draft                                                  J. Haas
Intended status: Standards Track                       Juniper Networks
Expires: 8 September 2023                                      K. Patel
Obsoletes: 5678, 1234, 2345, 3456                                Arrcus
                                                        21 January 2025
Updates: 6789, 7890, 8901, 9012 (if approved)


            Extended Communities Derived from Route Targets
                 draft-ietf-idr-rt-derived-community-05
`

export const metaWithoutObsoleteAndUpdatesTXTBlock = `




idr                                                            Z. Zhang
Internet-Draft                                                  J. Haas
Intended status: Standards Track                       Juniper Networks
Expires: 8 September 2023                                      K. Patel
                                                                Arrcus
                                                        21 January 2025


            Extended Communities Derived from Route Targets
                 draft-ietf-idr-rt-derived-community-05
`

export const metaObsoleteAndUpdatesHasCharactersTXTBlock = `




idr                                                            Z. Zhang
Internet-Draft                                                  J. Haas
Intended status: Standards Track                       Juniper Networks
Expires: 8 September 2023                                      K. Patel
Obsoletes: RFC5678, 1234, RFC2345, RFC3456                       Arrcus
                                                        21 January 2025
Updates: 6789, RFC7890, RFC8901, 9012 (if approved)


            Extended Communities Derived from Route Targets
                 draft-ietf-idr-rt-derived-community-05
`

export const authorAddressTXTBlock = `
Authors' Addresses

   Zhaohui Zhang
   Juniper Networks
   Email: zzhang@juniper.net


   Jeff Haas
   Juniper Networks
   Email: jhaas@juniper.net


   Keyur Patel
   Arrcus
   Email: keyur@arrcus.com
`

export const referenceTXTBlock = `
7.  References

7.1.  Normative References

   [RFC4360]  Sangli, S., Tappan, D., and Y. Rekhter, "BGP Extended
              Communities Attribute", RFC 4360, DOI 10.17487/RFC4360,
              February 2006, <https://www.rfc-editor.org/info/rfc4360>.

   [RFC5701]  Rekhter, Y., "IPv6 Address Specific BGP ExtendedCommunity
              Attribute", RFC 5701, DOI 10.17487/RFC5701,November 2009,
              <https://www.rfc-editor.org/info/rfc5701>.

   [RFC7153]  Rosen, E. and Y. Rekhter, "IANA Registries for BGP
              Extended Communities", RFC 7153, DOI 10.17487/RFC7153,
              March 2014, <https://www.rfc-editor.org/info/rfc7153>.

   [RFC7432]  Sajassi, A., Ed., Aggarwal, R., Bitar, N., Isaac, A.,
              Uttaro, J., Drake, J., and W. Henderickx, "BGP MPLS-Based
              Ethernet VPN", RFC 7432, DOI 10.17487/RFC7432, February
              2015, <https://www.rfc-editor.org/info/rfc7432>.

   [RFC2345]

   [Lalalala-Refere-Sponsor]

7.2.  Informative References

   [I-D.ietf-bess-evpn-igmp-mld-proxy]
              Sajassi, A., Thoria, S., Mishra, M. P., Drake, J., and W.
              Lin, "Internet Group Management Protocol (IGMP) and
              Multicast Listener Discovery (MLD) Proxies for Ethernet
              VPN (EVPN)", Work in Progress, Internet-Draft,draft-ietf
              bess-evpn-igmp-mld-proxy-21, 22 March 2022,
              <https://datatracker.ietf.org/doc/html/draft-ietf-bess
              evpn-igmp-mld-proxy-21>.

   [I-D.ietf-bess-bgp-multicast-controller]
              Zhang, Z. J., Raszuk, R., Pacella, D., and A. Gulko,
              "Controller Based BGP Multicast Signaling", Work in
              Progress, Internet-Draft, draft-ietf-bess-bgp-multicast
              controller-09, 11 April 2022,
              <https://datatracker.ietf.org/doc/html/draft-ietf-bess
              bgp-multicast-controller-09>.

   [I-D.ietf-idr-legacy-rtc]
              Mohapatra, P., Sreekantiah, A., Patel, K., Burjiz, B.,and
              A. Lo, "Automatic Route Target Filtering for legacy PEs",
`

export const textWithFQRNTXTBlock = `
    One domain invalid.arpa. We can think about another domain
    random.arpa. Also there are another kinds of domains like
    example.com and www.ietf.org.
`

export const textWithIPsTXTBlock = `
    Some text with IPsV4 like 8.8.8.8, 123.45.67.89.
    Also there can be invalid IPs like 256.0.0.1, 192.0.2.300.
    And a little bit of IPV6 like 2001:0000:130F:0000:0000:09C0:876A:130B.
    And some invalid IPV6 like 1234:5678:90ab::.
`

export const textWithRFC2119KeywordsTXTBlock = `
    The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD
    and other we can find in RFC 2119. Sometimes we can meet
    lowercase versions like must, should, etc. Or even mixed.
    And the best one is NOT RECOMMENDED. He is very unique.
`

export const RFC2119BoilerplateTXTBlock = `
    The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
    NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED",  "MAY", and
    "OPTIONAL" in this document are to be interpreted as described in
    RFC 2119.
`

export const RFC8174BoilerplateTXTBlock = `
    The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", 
    "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this 
    document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] 
    when, and only when, they appear in all capitals, as shown here.
`

export const copyrightNoticeWithCurrentYearTXTBlock = `
    Copyright Notice

    Copyright (c) ${new Date().getFullYear()} IETF Trust and the persons identified as the
    document authors.  All rights reserved.
`

export const textLicense6biiTXTBlock = `
    This document is subject to BCP 78 and the IETF Trust’s Legal Provisions Relating to IETF
    Documents (http://trustee.ietf.org/license-info) in effect on the date of publication of this
    document. Please review these documents carefully, as they describe your rights and restrictions
    with respect to this document.
`
export const textLicense6ciiTXTBlock = `
    This document may not be modified, and derivative works of it may not be created, and it may not
    be published except as an Internet-Draft.
`

export const textLicense6ciTXTBlock = `
    This document may not be modified, and derivative works of it may not be created, except to
    format it for publication as an RFC or to translate it into languages other than English.
`

export const statusOfMemoTXTBlock = `
Status of This Memo

   This Internet-Draft is submitted in full conformance with the
   provisions of BCP 78 and BCP

   Internet-Drafts are working documents of the Internet Engineering
   Task Force (IETF).  Note that other groups may also distribute
   working documents as Internet-Drafts.  The list of current Internet-
   Drafts is at https://datatracker.ietf.org/drafts/current/.

   Internet-Drafts are draft documents valid for a maximum of six months
   and may be updated, replaced, or obsoleted by other documents at any
   time.  It is inappropriate to use Internet-Drafts as reference
   material or to cite them other than as "work in progress."

   This Internet-Draft will expire on 8 September 2023.
`

export const statusOfMemoNumberedTXTBlock = `
1. Status of This Memo

   This Internet-Draft is submitted in full conformance with the
   provisions of BCP 78 and BCP
`

export const copyrightNoticeTXTBlock = `
Copyright Notice
   Copyright (c) 2023 IETF Trust and the persons identified as the
   document authors.  All rights reserved.
   This document is subject to BCP 78 and the IETF Trust's Legal
   Provisions Relating to IETF Documents (https://trustee.ietf.org/
   license-info) in effect on the date of publication of this document.
   Please review these documents carefully, as they describe your rights
   and restrictions with respect to this document.  Code Components
   extracted from this document must include Revised BSD License text as
   described in Section 4.e of the Trust Legal Provisions and are
   provided without warranty as described in the Revised BSD License.
`

export const copyrightNoticeNumberedTXTBlock = `
1. Copyright Notice
   Copyright (c) 2023 IETF Trust and the persons identified as the
   document authors.  All rights reserved.
`
