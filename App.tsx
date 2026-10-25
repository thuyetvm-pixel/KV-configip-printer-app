import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { applyObservation, sortDevices } from './src/services/discovery/deviceStore';
import { probeManualAddress, startScan, type ScanHandle } from './src/services/discovery/scanController';
import { openAppSettings, requestLocalNetworkPermission, requestLocationPermission } from './src/services/network/permissions';
import { readPhoneNetwork, watchNetwork } from './src/services/network/phoneNetwork';
import { HomeScreen } from './src/screens/HomeScreen';
import { PrinterDetailScreen } from './src/screens/PrinterDetailScreen';
import { PrinterWebScreen } from './src/screens/PrinterWebScreen';
import type { DiscoveredDevice, PhoneNetwork, ScanProgress, TargetNetwork } from './src/types';
import { isValidIPv4 } from './src/utils/ipv4';

function toTarget(n: PhoneNetwork): TargetNetwork | null {
  if (!n.onWifi || !n.ipAddress || n.prefixLength == null) return null;
  return { ipAddress: n.ipAddress, prefixLength: n.prefixLength, gateway: n.gateway, ssid: n.ssid };
}

export default function App() {
  const [network, setNetwork] = useState<PhoneNetwork | null>(null);
  // The network the printer must join. Captured once (phone on DHCP) so it survives the phone
  // temporarily switching to a static IP in the printer's subnet.
  const [target, setTarget] = useState<TargetNetwork | null>(null);
  const deviceMap = useRef(new Map<string, DiscoveredDevice>());
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [manualIps, setManualIps] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotes, setScanNotes] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ ip: string; focus: boolean } | null>(null);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const scanRef = useRef<ScanHandle | null>(null);

  const addLog = useCallback((m: string) => setLogs((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 300)), []);

  const refreshNetwork = useCallback(async () => {
    try {
      const n = await readPhoneNetwork();
      setNetwork(n);
      setTarget((t) => t ?? toTarget(n));
      return n;
    } catch (e) {
      addLog(`Không đọc được thông tin mạng: ${(e as Error).message}`);
      return null;
    }
  }, [addLog]);

  useEffect(() => {
    (async () => {
      await requestLocationPermission().catch(() => 'unknown');
      await requestLocalNetworkPermission().catch(() => 'unknown');
      await refreshNetwork();
    })();
    const unwatch = watchNetwork(() => {
      refreshNetwork();
    });
    return () => {
      unwatch();
      scanRef.current?.cancel();
    };
  }, [refreshNetwork]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webUrl) return setWebUrl(null), true;
      if (selected) return setSelected(null), true;
      return false;
    });
    return () => sub.remove();
  }, [selected, webUrl]);

  const onRequestPermission = async () => {
    const state = await requestLocationPermission();
    if (state === 'blocked') {
      Alert.alert('Cần quyền Vị trí', 'Quyền đã bị từ chối vĩnh viễn. Mở Cài đặt ứng dụng → Quyền → Vị trí để cấp lại.', [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Mở Cài đặt', onPress: () => openAppSettings() },
      ]);
    }
    refreshNetwork();
  };

  const startScanning = async () => {
    const n = await refreshNetwork();
    if (!n) return;
    deviceMap.current = new Map();
    setDevices([]);
    setLogs([]);
    setScanError(null);
    setScanNotes([]);
    setScanning(true);
    setProgress({ phase: 'preparing', fraction: 0, message: 'Đang chuẩn bị…' });
    addLog(`Bắt đầu quét từ ${n.ipAddress}/${n.prefixLength}`);

    const handle = startScan(n, manualIps, {
      onDevices: (list) => {
        deviceMap.current = new Map(list.map((d) => [d.ip, d]));
        setDevices(list);
      },
      onProgress: setProgress,
      onLog: addLog,
    });
    scanRef.current = handle;
    const outcome = await handle.done;
    scanRef.current = null;
    setScanning(false);
    deviceMap.current = new Map(outcome.devices.map((d) => [d.ip, d]));
    setDevices(outcome.devices);
    setScanNotes(outcome.notes);
    if (outcome.status === 'error') setScanError(outcome.error?.message ?? 'Quét thất bại.');
    addLog(`Kết thúc (${outcome.status}): ${outcome.devices.length} thiết bị.`);
  };

  const addManualIp = async (ip: string) => {
    if (!isValidIPv4(ip)) return;
    setManualIps((list) => (list.includes(ip) ? list : [...list, ip]));
    const map = new Map(deviceMap.current);
    const d = await probeManualAddress(ip, map).catch(() => {
      applyObservation(map, { method: 'manual', ip });
      return map.get(ip) ?? null;
    });
    deviceMap.current = map;
    setDevices(sortDevices([...map.values()]));
    addLog(`Nhập tay ${ip}: ${d && d.methods.some((m) => m !== 'manual') ? 'có phản hồi' : 'chưa xác minh (không có phản hồi)'}`);
  };

  const device = selected ? devices.find((d) => d.ip === selected.ip) : undefined;

  return (
    <SafeAreaProvider>
      <StatusBar style={device ? 'dark' : 'light'} />
      {device && selected ? (
        <PrinterDetailScreen
          key={device.ip}
          device={device}
          allDevices={devices}
          network={network}
          target={target}
          focusSuggestion={selected.focus}
          onBack={() => setSelected(null)}
          onOpenWeb={setWebUrl}
          onUseCurrentNetworkAsTarget={() => network && setTarget(toTarget(network))}
        />
      ) : (
        <HomeScreen
          network={network}
          target={target}
          devices={devices}
          scanning={scanning}
          progress={progress}
          scanError={scanError}
          scanNotes={scanNotes}
          logs={logs}
          onRefreshNetwork={refreshNetwork}
          onRequestPermission={onRequestPermission}
          onStartScan={startScanning}
          onStopScan={() => scanRef.current?.cancel()}
          onAddManualIp={addManualIp}
          onOpenDevice={(ip, focus) => setSelected({ ip, focus })}
        />
      )}
      <PrinterWebScreen key={webUrl ?? 'none'} url={webUrl} onClose={() => setWebUrl(null)} />
    </SafeAreaProvider>
  );
}
