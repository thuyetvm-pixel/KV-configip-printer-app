import { isValidIPv4 } from '../../utils/ipv4';

function hostOf(url: string): string | null {
  const m = /^(https?):\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[2].toLowerCase() : null;
}

/**
 * The embedded browser may only show the printer's own admin pages. Any link or redirect to
 * another host (internet sites, other LAN devices) and any non-HTTP scheme (file:, intent:,
 * javascript:, data:) is refused inside the app.
 */
export function isAllowedAdminNavigation(targetUrl: string, adminUrl: string): boolean {
  if (targetUrl === 'about:blank') return true;
  const printerHost = hostOf(adminUrl);
  const targetHost = hostOf(targetUrl);
  return !!printerHost && !!targetHost && targetHost === printerHost;
}

/** True when the admin URL points at an IPv4 literal, the only kind of target the app opens. */
export function isPrinterAdminUrl(url: string): boolean {
  return isValidIPv4(hostOf(url) ?? '');
}
