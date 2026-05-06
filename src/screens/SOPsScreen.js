import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, ScrollView, SafeAreaView, StatusBar,
  ActivityIndicator, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const CACHE_KEY = '@inline_sops_v1';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  input:   '#111620',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  active:  '#00C5CC',
};

const DEPT_COLORS = {
  Production:  { bg: '#172554', text: '#93c5fd' },
  Assembly:    { bg: '#052e16', text: '#86efac' },
  Finishing:   { bg: '#431407', text: '#fdba74' },
  Craftsman:   { bg: '#500724', text: '#f9a8d4' },
  All:         { bg: '#1c1c1c', text: '#9ca3af' },
};

const DEPARTMENTS = ['All', 'Production', 'Assembly', 'Finishing', 'Craftsman'];

const fmtDate = iso =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const getDeptColor = dept => DEPT_COLORS[dept] ?? DEPT_COLORS.All;

// ── SOP Detail View ───────────────────────────────────────────
function SOPDetail({ sop, onBack }) {
  const dc = getDeptColor(sop.dept);
  const steps = Array.isArray(sop.steps) ? sop.steps : [];
  const hasFile = !!(sop.file_url);
  const isDrive = sop.file_type === 'drive';

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <TouchableOpacity onPress={onBack} style={s.backRow} activeOpacity={0.7}>
        <Ionicons name="arrow-back" size={18} color={C.text} />
        <Text style={s.backText}>SOPs</Text>
      </TouchableOpacity>

      <ScrollView style={s.detailScroll} contentContainerStyle={s.detailContent}>
        <View style={[s.deptBadge, { backgroundColor: dc.bg }]}>
          <Text style={[s.deptBadgeText, { color: dc.text }]}>{sop.dept}</Text>
        </View>
        <Text style={s.detailTitle}>{sop.title}</Text>
        <Text style={s.detailMeta}>Updated {fmtDate(sop.updated_at)}</Text>

        {!!sop.description && (
          <Text style={s.detailDesc}>{sop.description}</Text>
        )}

        {hasFile ? (
          <TouchableOpacity
            style={s.pdfBtn}
            onPress={() => Linking.openURL(sop.file_url)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isDrive ? 'logo-google' : 'document-text-outline'}
              size={16}
              color={C.active}
            />
            <Text style={s.pdfBtnText}>
              {isDrive ? 'Open in Google Drive' : 'View PDF'}
            </Text>
            <Ionicons name="open-outline" size={14} color={C.muted} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        ) : (
          <>
            <Text style={s.sectionLabel}>STEPS</Text>
            {steps.map((step, idx) => (
              <View key={idx} style={s.stepCard}>
                <View style={s.stepNumCol}>
                  <Text style={s.stepNum}>{step.step_number ?? idx + 1}</Text>
                </View>
                <View style={s.stepBody}>
                  <Text style={s.stepInstruction}>{step.instruction}</Text>
                  {!!step.warning && (
                    <View style={s.warningBox}>
                      <Ionicons name="warning" size={13} color="#fbbf24" style={{ marginRight: 6, marginTop: 1 }} />
                      <Text style={s.warningText}>{step.warning}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Main Screen ───────────────────────────────────────────────
export default function SOPsScreen({ route }) {
  const { userName = '', userDept = '' } = route?.params ?? {};

  const [sops,       setSops]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState('');
  const [deptFilter, setDeptFilter] = useState(
    DEPARTMENTS.includes(userDept) ? userDept : 'All'
  );
  const [selectedSop, setSelectedSop] = useState(null);
  const [offline,     setOffline]     = useState(false);

  const loadSops = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    // Show cache immediately on first load
    if (!isRefresh) {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          setSops(JSON.parse(cached));
          setLoading(false);
        }
      } catch {}
    }

    try {
      const { data, error } = await supabase
        .from('sops')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (data) {
        setSops(data);
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
        setOffline(false);
      }
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadSops(); }, [loadSops]);

  const openSop = useCallback(async (sop) => {
    setSelectedSop(sop);
    // Fire-and-forget view tracking
    if (userName && userDept) {
      supabase.from('sop_views').insert({
        sop_id:      sop.id,
        viewer_name: userName,
        viewer_dept: userDept,
      }).then(() => {});
    }
  }, [userName, userDept]);

  const filtered = sops.filter(sop => {
    const matchesDept =
      deptFilter === 'All' ||
      sop.dept === deptFilter ||
      sop.dept === 'All'; // "All dept" SOPs appear under every filter
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      sop.title.toLowerCase().includes(term) ||
      (sop.description ?? '').toLowerCase().includes(term) ||
      (Array.isArray(sop.steps) ? sop.steps : []).some(st =>
        st.instruction?.toLowerCase().includes(term)
      );
    return matchesDept && matchesSearch;
  });

  if (selectedSop) {
    return <SOPDetail sop={selectedSop} onBack={() => setSelectedSop(null)} />;
  }

  const renderCard = ({ item }) => {
    const dc = getDeptColor(item.dept);
    const stepCount = Array.isArray(item.steps) ? item.steps.length : 0;
    return (
      <TouchableOpacity style={s.card} onPress={() => openSop(item)} activeOpacity={0.8}>
        <View style={s.cardTop}>
          <View style={[s.deptBadge, { backgroundColor: dc.bg }]}>
            <Text style={[s.deptBadgeText, { color: dc.text }]}>{item.dept}</Text>
          </View>
          <Text style={s.cardDate}>{fmtDate(item.updated_at)}</Text>
        </View>
        <Text style={s.cardTitle}>{item.title}</Text>
        {!!item.description && (
          <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>
        )}
        <View style={s.cardFooter}>
          {item.file_url ? (
            <View style={s.pdfChip}>
              <Ionicons
                name={item.file_type === 'drive' ? 'logo-google' : 'document-text-outline'}
                size={11}
                color="#60a5fa"
              />
              <Text style={s.pdfChipText}>{item.file_type === 'drive' ? 'Drive' : 'PDF'}</Text>
            </View>
          ) : (
            <Text style={s.cardSteps}>{stepCount} step{stepCount !== 1 ? 's' : ''}</Text>
          )}
          <Ionicons name="chevron-forward" size={14} color="#333" style={{ marginLeft: 'auto' }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerEyebrow}>STANDARD OPERATING PROCEDURES</Text>
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>SOPs</Text>
          {offline && (
            <View style={s.offlineBadge}>
              <Ionicons name="cloud-offline-outline" size={12} color={C.active} />
              <Text style={s.offlineText}>offline</Text>
            </View>
          )}
        </View>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <Ionicons name="search-outline" size={16} color={C.muted} style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          placeholder="Search SOPs…"
          placeholderTextColor={C.muted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={s.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Department filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filterRow}
        contentContainerStyle={s.filterContent}
      >
        {DEPARTMENTS.map(dept => (
          <TouchableOpacity
            key={dept}
            style={[s.filterPill, deptFilter === dept && s.filterPillActive]}
            onPress={() => setDeptFilter(dept)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterPillText, deptFilter === dept && s.filterPillTextActive]}>
              {dept}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      {loading && sops.length === 0 ? (
        <View style={s.centerState}>
          <ActivityIndicator color={C.active} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.centerState}>
          <Ionicons name="document-text-outline" size={44} color="#2a2a2a" />
          <Text style={s.emptyText}>
            {sops.length === 0
              ? 'No SOPs yet — your supervisor will add them here'
              : 'No SOPs match your search'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={s.list}
          onRefresh={() => loadSops(true)}
          refreshing={refreshing}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },

  // Header
  header:        { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerEyebrow: { fontSize: 10, fontWeight: '700', color: C.active, letterSpacing: 1.2, marginBottom: 4 },
  headerRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle:   { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5 },

  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1c1400', borderRadius: 99,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#78350f',
  },
  offlineText: { fontSize: 10, color: C.active, fontWeight: '600' },

  // Search
  searchRow:  {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 10,
    backgroundColor: C.input,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12,
  },
  searchIcon:  { marginRight: 8 },
  searchInput: {
    flex: 1, color: C.text, fontSize: 15,
    paddingVertical: 10,
  },
  clearBtn: { padding: 4 },

  // Department filter
  filterRow:    { maxHeight: 44 },
  filterContent: { paddingHorizontal: 16, paddingVertical: 6, gap: 8, flexDirection: 'row' },
  filterPill:   {
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 99, borderWidth: 1,
    borderColor: '#1A2535', backgroundColor: 'transparent',
  },
  filterPillActive: {
    backgroundColor: '#1c0e00', borderColor: C.active,
  },
  filterPillText:       { fontSize: 12, color: C.muted, fontWeight: '600' },
  filterPillTextActive: { color: C.active },

  // States
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 40 },
  emptyText:   { fontSize: 14, color: '#444', textAlign: 'center', lineHeight: 21 },

  // List
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },

  // SOP card
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.active,
    padding: 16,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  deptBadge: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  deptBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  cardDate:  { fontSize: 11, color: C.muted },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 5 },
  cardDesc:  { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 8 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
  },
  cardSteps: { fontSize: 12, color: C.muted },
  pdfChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1e2a3a', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#1e3a5f',
  },
  pdfChipText: { fontSize: 10, color: '#60a5fa', fontWeight: '600' },

  // Detail
  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backText: { fontSize: 15, color: C.text, fontWeight: '600' },

  detailScroll:  { flex: 1 },
  detailContent: { paddingHorizontal: 20, paddingTop: 20 },

  detailTitle: {
    fontSize: 22, fontWeight: '800', color: C.text,
    letterSpacing: -0.4, marginTop: 10, marginBottom: 4,
  },
  detailMeta: { fontSize: 12, color: C.muted, marginBottom: 14 },
  detailDesc: {
    fontSize: 14, color: '#888', lineHeight: 21,
    marginBottom: 20,
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
  },

  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 1.1, marginBottom: 12, marginTop: 4,
  },

  stepCard: {
    flexDirection: 'row', gap: 14,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 14,
    marginBottom: 10,
  },
  stepNumCol: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#1c0e00',
    borderWidth: 1, borderColor: '#78350f',
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNum: { fontSize: 12, fontWeight: '700', color: C.active },
  stepBody: { flex: 1 },
  stepInstruction: { fontSize: 14, color: C.text, lineHeight: 21 },

  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#1c1400',
    borderRadius: 8, borderWidth: 1, borderColor: '#78350f',
    padding: 10, marginTop: 10,
  },
  warningText: { fontSize: 12, color: '#fbbf24', lineHeight: 18, flex: 1 },

  pdfBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1c0e00',
    borderRadius: 12, borderWidth: 1, borderColor: '#78350f',
    padding: 14, marginTop: 20,
  },
  pdfBtnText: { fontSize: 14, color: C.active, fontWeight: '600', flex: 1 },
});
