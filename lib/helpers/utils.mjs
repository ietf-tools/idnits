const MIN_SECTION_CONTENT_LENGTH = 2

/**
 * Checks if a document section contains meaningful content.
 *
 * @param {string[] | undefined} sectionContent - The content of the document section.
 * @returns {boolean} - Returns true if the section is non-empty and meets the minimum length requirement.
 */
export function hasMeaningfulContent (sectionContent) {
  return sectionContent?.length >= MIN_SECTION_CONTENT_LENGTH
}
