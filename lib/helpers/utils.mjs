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

/**
 * Helping function for domain restriction check
 *
 * @param {string} fqdn
 * @returns {boolean}
 */
export function isRestrictedFQDN (fqdn) {
  if (/^(?:[a-z0-9_-]+\.)*example(?:\.(?:com|org|net))?$/i.test(fqdn)) {
    return true
  }
  if (/^(?:[a-z0-9_-]+\.)*(?:urn|uri|in-addr)\.arpa$/i.test(fqdn)) {
    return true
  }
  if (/^[0-9]+\.[0-9]+\./.test(fqdn)) {
    return true
  }
  if (fqdn === 'www.ietf.org') {
    return true
  }
  if (/^.\..\../.test(fqdn)) {
    return true
  }
  if (/.*@$/.test(fqdn)) {
    return true
  }
  return false
}
