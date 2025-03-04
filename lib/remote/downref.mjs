const DOWNREF_REGISTRY_URL = 'https://datatracker.ietf.org/doc/downref/'
let cachedDownrefRegistry = null

/**
 * Fetch and parse the Downref Registry HTML to extract references.
 * Caches the result to avoid redundant network requests.
 * @returns {Promise<Set<string>>} - A set of references from the Downref Registry.
 */
async function fetchDownrefRegistry () {
  if (cachedDownrefRegistry) {
    return cachedDownrefRegistry
  }

  try {
    const response = await fetch(DOWNREF_REGISTRY_URL, { credentials: 'omit' })
    const html = await response.text()
    const rfcRegex = /<a href="\/doc\/rfc(\d+)\/">([^<]+)<\/a>/g
    const referenceRegex = /<a href="\/doc\/(?:rfc|draft-[^/]+)\/">([^<]+)<\/a>/g
    const references = new Set()
    let match

    while ((match = rfcRegex.exec(html)) !== null) {
      references.add(`RFC ${match[1].trim()}`)
    }

    while ((match = referenceRegex.exec(html)) !== null) {
      references.add(match[1].trim())
    }

    cachedDownrefRegistry = references
    return references
  } catch (err) {
    throw new Error(`Failed to fetch Downref Registry: ${err.message}`)
  }
}

/**
 * Validate references against the Downref Registry.
 * @param {string[]} references - List of references to validate.
 * @returns {Promise<string[]>} - A list of references found in the Downref Registry.
 */
export async function checkReferencesInDownrefs (references) {
  const downrefRegistry = await fetchDownrefRegistry()

  const foundDownrefs = []

  references.forEach(ref => {
    const refRegex = new RegExp(`\\b${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')

    for (const downref of downrefRegistry) {
      if (refRegex.test(downref)) {
        foundDownrefs.push(ref)
        break
      }
    }
  })

  return foundDownrefs
}
