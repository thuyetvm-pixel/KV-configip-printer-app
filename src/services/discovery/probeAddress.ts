import { probeHosts } from '../../../modules/network-tools';
import { octetsToMac, octetsToText } from '../printer/snmp/ber';
import { OID, snmpGet } from '../printer/snmp/snmpClient';
import type { Observation } from './deviceStore';
import { SWEEP_PORTS } from './sweepPlan';

/**
 * Probes one address the technician typed in (e.g. from the printer's network config printout).
 * Returns only what actually answered; an empty list means "not verified", never "absent".
 */
export async function probeAddress(ip: string): Promise<Observation[]> {
  const observations: Observation[] = [];
  const [tcp, snmp] = await Promise.all([
    probeHosts({ hosts: [ip], ports: SWEEP_PORTS, timeoutMs: 2500, concurrency: SWEEP_PORTS.length }).catch(() => []),
    snmpGet({
      ip,
      community: 'public',
      oids: [OID.sysDescr, OID.sysName, OID.hrDeviceDescr1, OID.ifPhysAddress1, OID.prtGeneralSerialNumber1],
      timeoutMs: 2000,
    }).catch(() => null),
  ]);

  if (tcp[0]) observations.push({ method: 'tcp', ip, ports: tcp[0].ports });
  if (snmp?.ok) {
    const v = snmp.values;
    const txt = (oid: string) => {
      const value = v[oid];
      return value?.type === 'octets' ? octetsToText(value.value) || undefined : undefined;
    };
    const macValue = v[OID.ifPhysAddress1];
    const serialNumber = txt(OID.prtGeneralSerialNumber1);
    observations.push({
      method: 'snmp',
      ip,
      sysDescr: txt(OID.sysDescr),
      sysName: txt(OID.sysName),
      model: txt(OID.hrDeviceDescr1),
      mac: macValue?.type === 'octets' ? (octetsToMac(macValue.value) ?? undefined) : undefined,
      serialNumber,
      hasPrinterMib: !!serialNumber,
    });
  }
  return observations;
}
