export const MODES = {
  NORMAL: 0,
  FORGIVE_CHECKLIST: 1,
  SUBMISSION: 2
}

/**
 * Get a mode number by name
 *
 * @param {string} name Name of the mode
 * @returns {number} Mode Number
 */
export function getModeByName (name) {
  const normalizedName = name.toLowerCase()
  switch (normalizedName) {
    case 'normal':
    case 'norm':
    case 'n':
      return MODES.NORMAL
    case 'forgive-checklist':
    case 'f-c':
    case 'fc':
    case 'f':
      return MODES.FORGIVE_CHECKLIST
    case 'submission':
    case 'sub':
    case 's':
      return MODES.SUBMISSION
    default:
      throw new Error('Invalid Mode')
  }
}
