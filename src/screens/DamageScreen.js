import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform,
  SafeAreaView, StatusBar, ActivityIndicator, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
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
  danger:  '#FF4444',
  success: '#22c55e',
  status: {
    open:     { bg: '#1f0a0a', text: '#ef4444', border: '#450a0a' },
    reviewed: { bg: '#0d1f3c', text: '#3b82f6', border: '#1e3a5f' },
    resolved: { bg: '#0a1f10', text: '#22c55e', border: '#14532d' },
  },
};

const STATUSES = ['open', 'reviewed', 'resolved'];
const formatDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

const StatusPill = ({ status }) => {
  const st = C.status[status] ?? { bg: '#111620', text: '#555', border: '#1A2535' };
  return (
    <View style={[styles.pill, { backgroundColor: st.bg, borderColor: st.border }]}>
      <Text style={[styles.pillText, { color: st.text }]}>{status.toUpperCase()}</Text>
    </View>
  );
};

const DamageItem = ({ item, onStatusChange, onArchive }) => (
  <View style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle}>{item.part_name}</Text>
        <Text style={styles.cardMeta}>{item.dept} · {formatDate(item.created_at)}</Text>
        {item.notes ? <Text style={styles.cardNotes}>{item.notes}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <StatusPill status={item.status} />
        {item.status === 'resolved' && onArchive ? (
          <TouchableOpacity onPress={() => Alert.alert('Remove?', 'Remove from view?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => onArchive(item.id) },
          ])} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="trash-outline" size={16} color={C.danger} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
    {item.photo_url ? (
      <Image source={{ uri: item.photo_url }} style={styles.photoThumb} resizeMode="cover" />
    ) : null}
    <View style={styles.cardActions}>
      {STATUSES.filter(st => st !== item.status).map(st => (
        <TouchableOpacity key={st} style={styles.actionBtn} onPress={() => onStatusChange(item.id, st)}>
          <Text style={styles.actionBtnText}>{st}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

export default function DamageScreen({ route }) {
  const [userName, setUserName] = useState(route.params?.userName ?? '');
  const [userDept, setUserDept] = useState(route.params?.userDept ?? '');

  const [damage,       setDamage]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [dWhat,        setDWhat]        = useState('');
  const [dPhoto,       setDPhoto]       = useState(null);
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
      .from('damage_reports').select('*')
      .eq('dept', dept).eq('archived', false)
      .order('created_at', { ascending: false });
    if (data) setDamage(data);
    setLoading(false);
  }, [userDept]);

  const updateStatus = async (id, status) => {
    setDamage(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    await supabase.from('damage_reports').update({ status }).eq('id', id);
  };

  const archiveDamage = async (id) => {
    setDamage(prev => prev.filter(d => d.id !== id));
    await supabase.from('damage_reports').update({ archived: true }).eq('id', id);
  };

  const handlePickPhoto = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to take photos.');
        return;
      }
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets?.[0]?.uri) setDPhoto(result.assets[0].uri);
  };

  const showToast = (msg, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 2000);
  };

  const handleSubmit = async () => {
    if (!dWhat.trim() || saving) return;
    setSaving(true);
    const dept    = userDept || await AsyncStorage.getItem('@inline_user_dept') || '';
    const photoUri = dPhoto;
    const tempId  = `opt-${Date.now()}`;
    const text    = dWhat.trim();

    const optimistic = {
      id: tempId, part_name: text, dept,
      notes: null, photo_url: photoUri,
      status: 'open', created_at: new Date().toISOString(),
    };
    setDamage(prev => [optimistic, ...prev]);
    setModalVisible(false);
    setDWhat(''); setDPhoto(null);

    // Upload photo
    let photoUrl = null;
    if (photoUri) {
      try {
        const resp = await fetch(photoUri);
        const blob = await resp.blob();
        const fname = `damage_${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage.from('damage-photos').upload(fname, blob, { contentType: 'image/jpeg', upsert: false });
        if (!upErr) photoUrl = supabase.storage.from('damage-photos').getPublicUrl(fname).data.publicUrl;
      } catch (_) {}
    }

    try {
      const tenantId = await getTenantId();
      const { data, error } = await supabase.from('damage_reports').insert({
        part_name: text, dept, notes: null, photo_url: photoUrl, status: 'open',
        ...(tenantId && { tenant_id: tenantId }),
      }).select().single();
      if (error) throw error;
      setDamage(prev => prev.map(d => d.id === tempId ? data : d));

      // Sync to Innergy — best-effort
      let innergyOk = true;
      const raw  = await AsyncStorage.getItem('@inline_current_task');
      const task = raw ? JSON.parse(raw) : null;
      if (task?.workOrderId) {
        const [impRes, tagRes] = await Promise.all([
          createImpediment({ type: 'Damaged Part', workOrderId: task.workOrderId, description: text }),
          applyWorkOrderTag(task.workOrderId, 'App: Damaged Part'),
        ]);
        if (!impRes || !tagRes) innergyOk = false;
      }
      await setSyncStatus(innergyOk);
      setSyncOk(innergyOk);
      showToast('Reported ✅');
    } catch (_) {
      setDamage(prev => prev.filter(d => d.id !== tempId));
      showToast('Failed — try again', true);
    } finally {
      setSaving(false);
    }
  };

  const openCount = damage.filter(d => d.status === 'open').length;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Damage Reports</Text>
        {userDept ? <Text style={styles.headerSub}>{userDept}</Text> : null}
        <View style={styles.headerRight}>
          {openCount > 0
            ? <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{openCount} open</Text></View>
            : null}
          <View style={[styles.syncDot, syncOk ? styles.syncGreen : styles.syncRed]} />
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={C.danger} /></View>
      ) : (
        <FlatList
          data={damage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="warning-outline" size={48} color={C.border} />
              <Text style={styles.emptyText}>No damage reports yet.</Text>
            </View>
          }
          renderItem={({ item }) => <DamageItem item={item} onStatusChange={updateStatus} onArchive={archiveDamage} />}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => { setDWhat(''); setDPhoto(null); setModalVisible(true); }} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color="#fff" />
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
              <Text style={styles.modalTitle}>Report Damage</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={C.muted} />
              </TouchableOpacity>
            </View>

            {/* Photo button */}
            <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto} activeOpacity={0.75}>
              {dPhoto ? (
                <>
                  <Image source={{ uri: dPhoto }} style={styles.photoPreview} resizeMode="cover" />
                  <TouchableOpacity style={styles.photoRemove} onPress={() => setDPhoto(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Ionicons name="close-circle" size={22} color={C.danger} />
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.photoEmpty}>
                  <Ionicons name="camera-outline" size={26} color={C.muted} />
                  <Text style={styles.photoEmptyText}>Add Photo (optional)</Text>
                </View>
              )}
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              placeholder="What happened?"
              placeholderTextColor={C.muted}
              value={dWhat}
              onChangeText={setDWhat}
              autoFocus={!dPhoto}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.submitBtn, (!dWhat.trim() || saving) && styles.submitBtnOff]}
              onPress={handleSubmit}
              disabled={!dWhat.trim() || saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.submitBtnText}>Submit Report</Text>}
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
  headerBadge: { backgroundColor: '#1f0a0a', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#450a0a' },
  headerBadgeText: { fontSize: 11, fontWeight: '700', color: C.danger },
  syncDot:   { width: 8, height: 8, borderRadius: 4 },
  syncGreen: { backgroundColor: C.success },
  syncRed:   { backgroundColor: C.danger },

  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100, flexGrow: 1 },
  emptyWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText:   { color: C.muted, fontSize: 15 },

  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: '#222', padding: 16, marginBottom: 10 },
  cardTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMain: { flex: 1, marginRight: 12 },
  cardTitle:{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  cardNotes:{ fontSize: 13, color: C.text, marginTop: 4, fontStyle: 'italic', opacity: 0.7 },

  pill:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  actionBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.input, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 12, color: C.muted, fontWeight: '600' },

  photoThumb: { width: '100%', height: 160, borderRadius: 10, marginTop: 10, backgroundColor: '#111620' },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.danger,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: C.danger, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 8,
  },

  toast:          { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: C.success, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  toastError:     { backgroundColor: C.danger },
  toastText:      { color: '#0a1f10', fontWeight: '700', fontSize: 14 },
  toastTextError: { color: '#fff' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.75)' },
  modalBox: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle:  { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },

  photoBtn: {
    borderRadius: 12, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed',
    overflow: 'hidden', marginBottom: 14, position: 'relative',
  },
  photoEmpty: { height: 80, backgroundColor: C.input, justifyContent: 'center', alignItems: 'center', gap: 6 },
  photoEmptyText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  photoPreview: { width: '100%', height: 130 },
  photoRemove: { position: 'absolute', top: 8, right: 8 },

  input: {
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 90, textAlignVertical: 'top', paddingTop: 12, marginBottom: 16,
  },
  submitBtn:     { backgroundColor: C.danger, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnOff:  { opacity: 0.35 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
