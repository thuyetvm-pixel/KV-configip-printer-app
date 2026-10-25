/**
 * TEST-ONLY data. Never imported by app code, never shown as scan results.
 */
import type { CandidateContext } from '../services/ip-management/validateIp';
import type { TargetNetwork } from '../types';

export const OFFICE_24: TargetNetwork = {
  ipAddress: '192.168.1.50',
  prefixLength: 24,
  gateway: '192.168.1.1',
  ssid: 'TEST-SHOP',
};

export function ctx(overrides: Partial<CandidateContext> = {}): CandidateContext {
  return { target: OFFICE_24, knownInUse: [], dhcpRange: null, dhcpServer: null, ...overrides };
}
