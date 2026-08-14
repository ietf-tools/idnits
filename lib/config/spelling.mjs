/**
 * British / American spelling variant pairs.
 *
 * This data drives the spelling *consistency* check. It is deliberately not a
 * dictionary of "correct" spellings: RFC 7322 asks for consistency within a
 * document, so a pair is only interesting when both variants show up.
 *
 * Ambiguity flags
 * ---------------
 * Some forms are poor evidence of a document's overall convention even though
 * they remain useful for detecting a word spelled two ways in one document:
 *
 * - `usFormAmbiguous`: the "American" form is also standard British usage.
 *   This covers every -ize/-ise pair (Oxford spelling uses -ize) and words
 *   where the -og form has become the technical term everywhere ("analog
 *   signal", "dialog box"), or where the two spellings mean different things
 *   in British usage ("meter" the device vs "metre" the unit).
 * - `gbFormAmbiguous`: the "British" form is common in American technical
 *   prose ("greylist", "acknowledgement").
 *
 * A flagged side never counts toward the document-level convention verdict,
 * but both sides always count toward the same-word inconsistency check.
 */

/**
 * Build the -ize / -ise forms of a verb, including its -ization / -isation noun.
 *
 * @param {string} base American form ending in "ize" (e.g. "optimize")
 * @returns {Object} US and GB form arrays
 */
function izeForms (base) {
  const stem = base.slice(0, -3)
  return {
    us: [`${stem}ize`, `${stem}izes`, `${stem}ized`, `${stem}izing`, `${stem}ization`, `${stem}izations`],
    gb: [`${stem}ise`, `${stem}ises`, `${stem}ised`, `${stem}ising`, `${stem}isation`, `${stem}isations`]
  }
}

/**
 * Build the -yze / -yse forms of a verb. Unlike izeForms(), no nominalisation
 * is generated ("analyzation" is not a word; the noun is "analysis").
 *
 * @param {string} base American form ending in "yze" (e.g. "analyze")
 * @returns {Object} US and GB form arrays
 */
function yzeForms (base) {
  const stem = base.slice(0, -3)
  return {
    us: [`${stem}yze`, `${stem}yzes`, `${stem}yzed`, `${stem}yzing`],
    gb: [`${stem}yse`, `${stem}yses`, `${stem}ysed`, `${stem}ysing`]
  }
}

/**
 * Build the -or / -our forms of a noun. Suffixes are limited to those that
 * keep the u in British usage: "humorous" and "honorary" drop it in both
 * varieties and are therefore not generated.
 *
 * @param {string} base American form ending in "or" (e.g. "behavior")
 * @returns {Object} US and GB form arrays
 */
function ourForms (base) {
  const stem = base.slice(0, -2)
  const suffixes = ['', 's', 'ed', 'ing', 'al', 'ally', 'able', 'ably', 'ite', 'ites']
  return {
    us: suffixes.map(sfx => `${stem}or${sfx}`),
    gb: suffixes.map(sfx => `${stem}our${sfx}`)
  }
}

/**
 * Build the -er / -re forms of a noun.
 *
 * @param {string} base American form ending in "er" (e.g. "center")
 * @returns {Object} US and GB form arrays
 */
function reForms (base) {
  const stem = base.slice(0, -2)
  return {
    us: [`${stem}er`, `${stem}ers`, `${stem}ered`, `${stem}ering`],
    gb: [`${stem}re`, `${stem}res`, `${stem}red`, `${stem}ring`]
  }
}

/**
 * Build a pair from explicit form lists.
 *
 * @param {string[]} us American forms
 * @param {string[]} gb British forms
 * @returns {Object} US and GB form arrays
 */
function forms (us, gb) {
  return { us, gb }
}

/**
 * Spelling variant pairs.
 *
 * Each entry: { id, us: string[], gb: string[], usFormAmbiguous?, gbFormAmbiguous? }
 * `id` is the American headword and is what appears in nit messages.
 */
