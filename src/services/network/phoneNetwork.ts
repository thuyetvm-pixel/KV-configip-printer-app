import NetInfo, { NetInfoStateType, type NetInfoState } from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import { getLinkInfo } from '../../../modules/network-tools';
import type { PhoneNetwork } from '../../types';
import { buildPhoneNetwork } from './buildPhoneNetwork';
import { getLocationPermission } from './permissions';

NetInfo.configure({ shouldFetchWiFiSSID: true });

export async function readPhoneNetwork(): Promise<PhoneNetwork> {
  const [state, locationPermission] = await Promise.all([NetInfo.fetch(), getLocationPermission()]);
  const wifi = state.type === NetInfoStateType.wifi ? state.details : null;
  let native = null;
  try {
    native = getLinkInfo();
  } catch {
    native = null;
  }
  return buildPhoneNetwork({
    native,
    netInfo: {
      type: state.type,
      isConnected: state.isConnected,
      isWifiEnabled: (state as NetInfoState & { isWifiEnabled?: boolean }).isWifiEnabled,
      ssid: wifi?.ssid ?? null,
      ipAddress: wifi?.ipAddress ?? null,
      subnet: wifi?.subnet ?? null,
    },
    sdkInt: Platform.OS === 'android' ? Number(Platform.Version) : null,
    locationPermission,
  });
}

/** Calls `onChange` whenever Android reports a connectivity change. Returns the unsubscribe function. */
export function watchNetwork(onChange: () => void): () => void {
  return NetInfo.addEventListener(() => onChange());
}
