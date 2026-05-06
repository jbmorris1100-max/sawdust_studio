import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  input:   '#111620',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  accent:  '#00C5CC',
  blue:    '#3b82f6',
  blueBg:  '#0d1f3c',
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ── Open PDF in device viewer ─────────────────────────────────
async function openPdf(url) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Cannot Open', 'Unable to open this file. Make sure a PDF viewer is installed.');
    }
  } catch (e) {
    Alert.alert('Error', 'Could not open the plan: ' + e.message);
  }
}

// ── Plan row ──────────────────────────────────────────────────
function PlanRow({ drawing }) {
  const [pressing, setPressing] = useState(false);
  return (
    <TouchableOpacity
      style={[styles.planRow, pressing && { opacity: 0.7 }]}
      onPressIn={() => setPressing(true)}
      onPressOut={() => setPressing(false)}
      onPress={() => openPdf(drawing.file_url)}
      activeOpacity={0.75}
    >
      <View style={styles.planIconWrap}>
        <Ionicons name="document-text-outline" size={22} color={C.blue} />
      </View>
      <View style={styles.planInfo}>
        <Text style={styles.planLabel}>{drawing.label}</Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {drawing.file_name || 'PDF'}
          {drawing.uploaded_by ? ` · ${drawing.uploaded_by}` : ''}
        </Text>
        <Text style={styles.planDate}>{fmtDate(drawing.created_at)}</Text>
      </View>
      <View style={styles.planOpenBtn}>
        <Ionicons name="open-outline" size={16} color={C.blue} />
        <Text style={styles.planOpenText}>Open</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Job group header ──────────────────────────────────────────
function JobHeader({ jobId, jobName, count, expanded, onToggle }) {
  return (
    <TouchableOpacity style={styles.jobHeader} onPress={onToggle} activeOpacity={0.7}>
      <View style={styles.jobHeaderLeft}>
        <Text style={styles.jobId}>Job #{jobId}</Text>
        {jobName ? <Text style={styles.jobName}>{jobName}</Text> : null}
      </View>
      <View style={styles.jobHeaderRight}>
        <View style={styles.planCountBadge}>
          <Text style={styles.planCountText}>{count}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={C.muted}
        />
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────
export default function PlansScreen({ route }) {
  const { userName } = route.params ?? {};

  const [drawings,   setDrawings]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded,   setExpanded]   = useState({});

  const fetchDrawings = useCallback(async () => {
    const { data, error } = await supabase
      .from('job_drawings')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setDrawings(data);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchDrawings();
      setLoading(false);
    })();

    const ch = supabase
      .channel('plans-screen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_drawings' }, (p) => {
        if (p.eventType === 'INSERT') setDrawings((prev) => [p.new, ...prev]);
        if (p.eventType === 'DELETE') setDrawings((prev) => prev.filter((d) => d.id !== p.old.id));
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [fetchDrawings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDrawings();
    setRefreshing(false);
  }, [fetchDrawings]);

  const toggleJob = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Group by job
  const groups = (() => {
    const map = {};
    drawings.forEach((d) => {
      const key = d.job_id;
      if (!map[key]) map[key] = { jobId: d.job_id, jobName: d.job_name, items: [] };
      map[key].items.push(d);
    });
    return Object.values(map);
  })();

  // Flat list data: alternate group headers + rows
  const listData = [];
  groups.forEach((g) => {
    const key = g.jobId;
    const isOpen = expanded[key] !== false; // default open
    listData.push({ type: 'header', key, group: g, isOpen });
    if (isOpen) {
      g.items.forEach((d) => listData.push({ type: 'row', key: d.id, drawing: d }));
    }
  });

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <JobHeader
          jobId={item.group.jobId}
          jobName={item.group.jobName}
          count={item.group.items.length}
          expanded={item.isOpen}
          onToggle={() => toggleJob(item.key)}
        />
      );
    }
    return <PlanRow drawing={item.drawing} />;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Job Plans</Text>
        {userName ? <Text style={styles.headerSub}>{userName}</Text> : null}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : drawings.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="document-text-outline" size={52} color={C.border} />
          <Text style={styles.emptyTitle}>No plans uploaded yet</Text>
          <Text style={styles.emptyBody}>Ask your supervisor to upload job plans and drawings.</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => String(item.key)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.bg },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub:   { fontSize: 13, color: C.muted },

  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.muted, textAlign: 'center' },
  emptyBody:  { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20 },

  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },

  // Job group header
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: C.blueBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.blue + '30',
    marginBottom: 6,
    marginTop: 10,
  },
  jobHeaderLeft:  { flex: 1 },
  jobId:          { fontSize: 13, fontWeight: '800', color: C.blue, letterSpacing: 0.3 },
  jobName:        { fontSize: 12, color: C.muted, marginTop: 2 },
  jobHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planCountBadge: {
    backgroundColor: C.blue + '30',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  planCountText: { fontSize: 11, fontWeight: '700', color: C.blue },

  // Plan row
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.blue,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 7,
    gap: 12,
  },
  planIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.blue + '18',
    justifyContent: 'center',
    alignItems: 'center',
  },
  planInfo:    { flex: 1 },
  planLabel:   { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 3 },
  planMeta:    { fontSize: 12, color: C.muted, marginBottom: 1 },
  planDate:    { fontSize: 11, color: C.muted },
  planOpenBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.blue + '18',
    borderWidth: 1,
    borderColor: C.blue + '40',
  },
  planOpenText: { fontSize: 10, fontWeight: '700', color: C.blue },
});
