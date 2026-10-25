import { isNetworkToolsAvailable, probeHosts, readArpTable } from '../../../modules/network-tools';
import type { PhoneNetwork, TargetNetwork } from '../../types';
import { isInSubnet, isValidIPv4, isValidPrefix, subnetOf } from '../../utils/ipv4';
import { OID, snmpGet } from '../printer/snmp/snmpClient';
import type { ProbeEvidence } from './conflictDecision';

/** Ports commonly open on printers, PCs, phones, cameras and routers. Refused = host exists too. */
export const CONFLICT_PORTS = [80, 443, 9100, 515, 631, 22, 139, 445, 554, 8080, 62078];

/**
 * 4.5 s per port: long enough for the kernel to give up on ARP (≈3 s) and report EHOSTUNREACH,
 * which is what tells "nobody owns this IP" apart from "a host drops our packets".
 */
const CONFLICT_TIMEOUT_MS = 4500;

export async function collectConflictEvidence(
  ip: string,
  target: TargetNetwork,
  phone: PhoneNetwork | null,
): Promise<ProbeEvidence> {
  const phoneOnTargetNetwork =
    !!phone?.onWifi &&
    isValidIPv4(phone.ipAddress) &&
    isValidPrefix(target.prefixLength) &&
    isInSubnet(phone.ipAddress, subnetOf(target.ipAddress, target.prefixLength));

  const base: ProbeEvidence = { phoneOnTargetNetwork, tcp: null, arpAvailable: false, snmpAnswered: false };
  if (!phoneOnTargetNetwork) return base;
  if (!isNetworkToolsAvailable) return { ...base, probeError: 'Thiếu module mạng native – không dò được.' };

  try {
    const [tcp, snmp] = await Promise.all([
      probeHosts({ hosts: [ip], ports: CONFLICT_PORTS, timeoutMs: CONFLICT_TIMEOUT_MS, concurrency: CONFLICT_PORTS.length }),
      snmpGet({ ip, community: 'public', oids: [OID.sysDescr], timeoutMs: 2000 }).catch(() => null),
    ]);
    // The connect attempts above made the kernel ARP for the address; read the cache afterwards.
    const arp = await readArpTable().catch(() => null);
    const arpEntry = arp?.entries.find((e) => e.ip === ip && e.flags === '0x2');
    return {
      ...base,
      tcp: tcp[0]?.ports ?? null,
      arpAvailable: !!arp?.available,
      arpMac: arpEntry?.mac ?? null,
      // Any SNMP reply (even an error PDU) proves a device holds the IP.
      snmpAnswered: !!snmp && (snmp.ok || snmp.reason === 'error-status'),
      probeError: tcp[0] ? undefined : 'Phép dò TCP không trả kết quả.',
    };
  } catch (e) {
    return { ...base, probeError: (e as Error).message };
  }
}
