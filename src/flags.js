// flags.js — IOC country code → ISO 3166-1 alpha-2 mapping + flag helpers
// IOC codes come from the TNNS PDF parser; flag-icons CSS uses ISO alpha-2 (lowercase).
// Only codes that differ from a naive 2-char truncation are strictly required,
// but the table covers all nations regularly seen in Grand Slam draws for clarity.

export const COUNTRY_DISPLAY_NAMES = {
  // Africa
  ALG: 'Algeria', EGY: 'Egypt', MAR: 'Morocco', NGR: 'Nigeria', RSA: 'South Africa', TUN: 'Tunisia',
  // Americas
  ARG: 'Argentina', BOL: 'Bolivia', BRA: 'Brazil', CAN: 'Canada', CHI: 'Chile', COL: 'Colombia',
  ECU: 'Ecuador', MEX: 'Mexico', PAR: 'Paraguay', PER: 'Peru', PUR: 'Puerto Rico', URU: 'Uruguay',
  USA: 'United States', VEN: 'Venezuela',
  // Asia / Oceania
  AUS: 'Australia', CHN: 'China', HKG: 'Hong Kong', INA: 'Indonesia', IND: 'India', JPN: 'Japan',
  KAZ: 'Kazakhstan', KOR: 'South Korea', MAS: 'Malaysia', NZL: 'New Zealand', PAK: 'Pakistan',
  PHI: 'Philippines', THA: 'Thailand', TPE: 'Chinese Taipei', UAE: 'UAE', UZB: 'Uzbekistan',
  // Europe (canonical codes only — ROM/SPA legacy aliases omitted)
  AND: 'Andorra', ARM: 'Armenia', AUT: 'Austria', AZE: 'Azerbaijan', BEL: 'Belgium', BIH: 'Bosnia',
  BUL: 'Bulgaria', CRO: 'Croatia', CYP: 'Cyprus', CZE: 'Czech Republic', DEN: 'Denmark', ESP: 'Spain',
  EST: 'Estonia', FIN: 'Finland', FRA: 'France', GBR: 'Great Britain', GEO: 'Georgia', GER: 'Germany',
  GRE: 'Greece', HUN: 'Hungary', IRL: 'Ireland', ISR: 'Israel', ITA: 'Italy', LAT: 'Latvia',
  LIB: 'Lebanon', LTU: 'Lithuania', MDA: 'Moldova', MKD: 'North Macedonia', MON: 'Monaco',
  NED: 'Netherlands', NOR: 'Norway', POL: 'Poland', POR: 'Portugal', ROU: 'Romania', SLO: 'Slovenia',
  SRB: 'Serbia', SUI: 'Switzerland', SVK: 'Slovakia', SWE: 'Sweden', TUR: 'Turkey', UKR: 'Ukraine',
}

/**
 * Case-insensitive lookup: input string → IOC code.
 * Tries exact match against display names first, then substring.
 * Returns null if no match found.
 */
export function countryNameToIoc(input) {
  if (!input) return null
  const lower = input.toLowerCase()
  for (const [ioc, name] of Object.entries(COUNTRY_DISPLAY_NAMES)) {
    if (name.toLowerCase() === lower) return ioc
  }
  for (const [ioc, name] of Object.entries(COUNTRY_DISPLAY_NAMES)) {
    if (name.toLowerCase().includes(lower)) return ioc
  }
  return null
}

const IOC_TO_ISO2 = {
  // Africa
  ALG: 'dz', EGY: 'eg', MAR: 'ma', NGR: 'ng', RSA: 'za', TUN: 'tn',
  // Americas
  ARG: 'ar', BOL: 'bo', BRA: 'br', CAN: 'ca', CHI: 'cl', COL: 'co',
  ECU: 'ec', MEX: 'mx', PAR: 'py', PER: 'pe', PUR: 'pr', URU: 'uy', USA: 'us', VEN: 've',
  // Asia / Oceania
  AUS: 'au', CHN: 'cn', HKG: 'hk', INA: 'id', IND: 'in', JPN: 'jp',
  KAZ: 'kz', KOR: 'kr', MAS: 'my', NZL: 'nz', PAK: 'pk', PHI: 'ph',
  THA: 'th', TPE: 'tw', UAE: 'ae', UZB: 'uz',
  // Europe
  // Note: TNNS PDFs emit standard IOC codes (ESP, ROU, TUR); SPA/ROM kept for legacy.
  AND: 'ad', ARM: 'am', AUT: 'at', AZE: 'az', BEL: 'be', BIH: 'ba',
  BUL: 'bg', CRO: 'hr', CYP: 'cy', CZE: 'cz', DEN: 'dk', ESP: 'es',
  EST: 'ee', FIN: 'fi', FRA: 'fr', GBR: 'gb', GEO: 'ge', GER: 'de',
  GRE: 'gr', HUN: 'hu', IRL: 'ie', ISR: 'il', ITA: 'it', LAT: 'lv',
  LIB: 'lb', LTU: 'lt', MDA: 'md', MKD: 'mk', MON: 'mc', NED: 'nl',
  NOR: 'no', POL: 'pl', POR: 'pt', ROM: 'ro', ROU: 'ro', SLO: 'si',
  SPA: 'es', SRB: 'rs', SUI: 'ch', SVK: 'sk', SWE: 'se', TUR: 'tr',
  UKR: 'ua',
}

// Blocked nations (no flag in draws; IOC codes not present in the PDF).
// Listed here purely for documentation — these simply won't appear as keys.
// const BLOCKED = ['RUS', 'BLR']

/**
 * Convert a 3-letter IOC code to lowercase ISO 3166-1 alpha-2, or null if unknown.
 */
export function iocToIso2(ioc) {
  if (!ioc) return null
  return IOC_TO_ISO2[ioc.toUpperCase()] || null
}

/**
 * Build a { playerName → iocCode } map from round-0 matches of an assembled draw.
 * Country is only stored on round-0 rows (where the PDF supplies it); later rounds
 * derive occupants by name, so renderers look up via this map.
 */
export function buildCountryMap(draw) {
  const map = {}
  const r0matches = draw.rounds?.[0]?.matches || []
  r0matches.forEach(m => {
    if (m?.p1?.name && m?.p1?.country) map[m.p1.name] = m.p1.country
    if (m?.p2?.name && m?.p2?.country) map[m.p2.name] = m.p2.country
  })
  return map
}

/**
 * Create a DOM <span> for the flag gutter. Always rendered (fixed width) so
 * names stay aligned whether or not a country is known.
 * When iso2 is available, adds flag-icons classes fi fi-{iso2}.
 */
export function makeFlagEl(iocCode) {
  const el = document.createElement('span')
  el.className = 'pr-flag'
  if (iocCode) {
    const iso2 = iocToIso2(iocCode)
    if (iso2) el.classList.add('fi', 'fi-' + iso2)
  }
  return el
}

/**
 * HTML string for a flag gutter cell — used in print (no DOM available).
 * Always emits a span occupying the reserved width; flag background only when mapped.
 */
export function flagPrintHTML(iocCode) {
  const iso2 = iocCode ? iocToIso2(iocCode) : null
  const flagStyle = 'display:inline-block;width:11pt;height:7pt;flex-shrink:0;border-radius:0.5pt;background-size:contain;background-position:50%;background-repeat:no-repeat;vertical-align:middle'
  if (!iso2) return `<span style="${flagStyle}"></span>`
  return `<span class="fi fi-${iso2}" style="${flagStyle}"></span>`
}
