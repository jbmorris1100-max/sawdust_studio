import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform,
  SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { createImpediment, applyWorkOrderTag } from '../lib/innergy';
import { getSyncStatus, setSyncStatus } from '../lib/syncQueue';
import { getTenantId } from '../lib/tenant';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  input:   '#111620',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  accent:  '#00C5CC',
  success: '#22c55e',
  status: {
    pending:   { bg: '#062022', text: '#00C5CC', border: '#0E4F52' },
    ordered:   { bg: '#0d1f3c', text: '#3b82f6', border: '#1e3a5f' },
    received:  { bg: '#0a1f10', text: '#22c55e', border: '#14532d' },
    cancelled: { bg: '#1a1a1a', text: '#555555', border: '#2a2a2a' },
  },
};

const STATUSES = ['pending', 'ordered', 'received', 'cancelled'];
const formatDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

const StatusPill = ({ status }) => {
  const st = C.status[status] ?? { bg: '#1a1a1a', text: '#555', border: '#2a2a2a' };
  return (
    <View style={[styles.pill, { backgroundColor: st.bg, borderColor: st.border }]}>
      <Text style={[styles.pillText, { color: st.text }]}>{status.toUpperCase()}</Text>
    </View>
  );
};

const NeedItem = ({ item, onStatusChange }) => (
  <View style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle}>{item.item}</Text>
        <Text style={styles.cardMeta}>{item.dept} · {formatDate(item.created_at)}</Text>
      </View>
      <StatusPill status={item.status} />
    </View>
    <View style={styles.cardActions}>
      {STATUSES.filter(st => st !== item.status).map(st => (
        <TouchableOpacity key={st} style={styles.actionBtn} onPress={() => onStatusChange(item.id, st)}>
          <Text style={styles.actionBtnText}>{st}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

export default function InventoryScreen({ route }) {
  const [userName, setUserName] = useState(route.params?.userName ?? '');
  const [userDept, setUserDept] = useState(route.params?.userDept ?? '');

  const [needs,        setNeeds]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [nItem,        setNItem]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState(null);
  const [syncOk,       setSyncOk]       = useState(true);

  useFocusEffect(useCallback(() => {
    AsyncStorage.multiGet(['@inline_user_name', '@inline_user_dept']).then(pairs => {
      const n = pairs[0][1]; const d = pairs[1][1];
      if (n && !userName) setUserName(n);
      if (d && !userDept) setUserDept(d);
    });
    fetchData();
    getSyncStatus().then(({ ok }) => setSyncOk(ok));
  }, [userDept]));

  const fetchData = useCallback(async () => {
    const dept = userDept || await AsyncStorage.getItem('@inline_user_dept');
    if (!dept) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('inventory_needs').select('*')
      .eq('dept', dept).order('created_at', { ascending: false });
    if (data) setNeeds(data);
    setLoading(false);
  }, [userDept]);

  const updateStatus = async (id, status) => {
    setNeeds(prev => prev.map(n => n.id === id ? { ...n, status } : n));
    await supabase.from('inventory_needs').update({ status }).eq('id', id);
  };

  const showToast = (msg, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 2000);
  };

  const handleSubmit = async () => {
    if (!nItem.trim() || saving) return;
    setSaving(true);
    const dept = userDept || await AsyncStorage.getItem('@inline_user_dept') || '';
    const tempId = `opt-${Date.now()}`;
    const optimistic = {
      id: tempId, item: nItem.trim(), dept, qty: 1,
      status: 'pending', created_at: new Date().toISOString(),
    };
    setNeeds(prev => [optimistic, ...prev]);
    setModalVisible(false);
    const itemText = nItem.trim();
    setNItem('');

    try {
      const tenantId = await getTenantId();
      const { data, error } = await supabase.from('inventory_needs')
        .insert({ item: itemText, dept, qty: 1, status: 'pending', ...(tenantId && { tenant_id: tenantId }) })
        .select().single();
      if (error) throw error;
      setNeeds(prev => prev.map(n => n.id === tempId ? data : n));

      // Sync to Innergy — best-effort
      let innergyOk = true;
      const raw = await AsyncStorage.getItem('@inline_current_task');
      const task = raw ? JSON.parse(raw) : null;
      if (task?.workOrderId) {
        const [impRes, tagRes] = await Promise.all([
          createImpediment({ type: 'Materials', workOrderId: task.workOrderId, description: itemText }),
          applyWorkOrderTag(task.workOrderId, 'App: Material Needed'),
        ]);
        if (!impRes || !tagRes) innergyOk = false;
      }
      await setSyncStatus(innergyOk);
      setSyncOk(innergyOk);
      showToast('Logged ✅');
    } catch (_) {
      setNeeds(prev => prev.filter(n => n.id !== tempId));
      showToast('Failed — try again', true);
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = needs.filter(n => n.status === 'pending').length;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inventory Needs</Text>
        {userDept ? <Text style={styles.headerSub}>{userDept}</Text> : null}
        <View style={styles.headerRight}>
          {pendingCount > 0
            ? <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{pendingCount} pending</Text></View>
            : null}
          <View style={[styles.syncDot, syncOk ? styles.syncGreen : styles.syncRed]} />
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          data={needs}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={48} color={C.border} />
              <Text style={styles.emptyText}>No needs logged yet.</Text>
            </View>
          }
          renderItem={({ item }) => <NeedItem item={item} onStatusChange={updateStatus} />}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => { setNItem(''); setModalVisible(true); }} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color="#000" />
      </TouchableOpacity>

      {toast ? (
        <View style={[styles.toast, toast.error && styles.toastError]}>
          <Text style={[styles.toastText, toast.error && styles.toastTextError]}>{toast.msg}</Text>
        </View>
      ) : null}

      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>What do you need?</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={C.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="e.g. 3/8 bolts, oak panels, glue…"
              placeholderTextColor={C.muted}
              value={nItem}
              onChangeText={setNItem}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity
              style={[styles.submitBtn, (!nItem.trim() || saving) && styles.submitBtnOff]}
              onPress={handleSubmit}
              disabled={!nItem.trim() || saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.submitBtnText}>Submit</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub:   { fontSize: 13, color: C.muted },
  headerRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBadge: { backgroundColor: '#062022', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#0E4F52' },
  headerBadgeText: { fontSize: 11, fontWeight: '700', color: C.accent },
  syncDot:   { width: 8, height: 8, borderRadius: 4 },
  syncGreen: { backgroundColor: C.success },
  syncRed:   { backgroundColor: '#ef4444' },

  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100, flexGrow: 1 },
  emptyWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText:   { color: C.muted, fontSize: 15 },

  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: '#222', padding: 16, marginBottom: 10 },
  cardTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMain: { flex: 1, marginRight: 12 },
  cardTitle:{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardMeta: { fontSize: 13, color: C.muted, marginTop: 2 },

  pill:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  actionBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.input, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 12, color: C.muted, fontWeight: '600' },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 8,
  },

  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: C.success, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  toastError: { backgroundColor: '#ef4444' },
  toastText:      { color: '#0a1f10', fontWeight: '700', fontSize: 14 },
  toastTextError: { color: '#fff' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.75)' },
  modalBox: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle:  { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  input: {
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 16,
  },
  submitBtn:    { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnOff: { opacity: 0.35 },
  submitBtnText:{ color: '#000', fontSize: 16, fontWeight: '700' },
});
