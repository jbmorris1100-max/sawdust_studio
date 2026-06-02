import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, StatusBar } from 'react-native';
import { ScanIcon, BookIcon, DocumentIcon } from '../components/NavIcon';

const C = {
  bg:      '#050608',
  surface: '#0a0d10',
  border:  'rgba(94,234,212,0.12)',
  text:    '#E6F0EE',
  muted:   '#9AAAA7',
  active:  '#2DE1C9',
};

const TILES = [
  {
    key:   'ScanPart',
    label: 'Scan Part',
    desc:  'Log parts by job number',
    Icon:  ScanIcon,
    color: C.active,
  },
  {
    key:   'SOPs',
    label: 'SOPs',
    desc:  'Standard operating procedures',
    Icon:  BookIcon,
    color: '#60A5FA',
  },
  {
    key:   'Plans',
    label: 'Plans',
    desc:  'Job plans and drawings',
    Icon:  DocumentIcon,
    color: '#A78BFA',
  },
];

export default function MoreScreen({ navigation, route }) {
  const params = route?.params ?? {};

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <Text style={s.title}>More</Text>
      </View>
      <View style={s.grid}>
        {TILES.map(({ key, label, desc, Icon, color }) => (
          <TouchableOpacity
            key={key}
            style={s.tile}
            activeOpacity={0.75}
            onPress={() => navigation.navigate(key, params)}
          >
            <View style={[s.iconWrap, { borderColor: color + '33' }]}>
              <Icon color={color} />
            </View>
            <Text style={s.tileLabel}>{label}</Text>
            <Text style={s.tileDesc}>{desc}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.bg },
  header:   { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 },
  title:    { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  grid:     {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, paddingTop: 16, gap: 12,
  },
  tile: {
    width: '47%',
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
  },
  iconWrap: {
    width: 52, height: 52,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
  },
  tileLabel: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 4 },
  tileDesc:  { fontSize: 12, color: C.muted, lineHeight: 16 },
});
