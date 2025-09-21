/* c8 ignore start */
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined' && !window.DRAFTFORGE
const cachedDownrefRegistry = new Set()
const rfcRegex = /<a href="\/doc\/rfc(\d+)\/">([^<]+)<\/a>/g
const referenceRegex = /<a href="\/doc\/(?:rfc|draft-[^/]+)\/">([^<]+)<\/a>/g

/**
 * Fetch and parse the Downref Registry HTML to extract references.
 * Caches the result to avoid redundant network requests.
 * @returns {Promise<Set<string>>} - A set of references from the Downref Registry.
 */
async function fetchDownrefRegistry () {
  if (cachedDownrefRegistry.size > 0) {
    return cachedDownrefRegistry
  }

  try {
    const response = isBrowser
      ? await fetch('/idnits3/api/downref')
      : await fetch('https://datatracker.ietf.org/doc/downref/', { credentials: 'omit' })
    const html = await response.text()
    let match

    while ((match = rfcRegex.exec(html)) !== null) {
      cachedDownrefRegistry.add(`RFC ${match[1].trim()}`)
    }

    while ((match = referenceRegex.exec(html)) !== null) {
      cachedDownrefRegistry.add(match[1].trim())
    }

    return cachedDownrefRegistry
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
/* c8 ignore end */
