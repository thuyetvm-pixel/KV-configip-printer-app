import { isAllowedAdminNavigation, isPrinterAdminUrl } from '../webPolicy';

describe('embedded browser navigation policy', () => {
  const admin = 'http://192.168.1.30';

  it('allows pages and ports of the printer itself', () => {
    expect(isAllowedAdminNavigation('http://192.168.1.30/', admin)).toBe(true);
    expect(isAllowedAdminNavigation('http://192.168.1.30/net/tcpip.html?x=1', admin)).toBe(true);
    expect(isAllowedAdminNavigation('https://192.168.1.30:443/login', admin)).toBe(true);
    expect(isAllowedAdminNavigation('about:blank', admin)).toBe(true);
  });

  it('blocks other hosts, look-alike hosts and dangerous schemes', () => {
    expect(isAllowedAdminNavigation('http://192.168.1.31/', admin)).toBe(false);
    expect(isAllowedAdminNavigation('https://evil.example.com/', admin)).toBe(false);
    expect(isAllowedAdminNavigation('http://192.168.1.30.evil.com/', admin)).toBe(false);
    expect(isAllowedAdminNavigation('http://user@evil.com/', admin)).toBe(false);
    expect(isAllowedAdminNavigation('file:///sdcard/x.html', admin)).toBe(false);
    expect(isAllowedAdminNavigation('intent://scan/#Intent;scheme=zxing;end', admin)).toBe(false);
    expect(isAllowedAdminNavigation('javascript:alert(1)', admin)).toBe(false);
    expect(isAllowedAdminNavigation('data:text/html,hi', admin)).toBe(false);
  });

  it('recognises printer admin URLs', () => {
    expect(isPrinterAdminUrl('http://10.0.0.100')).toBe(true);
    expect(isPrinterAdminUrl('http://printer.local/')).toBe(false);
  });
});
