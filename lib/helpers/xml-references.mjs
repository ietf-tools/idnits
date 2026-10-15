// Comments and CDATA sections, whose content is not markup
const commentOrCdataRgx = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g
// Processing instructions other than the XML declaration
const piRgx = /<\?(?!xml\s)([^\s?]+)\s*([\s\S]*?)\?>/g

/**
 * Blank out comments and CDATA sections, keeping the length of the text so
 * that offsets in it stay valid
 *
 * @param {string} text XML text
 * @returns {string} Text with comments and CDATA sections replaced by spaces
 */
export function maskCommentsAndCdata (text) {
  return text.replace(commentOrCdataRgx, match => ' '.repeat(match.length))
}

/**
 * Find the processing instructions of an XML text, other than the XML declaration
 *
 * @param {string} text XML text
 * @returns {Array<{ target: string, content: string, offset: number }>} Processing instructions,
 *          with their offset in the text
 */
export function findProcessingInstructions (text) {
  return [...maskCommentsAndCdata(text).matchAll(piRgx)].map(match => ({
    target: match[1],
    content: match[2].trim(),
    offset: match.index
  }))
}
