/**
 * Manufacturer guessing. Text (mDNS TXT / SNMP sysDescr) is preferred; the MAC OUI table is a
 * small seed of printer vendors only – extend it from the IEEE registry
 * (https://standards-oui.ieee.org/oui/oui.txt) for the brands used in the field.
 */
const OUI_VENDORS: Record<string, string> = {
  '008077': 'Brother',
  '000085': 'Canon',
  '0000AA': 'Xerox',
  '000074': 'Ricoh',
  '00C0EE': 'Kyocera',
  '0017C8': 'Kyocera',
  '00074D': 'Zebra',
  '000048': 'Epson',
  '0026AB': 'Epson',
  '002000': 'Lexmark',
  '0001E6': 'HP',
  '0001E7': 'HP',
};

const BRAND_KEYWORDS: [RegExp, string][] = [
  [/\b(hp|hewlett[- ]?packard|laserjet|officejet|deskjet)\b/i, 'HP'],
  [/\bbrother\b/i, 'Brother'],
  [/\b(epson|seiko epson)\b/i, 'Epson'],
  [/\bcanon\b/i, 'Canon'],
  [/\bxerox\b/i, 'Xerox'],
  [/\bricoh\b/i, 'Ricoh'],
  [/\bkyocera\b/i, 'Kyocera'],
  [/\b(samsung)\b/i, 'Samsung'],
  [/\blexmark\b/i, 'Lexmark'],
  [/\bzebra\b/i, 'Zebra'],
  [/\bxprinter\b/i, 'Xprinter'],
  [/\b(sharp)\b/i, 'Sharp'],
  [/\b(konica|minolta|bizhub)\b/i, 'Konica Minolta'],
  [/\b(fuji ?xerox|fujifilm)\b/i, 'Fujifilm'],
  [/\b(pantum)\b/i, 'Pantum'],
];

const PRINTER_HINT = /print|laserjet|officejet|deskjet|mfp|mfc|dcp|ecotank|imageclass|bizhub|workcentre|ecosys|label|receipt|pos|thermal|zebra|xprinter|jetdirect/i;

export function vendorFromText(...texts: (string | undefined)[]): string | undefined {
  const joined = texts.filter(Boolean).join(' ');
  return BRAND_KEYWORDS.find(([re]) => re.test(joined))?.[1];
}

export function vendorFromMac(mac?: string): string | undefined {
  if (!mac) return undefined;
  return OUI_VENDORS[mac.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()];
}

export function looksLikePrinter(...texts: (string | undefined)[]): boolean {
  const joined = texts.filter(Boolean).join(' ');
  return PRINTER_HINT.test(joined) || vendorFromText(joined) != null;
}

/** Some printers put their MAC in the mDNS instance name, e.g. "Brother HL-L2350DW [3c2af4123456]". */
export function macFromName(name?: string): string | undefined {
  const m = name?.match(/\[([0-9a-f]{12})\]/i) ?? name?.match(/\b((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})\b/i);
  if (!m) return undefined;
  const hex = m[1].replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.match(/../g)!.join(':');
}
