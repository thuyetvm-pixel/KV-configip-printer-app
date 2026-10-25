import Zeroconf, { ImplType, type Service } from 'react-native-zeroconf';
import { isValidIPv4 } from '../../utils/ipv4';
import type { Observation } from './deviceStore';

/** Bonjour service types printers advertise. `_http._tcp` alone is not proof of a printer. */
export const MDNS_SERVICE_TYPES = ['ipp', 'ipps', 'printer', 'pdl-datastream', 'http'] as const;

/**
 * One Zeroconf (Android NsdManager) scan per service type, in parallel. mDNS uses the link-local
 * multicast group 224.0.0.251, so answers reach the phone even when the printer's IP is in another
 * subnet – as long as both are on the same L2 segment / VLAN. mDNS never crosses a router or VLAN
 * boundary (unless the network has an mDNS reflector).
 *
 * Returns a function that stops every scan.
 */
export function startMdnsScan(opts: {
  onObservation: (obs: Extract<Observation, { method: 'mdns' }>) => void;
  onError?: (message: string) => void;
}): () => void {
  const instances = MDNS_SERVICE_TYPES.map((type) => {
    const zc = new Zeroconf();
    zc.on('resolved', (service: Service) => {
      for (const ip of service.ipv4 ?? []) {
        if (!isValidIPv4(ip)) continue;
        opts.onObservation({
          method: 'mdns',
          ip,
          serviceType: type,
          serviceName: service.name,
          host: service.host,
          port: service.port,
          txt: service.txt,
        });
      }
    });
    zc.on('error', (err) => {
      // Resolve timeouts are routine on busy networks.
      if (err.code !== 'TIMEOUT') opts.onError?.(`mDNS _${type}._tcp: ${err.message}`);
    });
    try {
      zc.scan({ type, protocol: 'tcp', domain: 'local.', implType: ImplType.NSD, resolveTimeout: 4 });
    } catch (e) {
      opts.onError?.(`mDNS _${type}._tcp không khởi động được: ${(e as Error).message}`);
    }
    return zc;
  });

  return () => {
    for (const zc of instances) {
      try {
        zc.stop();
      } catch {
        // already stopped
      }
      zc.removeDeviceListeners();
      zc.removeAllListeners();
    }
  };
}
