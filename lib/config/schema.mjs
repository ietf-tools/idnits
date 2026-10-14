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
      'section',
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
  },
  // Deprecated attributes, by element, as listed in deprecated_attributes in
  // xml2rfc/writers/base.py (https://github.com/ietf-tools/xml2rfc)
  _deprecatedAttributes: {
    artwork: {
      height: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.5.4',
        suggestion: 'Remove it; it has no effect.'
      },
      width: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.5.8',
        suggestion: 'Remove it; it has no effect.'
      },
      'xml:space': {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.5.9',
        suggestion: 'Remove it; whitespace in <artwork> is always preserved.'
      }
    },
    figure: {
      align: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.1',
        suggestion: 'Instead, use the align attribute of <artwork>.'
      },
      alt: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.2',
        suggestion: 'Instead, use the alt attribute of <artwork>.'
      },
      height: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.4',
        suggestion: 'Remove it; it has no effect.'
      },
      src: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.5',
        suggestion: 'Instead, use the src attribute of <artwork>.'
      },
      'suppress-title': {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.6',
        suggestion: 'Remove it; artwork that needs no title can be used without a <figure>.'
      },
      title: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.7',
        suggestion: 'Instead, use a <name> child element.'
      },
      width: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.25.8',
        suggestion: 'Remove it; it has no effect.'
      }
    },
    note: {
      title: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.33.2',
        suggestion: 'Instead, use a <name> child element.'
      }
    },
    references: {
      title: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.42.2',
        suggestion: 'Instead, use a <name> child element.'
      }
    },
    section: {
      title: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.46.4',
        suggestion: 'Instead, use a <name> child element.'
      }
    },
    seriesInfo: {
      status: {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#seriesinfo',
        suggestion: 'Instead, use the category attribute of <rfc>.'
      },
      stream: {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#seriesinfo',
        suggestion: 'Instead, use the submissionType attribute of <rfc>.'
      }
    },
    t: {
      hangText: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.53.2',
        suggestion: 'Instead, use <dd> inside of a definition list (<dl>).'
      }
    },
    texttable: {
      title: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-3.8.5',
        suggestion: 'Instead, use a <name> child element.'
      }
    },
    xref: {
      pageno: {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.66.2',
        suggestion: 'Remove it; it has no effect.'
      }
    }
  }
}
