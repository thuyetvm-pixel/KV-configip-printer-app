import type { PhoneNetwork, SubnetStatus, TargetNetwork } from '../../types';
import { isInSubnet, isValidIPv4, isValidPrefix, subnetOf } from '../../utils/ipv4';

/**
 * Same / different subnet compared with the phone's real prefix.
 * Same subnet does not guarantee the printer is reachable, and a different subnet can still be
 * reachable through a router – the UI says so.
 */
export function classifySubnet(
  network: Pick<PhoneNetwork, 'ipAddress' | 'prefixLength'> | TargetNetwork | null,
  deviceIp: string | null | undefined,
): SubnetStatus {
  if (!network) return 'unchecked';
  if (!isValidIPv4(deviceIp)) return 'unknown';
  if (!isValidIPv4(network.ipAddress) || !isValidPrefix(network.prefixLength)) return 'unknown';
  return isInSubnet(deviceIp, subnetOf(network.ipAddress, network.prefixLength)) ? 'same' : 'different';
}

export const SUBNET_STATUS_LABEL: Record<SubnetStatus, string> = {
  same: 'CÙNG SUBNET',
  different: 'KHÁC SUBNET',
  unknown: 'CHƯA XÁC ĐỊNH',
  unchecked: 'CHƯA KIỂM TRA',
};
