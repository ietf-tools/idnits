export const XML_SCHEMA = {
  abstract: {
    allowedChildren: [
      'dl',
      'ol',
      't',
      'ul'
    ]
  },
  section: {
    allowedChildren: [
      'artwork',
      'aside',
      'blockquote',
      'dl',
      'figure',
      'iref',
      'ol',
      'sourcecode',
      't',
      'table',
      'texttable',
      'ul'
    ]
  },
  // ---
  _deprecated: {
    c: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.1',
      suggestion: 'Instead, use <tr>, <td>, and <th>.'
    },
    facsimile: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.2',
      suggestion: 'The <email> element is a much more useful way to get in touch with authors.'
    },
    format: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.3',
      suggestion: 'If the goal is to provide a single URI for a reference, use the "target" attribute in <reference> instead.'
    },
    list: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.4',
      suggestion: 'Instead, use <dl> for list/@style "hanging"; <ul> for list/@style "empty" or "symbols"; and <ol> for list/@style "letters", "numbers", "counter", or "format".'
    },
    postamble: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.5',
      suggestion: 'Instead, use a regular paragraph after the figure or table.'
    },
    preamble: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.6',
      suggestion: 'Instead, use a regular paragraph before the figure or table.'
    },
    spanx: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.7',
      suggestion: 'Instead of <spanx style="emph">, use <em>; instead of <spanx style="strong">, use <strong>; instead of <spanx style="verb">, use <tt>.'
    },
    texttable: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.8',
      suggestion: 'Use <table> instead.'
    },
    ttcol: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.9',
      suggestion: 'Instead, use <tr>, <td>, and <th>.'
    },
    vspace: {
      ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.10',
      suggestion: 'In earlier versions of this format, <vspace> was often used to get an extra blank line in a list element; in the v3 vocabulary, that can be done instead by using multiple <t> elements inside the <li> element.  Other uses have no direct replacement.'
    }
  }
}
