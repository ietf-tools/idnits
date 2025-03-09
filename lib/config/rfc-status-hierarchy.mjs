export const rfcStatusHierarchy = [
  {
    name: 'Internet Standard',
    regex: /internet standard|\bstd\b/ig,
    category: 2
  },
  {
    name: 'Draft Standard',
    regex: /draft standard|\bds\b/ig,
    category: 2
  },
  {
    name: 'Proposed Standard',
    regex: /proposed standard|\bps\b/ig,
    category: 2
  },
  {
    name: 'Standards Track',
    regex: /standards track/ig,
    category: 2
  },
  {
    name: 'Best Current Practice',
    regex: /best current practice|\bbcp\b/ig,
    category: 2
  },
  {
    name: 'Informational',
    regex: /informational|\binfo\b/ig,
    category: 1
  },
  {
    name: 'Experimental',
    regex: /experimental|\bexp\b/ig,
    category: 1
  },
  {
    name: 'Historic',
    regex: /historic|\bhist\b/ig,
    category: 1
  }
]

/**
 * Extracts the highest status category based on RFC status hierarchy.
 *
 * @param {string} statusText - The status text to check.
 * @returns {number|null} - The category of the status or null if not found.
 */
export function getStatusCategory (statusText) {
  for (const status of rfcStatusHierarchy) {
    status.regex.lastIndex = 0
    if (status.regex.test(statusText)) {
      return status.category
    }
  }
  return null
}
