import { decode } from 'entities'

const ROOT_ZONE_DB = 'https://www.iana.org/domains/root/db'
const ARPA_ZONE_DB = 'https://www.iana.org/domains/arpa'

const data = {
  tlds: ['.test', '.example', '.invalid', '.localhost'],
  tldsCached: false,
  arpa: [],
  arpaCached: false
}

const rootZoneTldRgx = /<span class="domain tld"><a href="(?:.+?)(?<xn>xn--[a-z0-9]+)?\.html">(?<tld>.*)<\/a><\/span>/gi
const arpaDomainRgx = /<span class="domain label">(?<domain>.*)<\/span>/gi

export async function isValidDomainTLD (domain) {
  if (!data.tldsCached) {
    try {
      const resp = await fetch(ROOT_ZONE_DB, { credentials: 'omit' }).then(r => r.text())
      if (resp) {
        const matches = resp.matchAll(rootZoneTldRgx)
        for (const match of matches) {
          if (match.groups.xn) {
            data.tlds.push(`.${match.groups.xn}`)
          }
          data.tlds.push(decode(match.groups.tld))
        }
      } else {
        throw new Error('Empty response.')
      }
      data.tldsCached = true
    } catch (err) {
      throw new Error(`Failed to fetch Root Zone TLDs from IANA: ${err.message}`)
    }
  }
  return data.tlds.some(t => domain.endsWith(t))
}

export async function isValidArpaDomain (domain) {
  if (!data.arpaCached) {
    try {
      const resp = await fetch(ARPA_ZONE_DB, { credentials: 'omit' }).then(r => r.text())
      if (resp) {
        const matches = resp.matchAll(arpaDomainRgx)
        for (const match of matches) {
          if (match.groups.domain === 'arpa') { continue }
          data.arpa.push(match.groups.domain)
        }
      } else {
        throw new Error('Empty response.')
      }
      data.arpaCached = true
    } catch (err) {
      throw new Error(`Failed to fetch ARPA Zone Domains from IANA: ${err.message}`)
    }
  }
  return data.arpa.some(d => domain.endsWith(d))
}