export const SPELLING_VARIANTS = [
  // -or / -our
  ...['behavior', 'color', 'favor', 'neighbor', 'labor', 'honor', 'endeavor', 'flavor', 'harbor', 'rigor', 'armor', 'odor', 'rumor'].map(w => ({ id: w, ...ourForms(w) })),

  // -er / -re
  ...['center', 'fiber', 'liter', 'kilometer', 'theater', 'caliber', 'luster', 'specter'].map(w => ({ id: w, ...reForms(w) })),
  // "meter" is the instrument in both varieties; only "metre" implies British usage.
  { id: 'meter', ...reForms('meter'), usFormAmbiguous: true },
  { id: 'maneuver', ...forms(['maneuver', 'maneuvers', 'maneuvered', 'maneuvering'], ['manoeuvre', 'manoeuvres', 'manoeuvred', 'manoeuvring']) },

  // -ize / -ise. The -ize side is Oxford spelling, so it is never evidence of
  // American convention on its own. Verbs that are always -ise (advertise,
  // comprise, exercise, supervise, ...) are intentionally absent.
  ...[
    'organize', 'recognize', 'authorize', 'standardize', 'normalize', 'initialize',
    'serialize', 'deserialize', 'synchronize', 'optimize', 'minimize', 'maximize',
    'prioritize', 'utilize', 'summarize', 'categorize', 'characterize', 'customize',
    'emphasize', 'realize', 'specialize', 'generalize', 'formalize', 'finalize',
    'itemize', 'modernize', 'randomize', 'virtualize', 'visualize', 'tokenize',
    'canonicalize', 'capitalize', 'centralize', 'decentralize', 'harmonize',
    'localize', 'internationalize', 'mobilize', 'neutralize', 'penalize',
    'publicize', 'sanitize', 'stabilize', 'symbolize', 'theorize', 'amortize',
    'parameterize', 'containerize', 'anonymize', 'pseudonymize', 'monetize',
    'legitimize', 'popularize', 'materialize', 'apologize', 'memorize'
  ].map(w => ({ id: w, ...izeForms(w), usFormAmbiguous: true })),

  // -yze / -yse. Oxford spelling keeps -yse, so this axis is a reliable signal.
  ...['analyze', 'paralyze', 'catalyze', 'hydrolyze'].map(w => ({ id: w, ...yzeForms(w) })),

  // Single vs doubled L
  { id: 'signaling', ...forms(['signaling', 'signaled', 'signaler'], ['signalling', 'signalled', 'signaller']) },
  { id: 'labeling', ...forms(['labeling', 'labeled', 'labels'], ['labelling', 'labelled', 'labells']) },
  { id: 'modeling', ...forms(['modeling', 'modeled', 'modeler'], ['modelling', 'modelled', 'modeller']) },
  { id: 'canceling', ...forms(['canceling', 'canceled'], ['cancelling', 'cancelled']) },
  { id: 'traveling', ...forms(['traveling', 'traveled', 'traveler', 'travelers'], ['travelling', 'travelled', 'traveller', 'travellers']) },
  { id: 'marshaling', ...forms(['marshaling', 'marshaled'], ['marshalling', 'marshalled']) },
  { id: 'tunneling', ...forms(['tunneling', 'tunneled'], ['tunnelling', 'tunnelled']) },
  { id: 'channeling', ...forms(['channeling', 'channeled'], ['channelling', 'channelled']) },
  { id: 'leveling', ...forms(['leveling', 'leveled'], ['levelling', 'levelled']) },
  { id: 'totaling', ...forms(['totaling', 'totaled'], ['totalling', 'totalled']) },
  { id: 'dialing', ...forms(['dialing', 'dialed'], ['dialling', 'dialled']) },
  { id: 'fueling', ...forms(['fueling', 'fueled'], ['fuelling', 'fuelled']) },
  // The doubling runs the other way for these.
  { id: 'enrollment', ...forms(['enrollment', 'enrollments', 'enroll', 'enrolls'], ['enrolment', 'enrolments', 'enrol', 'enrols']) },
  { id: 'fulfill', ...forms(['fulfill', 'fulfills'], ['fulfil', 'fulfils']) },
  { id: 'installment', ...forms(['installment', 'installments'], ['instalment', 'instalments']) },
  { id: 'skillful', ...forms(['skillful', 'skillfully'], ['skilful', 'skilfully']) },
  { id: 'willful', ...forms(['willful', 'willfully'], ['wilful', 'wilfully']) },
  { id: 'distill', ...forms(['distill', 'distills'], ['distil', 'distils']) },
  { id: 'instill', ...forms(['instill', 'instills'], ['instil', 'instils']) },

  // -og / -ogue. The short form is the standard technical term in both
  // varieties ("analog signal", "dialog box"), so it is not US evidence.
  { id: 'analog', ...forms(['analog', 'analogs'], ['analogue', 'analogues']), usFormAmbiguous: true },
  { id: 'dialog', ...forms(['dialog', 'dialogs'], ['dialogue', 'dialogues']), usFormAmbiguous: true },
  { id: 'catalog', ...forms(['catalog', 'catalogs', 'cataloged', 'cataloging'], ['catalogue', 'catalogues', 'catalogued', 'cataloguing']), usFormAmbiguous: true },
  { id: 'monolog', ...forms(['monolog', 'monologs'], ['monologue', 'monologues']), usFormAmbiguous: true },

  // -se / -ce. "license"/"licence" and "practice"/"practise" are excluded:
  // British usage splits them by part of speech, and "License" appears in the
  // Revised BSD boilerplate of nearly every draft.
  { id: 'defense', ...forms(['defense', 'defenses'], ['defence', 'defences']) },
  { id: 'offense', ...forms(['offense', 'offenses'], ['offence', 'offences']) },
  { id: 'pretense', ...forms(['pretense', 'pretenses'], ['pretence', 'pretences']) },

  // Assorted
  { id: 'acknowledgment', ...forms(['acknowledgment', 'acknowledgments'], ['acknowledgement', 'acknowledgements']), gbFormAmbiguous: true },
  { id: 'judgment', ...forms(['judgment', 'judgments'], ['judgement', 'judgements']), gbFormAmbiguous: true },
  { id: 'gray', ...forms(['gray', 'grays', 'grayed', 'graying', 'graylist', 'graylisted', 'graylisting'], ['grey', 'greys', 'greyed', 'greying', 'greylist', 'greylisted', 'greylisting']), gbFormAmbiguous: true },
  { id: 'artifact', ...forms(['artifact', 'artifacts'], ['artefact', 'artefacts']) },
  { id: 'aluminum', ...forms(['aluminum'], ['aluminium']) },
  { id: 'aging', ...forms(['aging'], ['ageing']) },
  // "program" is the computer program everywhere; only "programme" is a signal.
  { id: 'program', ...forms(['program', 'programs'], ['programme', 'programmes']), usFormAmbiguous: true }
]

/**
 * British-only markers with no direct American counterpart. These contribute
 * to the document-level convention verdict but can never be "inconsistent"
 * with a specific opposite spelling.
 */
export const BRITISH_MARKERS = ['whilst', 'amongst', 'amidst', 'learnt', 'spelt', 'burnt', 'analysed']

/**
 * Flat lookup from a lowercased word form to its pair.
 * @type {Map<string, {id: string, variety: string, pair: Object}>}
 */
export const SPELLING_FORM_INDEX = new Map()

for (const pair of SPELLING_VARIANTS) {
  for (const variety of ['us', 'gb']) {
    for (const form of pair[variety]) {
      const key = form.toLowerCase()
      // First definition wins, so a word appearing in two pairs (e.g. "grey"
      // as both a colour and a greylist term) is attributed once.
      if (!SPELLING_FORM_INDEX.has(key)) {
        SPELLING_FORM_INDEX.set(key, { id: pair.id, variety, pair })
      }
    }
  }
}

for (const marker of BRITISH_MARKERS) {
  if (!SPELLING_FORM_INDEX.has(marker)) {
    SPELLING_FORM_INDEX.set(marker, { id: marker, variety: 'gb', pair: { id: marker, marker: true } })
  }
}
