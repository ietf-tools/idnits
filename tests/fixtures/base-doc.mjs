import { generateTXTDoc } from '../generators/doc-txt.js'

// Derived from the actual parser output so the structure always matches what
// validators receive in production.  Tests that need specific field values
// should cloneDeep this and override the relevant fields, or call
// generateTXTDoc({ ... }) directly with overrides.
export const baseTXTDoc = await generateTXTDoc()

export const baseXMLDoc = {
  type: 'xml',
  filename: '',
  externalEntities: [],
  data: {
    rfc: { _attr: { category: 'std' } }
  }
}
