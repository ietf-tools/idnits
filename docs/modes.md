# Validation modes

idnits checks a document at one of three stages of its life. The mode says which stage, and so which findings matter and how much. The modes are not strictness levels: each one reports what matters at its stage, and some findings are more severe in `submission` than in `normal`.

| Mode | Stage | Who runs it |
|---|---|---|
| `normal` (default) | Before RFC publication | Authors, chairs, ADs and reviewers checking a document headed for the RFC Editor |
| `forgive-checklist` | Conversion of an approved draft into an RFC | The RFC Editor |
| `submission` | Internet-Draft submission | Datatracker, on every upload |

- [Selecting a mode](#selecting-a-mode)
- [The modes](#the-modes)
- [Severity of each finding](#severity-of-each-finding)
- [Exit codes](#exit-codes)
- [Remote lookups and `--offline`](#remote-lookups-and---offline)
- [Locations](#locations)

## Selecting a mode

On the command line, use `--mode` (or `-m`) with the name of the mode or one of its shorthands:

| Mode | Shorthands |
|---|---|
| `normal` | `norm`, `n` |
| `forgive-checklist` | `f-c`, `fc`, `f` |
| `submission` | `sub`, `s` |

```sh
idnits --mode submission draft-ietf-abcd-efgh-01.xml
```

In the library, pass the mode as the `mode` option, using the `MODES` constants (or `getModeByName()` from `lib/config/modes.mjs` to convert a name):

```js
import { checkNits, MODES } from '@ietf-tools/idnits'

const results = await checkNits(raw, 'draft-ietf-abcd-efgh-01.xml', { mode: MODES.SUBMISSION })
```

Without a mode, `normal` is used.

## The modes

### `normal`: before RFC publication

The full set of nits for a document headed for the RFC Editor: required sections, boilerplate, references and the status of the documents they cite, BCP 14 keywords, example domains and addresses, layout. Anything that would hold up publication is an Error.

### `forgive-checklist`: RFC Editor conversion

The RFC Editor converts an approved draft into an RFC and fixes many nits along the way. They don't want to wade through Errors about things they haven't fixed yet, so many of the Errors of `normal` become Warnings (and one Warning, `OBSOLETE_INFORMATIVE_REFERENCE`, a Comment). The checks run are those of `normal`; what stays an Error is what the conversion doesn't fix by itself, such as a missing abstract or an empty section.

### `submission`: Internet-Draft submission

Datatracker runs idnits on every Internet-Draft upload:

```sh
idnits --mode submission --output json --no-color <declared name>-<rev>.<ext>
```

It runs on the staged copy of the upload, named after the name the document declares and its revision, whatever the name of the uploaded file. Errors in `submission` are expected to block the upload once idnits3 becomes a required check, so this mode reports what matters at that early stage:

- Errors are what an Internet-Draft must have from its first upload: a valid name, an abstract, the Internet-Draft boilerplate, the copyright and IPR notices. Some are more severe here than in `normal`, such as an invalid name or the `prepTime` attribute of a prepped XML document.
- It is silent about what only matters before publication: the status of cited documents and downrefs, BCP 14 keyword usage, example domains, IP addresses, term spelling, whether the Introduction, Security Considerations, IANA Considerations, References and Authors' Addresses sections are there, and most layout nits.
- An Abstract, Introduction, Security Considerations or IANA Considerations section that is there but empty is a Warning rather than an Error, so an early draft with a placeholder section can still be uploaded.
- It checks the revision against Datatracker (`DUPLICATE_DOC_VERSION`, `UNEXPECTED_DOC_VERSION`), which the other modes don't.

## Severity of each finding

Every code the library can report, with its severity in each mode. `—` means not reported in that mode. *Format* says whether the check applies to text documents, XML documents or both. Where the severity depends on more than the mode, the code has a row for each case, and the notes say which.

Checks marked *(drafts)* or *(RFCs)* only apply to that kind of document. A check that looks something up on Datatracker or the RFC Editor site is marked *(lookup)*, and *(lookup, offline)* if `--offline` skips it: see [Remote lookups](#remote-lookups-and---offline).

### Errors that stop the check

A document that can't be parsed isn't checked: the CLI exits with code `1`, and `checkNits()` rejects with a `ValidationError` of one of these names, in every mode.

| Code | Format | Notes |
|---|---|---|
| `XML_PARSING_FAILED` | XML | Not well-formed XML |
| `XML_UNSUPPORTED_VERSION` | XML | `version` attribute other than 2 or 3 |
| `XML_UNRECOGNIZED_DOC_KIND` | XML | Neither a draft nor an RFC, from `<seriesInfo>`, `docName`, `number` or the file name |
| `TXT_PARSING_FAILED` | text | |

### File names and revisions

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `FILENAME_MISSING_EXTENSION` | Warning | Warning | Error | both | |
| `FILENAME_EXTENSION_INVALID` | Warning | Warning | Error | both | Not `.txt` or `.xml` |
| `FILENAME_TOO_MANY_DOTS` | Warning | Warning | Error | both | |
| `FILENAME_INVALID_CHARS` | Warning | Warning | Error | both | Characters Datatracker refuses in an upload; also the name rule below, when the document declares no name |
| `DOCNAME_MISSING` | Warning | Warning | Error | XML | (drafts) No `docName` attribute |
| `DOCUMENT_NAME_MISSING` | Warning | Warning | Error | text | (drafts) No name on the first page |
| `DOCNAME_MISSING_DRAFT_PREFIX` | Warning | Warning | Error | both | (drafts) Declared name doesn't start with `draft-` |
| `DOCNAME_INVALID_CHARS` | Warning | Warning | Error | both | (drafts) Declared name has characters other than lowercase letters, digits and hyphens |
| `DOCNAME_TOO_LONG` | Warning | Warning | Error | both | (drafts) Over 50 characters without the revision |
| `DOCNAME_EMPTY_COMPONENT` | Warning | Warning | Error | both | (drafts) Adjacent or trailing hyphens |
| `DOCNAME_MISSING_COMPONENTS` | Warning | Warning | Error | both | (drafts) Fewer than 3 components |
| `DOCNAME_INVALID_VERSION_SUFFIX` | Warning | Warning | Error | both | (drafts) No two-digit revision |
| `FILENAME_MISSING_DRAFT_PREFIX` | Warning | Warning | Error | both | (drafts) As the `DOCNAME_` code, for the file name when the document declares no name |
| `FILENAME_TOO_LONG` | Warning | Warning | Error | both | (drafts) Same |
| `FILENAME_EMPTY_COMPONENT` | Warning | Warning | Error | both | (drafts) Same |
| `FILENAME_MISSING_COMPONENTS` | Warning | Warning | Error | both | (drafts) Same |
| `FILENAME_INVALID_VERSION_SUFFIX` | Warning | Warning | Error | both | (drafts) Same; also when the file name is the declared name without its revision |
| `FILENAME_DOCNAME_MISMATCH` | Error | Warning | Warning | both | File name isn't the declared name (drafts) or `rfcN` (RFCs) |
| `DUPLICATE_DOC_VERSION` | — | — | Warning | both | (drafts, lookup, offline) This revision is already on Datatracker |
| `UNEXPECTED_DOC_VERSION` | — | — | Warning | both | (drafts, lookup, offline) Revision older than Datatracker's, leaving a gap, or not `-00` for a new draft |

### Encoding, characters and layout

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `INVALID_ENCODING` | Error | Warning | — | both | Not UTF-8 |
| `INVALID_CTRL_CODES` | Error | Warning | — | both | Control characters other than LF, CR and FF |
| `TABS_NOT_ALLOWED` | Error | Warning | — | text | |
| `TABS_IN_CODE` | Warning | Warning | Warning | XML | Tabs xml2rfc expands in `<sourcecode>` or ASCII art |
| `TABS_AS_WHITESPACE` | Comment | Comment | Comment | XML | Other tabs |
| `NON_DISPLAYABLE_CHARACTER` | Warning | Warning | Warning | both | Bidi controls, zero width space, word joiner, misplaced BOM |
| `NON_NFC_TEXT` | Comment | Comment | Comment | both | |
| `NON_ASCII_CHARACTERS` | Comment | Comment | Comment | both | |
| `LINE_TOO_LONG` | Error | Warning | Warning | text | Over 72 characters |
| `RAGGED_RIGHT` | Error | Warning | — | text | |
| `PAGE_TOO_LONG` | Warning | Warning | — | text | |
| `PAGES_NOT_SEPARATED_BY_FORMFEEDS` | Warning | Warning | — | text | (drafts) |
| `DOCUMENT_CONTAINS_FORM_FEED_NOT_ON_SEPARATE_LINE` | Comment | Comment | Comment | text | (drafts) |
| `DOCUMENT_NOT_CONTAINS_PAGE_NUMBERING` | Comment | Comment | Comment | text | |
| `DOCUMENT_HAVE_MORE_15_PAGES_OR_MISS_TABLE_OF_CONTENTS` | Error | Error | Warning | text | (drafts) More than 15 pages and no table of contents |
| `SECTION_TITLE_HAS_UNEXPECTED_INDENTATION` | Warning | Warning | — | text | (drafts) |
| `FIRST_LINE_STARTS_WITH_PK_OR_BM` | Comment | Comment | — | text | |
| `TOKEN_SPLIT_ACROSS_LINES` | Warning | Warning | — | text | Email address broken mid-word |
| `ARTWORK_TOO_WIDE` | Error | Warning | Warning | XML | Wider than the 72 columns of the text output |
| `ARTWORK_TOO_TALL` | Comment | Comment | Comment | XML | Longer than a page of the text output |

### XML vocabulary and processing

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `XML_UNEXPECTED_SERIESINFO_NAME` | Warning | Warning | Warning | XML | |
| `DEPRECATED_ELEMENT` | Warning | Warning | Warning | XML | |
| `DEPRECATED_ATTRIBUTE` | Warning | Warning | Warning | XML | |
| `RFC_PREPTIME_ATTRIBUTE` | Comment | Comment | Error | XML | Document prepped by xml2rfc |
| `PREP_TOOL_OUTPUT_PRESENT` | Comment | Comment | Warning | XML | Prep tool output without `prepTime` |
| `LINE_PI` | Comment | Comment | — | XML | `<?line?>` processing instructions |
| `UNNECESSARY_CODE_BEGINS` | Warning | Warning | — | XML | `<CODE BEGINS>` inside `<sourcecode>` |
| `MISSING_SOURCECODE_TAG` | Warning | Warning | — | XML | `<CODE BEGINS>` outside `<sourcecode>` |
| `TEXT_DOC_REF` | Warning | Warning | — | XML | Text like `[RFC1234]` instead of an `<xref>` |

### Document structure

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `INVALID_DOCUMENT_STRUCTURE` | Error | Error | Error | text | No header or title found |
| `MISSING_ABSTRACT_SECTION` | Error | Error | Error | both | |
| `EMPTY_ABSTRACT_SECTION` | Error | Error | Warning | text | |
| `INVALID_ABSTRACT_SECTION` | Error | Error | Warning | XML | Empty `<abstract>` |
| `INVALID_ABSTRACT_SECTION_CHILD` | Error | Error | Error | XML | |
| `INVALID_ABSTRACT_SECTION_REF` | Error | Warning | — | both | Citation or section reference in the abstract |
| `INVALID_ABSTRACT_SECTION_URL` | Error | Warning | — | text | |
| `INVALID_ABSTRACT_SECTION_ID_REF` | Error | Warning | — | text | |
| `INVALID_ABSTRACT_SECTION_CUSTOM_REF` | Error | Warning | — | text | |
| `ABSTRACT_SECTION_IS_NUMBERED` | Error | Error | Error | text | |
| `STATUS_OF_THIS_MEMO_SECTION_IS_NUMBERED` | Error | Error | Error | text | |
| `COPYRIGHT_NOTICE_SECTION_IS_NUMBERED` | Error | Error | Error | text | |
| `MISSING_INTRODUCTION_SECTION` | Error | Warning | — | both | |
| `EMPTY_INTRODUCTION_SECTION` | Error | Error | Warning | text | |
| `INVALID_INTRODUCTION_SECTION` | Error | Error | Warning | XML | Empty section |
| `INVALID_INTRODUCTION_SECTION_CHILD` | Error | Error | Error | XML | |
| `MISSING_SECURITY_CONSIDERATIONS_SECTION` | Error | Warning | — | both | |
| `EMPTY_SECURITY_CONSIDERATIONS_SECTION` | Error | Error | Warning | text | |
| `INVALID_SECURITY_CONSIDERATIONS_SECTION` | Error | Error | Warning | XML | Empty section |
| `INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD` | Error | Error | Error | XML | |
| `MISSING_IANA_CONSIDERATIONS_SECTION` | Error | Warning | — | both | (drafts) |
| `MISSING_IANA_CONSIDERATIONS_SECTION` | Comment | Comment | — | both | (RFCs) |
| `INVALID_IANA_CONSIDERATIONS_SECTION` | Error | Error | Warning | both | Empty section |
| `INVALID_IANA_CONSIDERATIONS_SECTION_CHILD` | Error | Error | Error | XML | |
| `MISSING_AUTHOR_SECTION` | Error | Warning | — | both | |
| `MISUSED_POSSESSIVE_MARK` | Warning | Warning | — | text | In the Authors' Addresses title |
| `TOO_MANY_AUTHORS` | Comment | Comment | — | XML | More than 5 |
| `EMPTY_AUTHOR_ORGANIZATION` | Comment | Comment | Comment | XML | |
| `MISSING_LATIN_AUTHOR_NAME` | Error | Warning | Warning | XML | Non-Latin `fullname` without `asciiFullname` |
| `MISSING_AUTHOR_FULLNAME` | Warning | Warning | — | XML | |
| `MISSING_AUTHOR_FULLNAME_WITH_ASCII` | Warning | Warning | — | XML | |
| `INVALID_AUTHOR_ROLE` | Warning | Warning | — | XML | |

### Date, category, updates and obsoletes

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `MISSING_DOC_DATE` | Warning | Warning | Warning | both | Date can't be determined |
| `MISSING_DOC_DATE` | Comment | Comment | Comment | XML | No `<date>`: the prep tool will fill it in |
| `DOC_DATE_IN_PAST` | Warning | Warning | Warning | both | More than 3 days |
| `DOC_DATE_IN_FUTURE` | Warning | Warning | Warning | both | More than 3 days |
| `MISSING_DOC_CATEGORY` | Warning | Warning | Warning | both | XML: only when `docName` doesn't start with `draft-` |
| `INVALID_DOC_CATEGORY` | Warning | Warning | Warning | both | |
| `OBSOLETES_NOT_IN_ABSTRACT` | Comment | Comment | — | text | |
| `OBSOLETES_NOT_IN_ABSTRACT` | Warning | Warning | — | XML | |
| `UPDATES_NOT_IN_ABSTRACT` | Comment | Comment | — | text | |
| `UPDATES_NOT_IN_ABSTRACT` | Warning | Warning | — | XML | |
| `MENTIONED_NOT_IN_OBSOLETES` | Comment | Comment | — | text | |
| `MENTIONED_NOT_IN_UPDATES` | Comment | Comment | — | text | |
| `OBSOLETES_NOT_IN_RFC` | Warning | Warning | — | XML | |
| `UPDATES_NOT_IN_RFC` | Warning | Warning | — | XML | |
| `OBSOLETES_CONTAINS_INVALID_CHARACTERS` | Warning | Warning | — | text | |
| `UPDATE_CONTAINS_INVALID_CHARACTERS` | Warning | Warning | — | text | |
| `OBSOLETES_RFC_NOT_FOUND` | Warning | Warning | — | both | (lookup, offline) |
| `OBSOLETES_OBSOLETED_RFC` | Warning | Warning | — | both | (lookup, offline) |
| `UPDATES_RFC_NOT_FOUND` | Warning | Warning | — | both | (lookup, offline) |
| `UPDATES_OBSOLETED_RFC` | Warning | Warning | — | both | (lookup, offline) |
| `UPDATES_UPDATED_RFC` | Warning | Warning | — | XML | (lookup, offline) |

### Internet-Draft boilerplate (text)

These checks apply to text drafts only. An XML draft gets this boilerplate from xml2rfc.

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `ID_INDICATOR_MISSING` | Error | Error | Error | text | (drafts) |
| `EXPIRES_LINE_MISSING` | Error | Error | Error | text | (drafts) |
| `EXPIRES_LINE_MISMATCH` | Error | Error | Error | text | (drafts) |
| `ACCEPTABLE_PARAGRAPH_NOTING_THAT_DRAFT_MISSING` | Error | Error | Error | text | (drafts) |
| `ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_MISSING` | Error | Error | Error | text | (drafts) |
| `ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_REPEATED_IN_THE_TEXT` | Error | Error | Error | text | (drafts) |
| `ACCEPTABLE_PARAGRAPH_PROVIDING_FOR_PERIOD_OF_VALIDITY_MISSING` | Error | Error | Error | text | (drafts) |
| `SUBMISSION_COMPLIANCE_LINE_MISSING` | Error | Error | Error | text | (drafts) |
| `SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC` | Error | Error | Error | text | (drafts) |

### Copyright, licenses and IPR

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `COPYRIGHT_LINE_MISSING` | Error | Error | Error | text | |
| `COPYRIGHT_MORE_THAN_ONE_LINE` | Warning | Warning | Warning | text | |
| `COPYRIGHT_YEAR_MISMATCH` | Warning | Warning | Warning | text | Not the current year, or the library's `year` option |
| `OBSOLETE_COPYRIGHT_LINE` | Error | Error | Error | text | |
| `TLP5_LICENSE_RESTRICTION_NOTICE_MISSING` | Error | Error | Error | text | |
| `TLP5_LICENSE_RESTRICTION_NOTICE` | Warning | Warning | Warning | text | `draft-ietf-` names only; TLP Section 6.c(i) |
| `TLP5_LICENSE_RESTRICTION_NOTICE` | Error | Error | Error | text | `draft-ietf-` names only; TLP Section 6.c(ii) |
| `TLP5_LICENSE_RESTRICTION_NOTICE_REPEATED` | Warning | Warning | Warning | text | |
| `CODE_BLOCK_MISSING_LICENSE` | Warning | Warning | — | text | |
| `COMMENT_OUT_OF_CODE_BLOCK` | Warning | Warning | Warning | text | |
| `MISSING_IPR_ATTRIBUTE` | Error | Error | Error | XML | |
| `INVALID_IPR_VALUE` | Warning | Warning | Warning | XML | |
| `FORBIDDEN_IPR_VALUE_FOR_STREAM` | Error | Warning | Error | XML | No-derivatives `ipr` in the IETF stream (lookup; with `--offline`, the stream comes from the name or `submissionType` only) |
| `FORBIDDEN_IPR_VALUE_FOR_STREAM` | Warning | Warning | Warning | XML | No-derivatives `ipr`, stream unknown |
| `UNNECESSARY_BOILERPLATE_TEXT` | Warning | Warning | Warning | XML | Boilerplate that xml2rfc generates, pasted in |
| `RFC_BOILERPLATE_MISSING` | Error | Warning | — | XML | (RFCs) Prepped, without `<boilerplate>` |
| `RFC_STATUS_BOILERPLATE_MISMATCH` | Error | Warning | — | XML | (RFCs) Status of This Memo isn't xml2rfc's |
| `RFC_COPYRIGHT_BOILERPLATE_MISMATCH` | Error | Warning | — | XML | (RFCs) Copyright Notice isn't xml2rfc's |

### Streams

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `SUBMISSION_TYPE_MISSING` | Comment | Comment | Comment | XML | Treated as `IETF` |
| `SUBMISSION_TYPE_INVALID` | Error | Error | Error | XML | |
| `SUBMISSION_TYPE_MISMATCH` | Error | Error | Error | XML | `submissionType` vs. a `draft-iab-` or `draft-irtf-` name |
| `SUBMISSION_TYPE_UNEXPECTED` | Error | Warning | Error | both | (lookup, offline) Datatracker has the document in another stream |
| `SUBMISSION_TYPE_UNEXPECTED` | Error | Warning | Comment | both | (lookup, offline) Datatracker has no stream for it yet |
| `CROSS_STREAM_OBSOLETES_UPDATES` | Warning | Warning | Warning | both | (lookup, offline) Updates or obsoletes an RFC of another stream |
| `CROSS_STREAM_OBSOLETES_UPDATES` | Comment | Comment | Comment | both | (lookup, offline) Same, the RFC is Legacy or this document's stream is unknown |

For text documents, `SUBMISSION_TYPE_UNEXPECTED` compares the stream implied by a `draft-ietf-`, `draft-iab-` or `draft-irtf-` name (drafts), or named in the header (RFCs).

### Requirement keywords and terms

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `MISSING_REQLEVEL_BOILERPLATE` | Error | Warning | — | both | Keywords, without BCP 14 boilerplate or reference |
| `MISSING_REQLEVEL_BOILERPLATE` | Warning | Warning | — | both | Keywords and reference, without boilerplate |
| `MISSING_REQLEVEL_BOILERPLATE` | Error | Error | — | text | A boilerplate close to the BCP 14 one |
| `MISSING_REQLEVEL_KEYWORDS` | Warning | Warning | — | both | |
| `MISSING_NOTRECOMMENDED_IN_BOILERPLATE` | Warning | Warning | — | both | |
| `MISSING_REQLEVEL_REF` | Error | Error | — | XML | |
| `BCP14_CITED_INSTEAD_OF_RFCS` | Warning | Warning | — | both | |
| `MISSING_RFC2119_REF` | Warning | Warning | — | both | |
| `MISSING_RFC8174_REF` | Warning | Warning | — | both | |
| `INVALID_REQLEVEL_KEYWORD` | Comment | Comment | — | XML | |
| `INCORRECT_KEYWORD_SPELLING` | Comment | Comment | — | text | |
| `MISSING_BCP14_TAGS` | Comment | Comment | — | XML | |
| `INCORRECT_TERM_SPELLING` | Comment | Comment | — | both | RFC Editor terms list |

### Domain names and IP addresses

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `INVALID_DOMAIN_TLD` | Warning | Warning | — | both | Not an example domain |
| `INVALID_ARPA_DOMAIN` | Warning | Warning | — | both | |
| `POSSIBLE_INVALID_TLD` | Comment | Comment | — | both | GitHub or GitLab domain |
| `INVALID_IPV4_ADDRESS` | Warning | Warning | — | both | |
| `INVALID_IPV6_ADDRESS` | Warning | Warning | — | both | |

### References

| Code | normal | forgive-checklist | submission | Format | Notes |
|---|---|---|---|---|---|
| `MISSING_REFERENCES_SECTION` | Error | Warning | — | text | |
| `EMPTY_REFERENCES_SECTION` | Error | Warning | — | text | |
| `REFERENCE_TYPE_NOT_DECLARED` | Error | Warning | — | text | Neither normative nor informative |
| `UNCLASSIFIED_REFERENCES_SUBSECTION` | Error | Warning | — | text | |
| `MULTIPLE_REFERENCES_SECTION_TITLES` | Warning | Warning | — | text | |
| `MISSING_REFERENCES_NAME` | Error | Warning | — | XML | |
| `INVALID_REFERENCES_NAME` | Error | Warning | — | XML | |
| `REFERENCE_NOT_USED` | Warning | Warning | Warning | both | |
| `REFERENCE_MISSING_IN_REFERENCE_SECTION` | Warning | Warning | Warning | text | |
| `PLACEHOLDER_REFERENCE` | Comment | Comment | Comment | text | e.g. `[RFCXXXX]` |
| `DOCUMENT_USE_NUMERIC_REFERENCES` | Comment | Comment | — | text | |
| `DOCUMENT_USE_STRING_REFERENCES` | Comment | Comment | — | text | |
| `RFC_REFERENCE_URL_FORMAT` | Warning | Warning | — | XML | Link to `/rfc/` instead of `/info/` |
| `RFC_REFERENCE_URL_FORMAT` | Comment | Comment | — | text | Same; xml2rfc renders references without a target this way |
| `DOWNREF_TO_LOWER_STATUS` | Error | Warning | — | both | (lookup) Not in the Downref Registry |
| `DOWNREF_TO_LOWER_STATUS_IN_REGISTRY` | Warning | Warning | — | both | (lookup) |
| `POSSIBLE_DOWNREF` | Error | Warning | — | both | (lookup) Status of a normative RFC can't be fetched |
| `DOWNREF_REGISTRY_UNAVAILABLE` | Comment | Comment | — | both | (lookup) The Downref Registry can't be fetched |
| `NORMATIVE_REFERENCE_TO_DRAFT` | Warning | Warning | — | both | (lookup) Not in published RFCs |
| `NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT` | Warning | Warning | — | both | (lookup) |
| `NORMATIVE_REFERENCE_EXTERNAL` | Comment | Comment | — | both | Standards Track and BCP documents, not published RFCs |
| `OBSOLETE_REFERENCE` | Error | Warning | — | both | (lookup) Normative or unclassified |
| `OBSOLETE_INFORMATIVE_REFERENCE` | Warning | Comment | — | both | (lookup) |
| `UNDEFINED_STATUS` | Comment | Comment | — | both | (lookup) Status of a cited RFC can't be fetched |
| `UNKNOWN_STATUS` | Comment | Comment | — | both | (lookup) |
| `UNDEFINED_STATE` | Warning | Warning | — | both | (lookup) State of a cited draft can't be fetched; not in published RFCs |
| `INVALID_STATE_FOR_DRAFT` | Warning | Warning | — | both | (lookup) Cited draft is now an RFC; not in published RFCs |
| `OUTDATED_DRAFT` | Warning | Warning | — | both | (lookup) |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The check completed, whatever it found (unless `--fail-on` is used) |
| `1` | The check could not be completed: invalid arguments or remote settings, a document that can't be read, fetched or parsed (see [Errors that stop the check](#errors-that-stop-the-check)), or an unexpected failure |
| `2` | The check completed and found at least one nit at or above the `--fail-on` severity (`errors` > `warnings` > `comments`) |

Datatracker doesn't use `--fail-on`: it treats any nonzero exit code as "could not complete", and reads the findings from the JSON output. There, `result` is `fail` when there is at least one Error, and `nitsBySeverity` counts each severity.

`--fail-on` counts what is left after `--filter`, so filtering out a severity also keeps it from failing the check.

## Remote lookups and `--offline`

Some checks look up the document, and the documents it cites, on Datatracker and the RFC Editor site. `--offline` (the `offline` option of the library) skips some of them only:

| Lookup | Used by | Skipped with `--offline` |
|---|---|---|
| The document's stream and latest revision on Datatracker | `SUBMISSION_TYPE_UNEXPECTED`, `FORBIDDEN_IPR_VALUE_FOR_STREAM`, `DUPLICATE_DOC_VERSION`, `UNEXPECTED_DOC_VERSION` | Yes |
| The RFCs the document updates or obsoletes, on Datatracker and the RFC Editor site | `CROSS_STREAM_OBSOLETES_UPDATES`, `OBSOLETES_*_RFC`, `UPDATES_*_RFC` | Yes |
| Status of the cited RFCs, on the RFC Editor site | downref, obsolete and status findings of [References](#references) | No |
| State and revisions of the cited drafts, on Datatracker | `NORMATIVE_REFERENCE_TO_*`, `UNDEFINED_STATE`, `INVALID_STATE_FOR_DRAFT`, `OUTDATED_DRAFT` | No |
| The Downref Registry, on Datatracker | `DOWNREF_TO_LOWER_STATUS*`, `DOWNREF_REGISTRY_UNAVAILABLE` | No |

The lookups about cited documents are only made in `normal` and `forgive-checklist`, as `submission` doesn't run those checks.

A lookup that fails, or times out, prints a warning and the check goes on without its result: an RFC whose status can't be fetched is reported as `UNDEFINED_STATUS` (and, if normative, `POSSIBLE_DOWNREF`), a draft as `UNDEFINED_STATE`. A Downref Registry that can't be fetched when it is needed (an error or a timeout) doesn't stop the check either: each downref is reported as `DOWNREF_TO_LOWER_STATUS`, without telling whether it is in the registry, and one `DOWNREF_REGISTRY_UNAVAILABLE` comment per document names the reason.

The services used and the time allowed for each lookup can be changed: see [Remote lookups](../README.md#remote-lookups) in the README.

## Locations

A finding about a specific spot of the document says where it is:

- `lines`: an array of `{ line, pos }`, where `line` and `pos` (the column) both count from 1. In the JSON output, this array is the `line` field.
- XML findings also carry `path`, the element or attribute the finding is about (e.g. `rfc.middle.section[2].section[1].t[0]`), and `label`, a readable version of it (e.g. `Section 3.2 (Security Considerations), paragraph 1`). `checkNits()` adds the `label`, and the `lines` of the element in the source when the check gave none (`labelFindings()` and `addXmlSourceLines()` do the same for a custom task runner).

A finding about the whole document, such as a missing section, carries none of these. A few text findings carry a `path` naming where the parser keeps the text (e.g. `data.content.abstract`); it isn't an XML location.
