import { StyleSheet, Text, View } from 'react-native';
import { SUBNET_STATUS_LABEL } from '../services/network/subnetStatus';
import { colors, radius } from '../theme';
import type { SubnetStatus } from '../types';

const STYLE: Record<SubnetStatus, { fg: string; bg: string }> = {
  same: { fg: colors.green, bg: colors.greenBg },
  different: { fg: colors.red, bg: colors.redBg },
  unknown: { fg: colors.yellow, bg: colors.yellowBg },
  unchecked: { fg: colors.neutral, bg: colors.neutralBg },
};

export function StatusBadge({ status }: { status: SubnetStatus }) {
  return <Pill text={SUBNET_STATUS_LABEL[status]} {...STYLE[status]} />;
}

export function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    gap: 6,
    maxWidth: '100%',
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  text: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
});
