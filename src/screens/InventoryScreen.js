import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:      '#0d0d0d',
  surface: '#141414',
  card:    '#141414',
  input:   '#1a1a1a',
  border:  '#2a2a2a',
  text:    '#e5e5e5',
  muted:   '#555555',
  accent:  '#f59e0b',

  status: {
    pending:   { bg: '#1a1000', text: '#f59e0b', border: '#3d2800' },
    ordered:   { bg: '#0d1f3c', text: '#3b82f6', border: '#1e3a5f' },
    received:  { bg: '#0a1f10', text: '#22c55e', border: '#14532d' },
    cancelled: { bg: '#1a1a1a', text: '#555555', border: '#2a2a2a' },
    open:      { bg: '#1f0a0a', text: '#ef4444', border: '#450a0a' },
    reviewed:  { bg: '#0d1f3c', text: '#3b82f6', border: '#1e3a5f' },
    resolved:  { bg: '#0a1f10', text: '#22c55e', border: '#14532d' },
  },
};

const INVENTORY_STATUSES = ['pending', 'ordered', 'received', 'cancelled'];
const DAMAGE_STATUSES    = ['open', 'reviewed', 'resolved'];

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

// ── Status Pill ───────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const s = C.status[status] ?? { bg: '#1a1a1a', text: '#555', border: '#2a2a2a' };
  return (
    <View style={[styles.pill, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.pillText, { color: s.text }]}>{status.toUpperCase()}</Text>
    </View>
  );
};

// ── Needs List Item ───────────────────────────────────────────
const NeedItem = ({ item, onStatusChange }) => (
  <View style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle}>{item.item}</Text>
        <Text style={styles.cardMeta}>
          {item.dept}{item.job_id ? ` · Job #${item.job_id}` : ''}
        </Text>
        <Text style={styles.cardMeta}>Qty: {item.qty} · {formatDate(item.created_at)}</Text>
      </View>
      <StatusPill status={item.status} />
    </View>
    <View style={styles.cardActions}>
      {INVENTORY_STATUSES.filter((s) => s !== item.status).map((s) => (
        <TouchableOpacity key={s} style={styles.actionBtn} onPress={() => onStatusChange(item.id, s)}>
          <Text style={styles.actionBtnText}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

// ── Damage List Item ──────────────────────────────────────────
const DamageItem = ({ item, onStatusChange, onArchive }) => (
  <View style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle}>{item.part_name}</Text>
        <Text style={styles.cardMeta}>
          {item.dept}{item.job_id ? ` · Job #${item.job_id}` : ''}
        </Text>
        {item.notes ? <Text style={styles.cardNotes}>{item.notes}</Text> : null}
        <Text style={styles.cardMeta}>{formatDate(item.created_at)}</Text>
        {item.resolution_type ? (
          <View style={styles.resolutionBadge}>
            <Text style={styles.resolutionBadgeText}>{item.resolution_type}</Text>
            {item.resolution_notes ? (
              <Text style={styles.resolutionNotes}>{item.resolution_notes}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <StatusPill status={item.status} />
        {item.status === 'resolved' && onArchive ? (
          <TouchableOpacity
            onPress={() => Alert.alert(
              'Remove from view?',
              'Delete this resolved report? It will be removed from your view but saved in the supervisor report.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => onArchive(item.id) },
              ]
            )}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
    {item.photo_url ? (
      <Image
        source={{ uri: item.photo_url }}
        style={styles.photoThumb}
        resizeMode="cover"
      />
    ) : null}
    <View style={styles.cardActions}>
      {DAMAGE_STATUSES.filter((s) => s !== item.status).map((s) => (
        <TouchableOpacity key={s} style={styles.actionBtn} onPress={() => onStatusChange(item.id, s)}>
          <Text style={styles.actionBtnText}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

// ── Field wrapper ─────────────────────────────────────────────
const Field = ({ label, children }) => (
  <View style={styles.fieldWrap}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);

const StyledInput = (props) => (
  <TextInput style={styles.input} placeholderTextColor={C.muted} {...props} />
);

// ── Main Screen ───────────────────────────────────────────────
export default function InventoryScreen({ route }) {
  const { userName, userDept } = route.params ?? {};

  const [activeTab, setActiveTab]   = useState(route.params?.activeTab ?? 'needs');
  const [needs,     setNeeds]       = useState([]);
  const [damage,    setDamage]      = useState([]);
  const [loading,   setLoading]     = useState(true);
  const [saving,    setSaving]      = useState(false);
  const [toast,     setToast]       = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const [nItem,  setNItem]  = useState('');
  const [nJob,   setNJob]   = useState('');
  const [nQty,   setNQty]   = useState('1');

  const [dPart,  setDPart]  = useState('');
  const [dJob,   setDJob]   = useState('');
  const [dNotes, setDNotes] = useState('');
  const [dPhoto, setDPhoto] = useState(null);

  const fetchData = useCallback(async () => {
    if (!userDept) return;
    setLoading(true);
    const [needsRes, damageRes] = await Promise.all([
      supabase.from('inventory_needs').select('*').eq('dept', userDept).order('created_at', { ascending: false }),
      supabase.from('damage_reports').select('*').eq('dept', userDept).eq('archived', false).order('created_at', { ascending: false }),
    ]);
    if (needsRes.data)  setNeeds(needsRes.data);
    if (damageRes.data) setDamage(damageRes.data);
    setLoading(false);
  }, [userDept]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const updateNeedStatus = async (id, status) => {
    setNeeds((prev) => prev.map((n) => n.id === id ? { ...n, status } : n));
    await supabase.from('inventory_needs').update({ status }).eq('id', id);
  };

  const updateDamageStatus = async (id, status) => {
    setDamage((prev) => prev.map((d) => d.id === id ? { ...d, status } : d));
    await supabase.from('damage_reports').update({ status }).eq('id', id);
  };

  const archiveDamage = async (id) => {
    setDamage((prev) => prev.filter((d) => d.id !== id));
    await supabase.from('damage_reports').update({ archived: true }).eq('id', id);
  };

  const resetForms = () => {
    setNItem(''); setNJob(''); setNQty('1');
    setDPart(''); setDJob(''); setDNotes(''); setDPhoto(null);
  };

  const handlePickPhoto = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to take photos.');
        return;
      }
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setDPhoto(result.assets[0].uri);
    }
  };

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 2500);
  };

  const handleSubmit = async () => {
    if (activeTab === 'needs') {
      if (!nItem.trim()) return;
      const qty = parseInt(nQty, 10);
      const safeQty = isNaN(qty) || qty < 1 ? 1 : qty;
      const tempId = `opt-${Date.now()}`;
      const optimistic = {
        id:         tempId,
        item:       nItem.trim(),
        dept:       userDept,
        job_id:     nJob.trim() || null,
        qty:        safeQty,
        status:     'pending',
        created_at: new Date().toISOString(),
      };
      setNeeds((prev) => [optimistic, ...prev]);
      setModalVisible(false);
      resetForms();

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10000)
      );
      try {
        const { data, error } = await Promise.race([
          supabase.from('inventory_needs')
            .insert({ item: optimistic.item, dept: optimistic.dept, job_id: optimistic.job_id, qty: optimistic.qty, status: 'pending' })
            .select().single(),
          timeout,
        ]);
        if (error) throw error;
        setNeeds((prev) => prev.map((n) => n.id === tempId ? data : n));
        showToast('Need logged');
      } catch (err) {
        setNeeds((prev) => prev.filter((n) => n.id !== tempId));
        showToast(err.message === 'timeout' ? 'Timed out — please retry' : 'Submission failed', true);
      }
    } else {
      if (!dPart.trim()) return;
      const photoUri = dPhoto; // capture before resetForms clears it
      const tempId = `opt-${Date.now()}`;
      const optimistic = {
        id: tempId,
        part_name: dPart.trim(),
        dept: userDept,
        job_id: dJob.trim() || null,
        notes: dNotes.trim() || null,
        photo_url: photoUri, // local URI for immediate preview
        status: 'open',
        created_at: new Date().toISOString(),
      };
      setDamage((prev) => [optimistic, ...prev]);
      setModalVisible(false);
      resetForms();

      // Upload photo to Supabase Storage (if one was taken)
      let photoUrl = null;
      if (photoUri) {
        try {
          const resp = await fetch(photoUri);
          const blob = await resp.blob();
          const fname = `damage_${Date.now()}.jpg`;
          const { error: upErr } = await supabase.storage
            .from('damage-photos')
            .upload(fname, blob, { contentType: 'image/jpeg', upsert: false });
          if (!upErr) {
            photoUrl = supabase.storage.from('damage-photos').getPublicUrl(fname).data.publicUrl;
          }
        } catch (_) {}
      }

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10000)
      );
      try {
        const { data, error } = await Promise.race([
          supabase.from('damage_reports').insert({
            part_name: optimistic.part_name,
            dept: optimistic.dept,
            job_id: optimistic.job_id,
            notes: optimistic.notes,
            photo_url: photoUrl,
            status: 'open',
          }).select().single(),
          timeout,
        ]);
        if (error) throw error;
        setDamage((prev) => prev.map((d) => d.id === tempId ? data : d));
        showToast('Report submitted');
      } catch (err) {
        setDamage((prev) => prev.filter((d) => d.id !== tempId));
        showToast(err.message === 'timeout' ? 'Timed out — please retry' : 'Submission failed', true);
      }
    }
  };

  const canSubmit = activeTab === 'needs' ? nItem.trim().length > 0 : dPart.trim().length > 0;

  const pendingNeeds = needs.filter((n) => n.status === 'pending').length;
  const openDamage   = damage.filter((d) => d.status === 'open').length;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Shop Floor</Text>
        {userDept ? <Text style={styles.headerSub}>{userDept}</Text> : null}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {[
          { key: 'needs',  label: 'Needs',  count: pendingNeeds },
          { key: 'damage', label: 'Damage', count: openDamage   },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
            {tab.count > 0 && (
              <View style={[styles.tabCount, activeTab === tab.key && styles.tabCountActive]}>
                <Text style={[styles.tabCountText, activeTab === tab.key && styles.tabCountTextActive]}>
                  {tab.count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : (
        <FlatList
          data={activeTab === 'needs' ? needs : damage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons
                name={activeTab === 'needs' ? 'cube-outline' : 'warning-outline'}
                size={48}
                color={C.border}
              />
              <Text style={styles.emptyText}>
                No {activeTab === 'needs' ? 'inventory needs' : 'damage reports'} yet.
              </Text>
            </View>
          }
          renderItem={({ item }) =>
            activeTab === 'needs'
              ? <NeedItem item={item} onStatusChange={updateNeedStatus} />
              : <DamageItem item={item} onStatusChange={updateDamageStatus} onArchive={archiveDamage} />
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => { resetForms(); setModalVisible(true); }}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#000" />
      </TouchableOpacity>

      {/* Toast */}
      {toast ? (
        <View style={[styles.toastView, toast.isError && styles.toastViewError]}>
          <Text style={[styles.toastText, toast.isError && styles.toastTextError]}>{toast.msg}</Text>
        </View>
      ) : null}

      {/* Log Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {activeTab === 'needs' ? 'Log Inventory Need' : 'Report Damage'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={C.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {activeTab === 'needs' ? (
                <>
                  <Field label="Item Name *">
                    <StyledInput placeholder="e.g. 3/8 bolts, oak panels…" value={nItem} onChangeText={setNItem} autoFocus />
                  </Field>
                  <Field label="Job # (optional)">
                    <StyledInput placeholder="e.g. J-1042" value={nJob} onChangeText={setNJob} />
                  </Field>
                  <Field label="Quantity">
                    <StyledInput placeholder="1" value={nQty} onChangeText={setNQty} keyboardType="number-pad" />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Part / Component *">
                    <StyledInput placeholder="e.g. Cabinet door, drawer slide…" value={dPart} onChangeText={setDPart} autoFocus />
                  </Field>
                  <Field label="Job # (optional)">
                    <StyledInput placeholder="e.g. J-1042" value={dJob} onChangeText={setDJob} />
                  </Field>
                  <Field label="Notes (optional)">
                    <StyledInput
                      placeholder="Describe the damage…"
                      value={dNotes}
                      onChangeText={setDNotes}
                      multiline
                      numberOfLines={3}
                      style={[styles.input, styles.inputMultiline]}
                    />
                  </Field>
                  <Field label="Photo (optional)">
                    <TouchableOpacity style={styles.photoPickerBtn} onPress={handlePickPhoto} activeOpacity={0.75}>
                      {dPhoto ? (
                        <>
                          <Image source={{ uri: dPhoto }} style={styles.photoPickerPreview} resizeMode="cover" />
                          <TouchableOpacity
                            style={styles.photoRemoveBtn}
                            onPress={() => setDPhoto(null)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons name="close-circle" size={22} color="#ef4444" />
                          </TouchableOpacity>
                        </>
                      ) : (
                        <View style={styles.photoPickerEmpty}>
                          <Ionicons name="camera-outline" size={26} color={C.muted} />
                          <Text style={styles.photoPickerText}>Add Photo</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </Field>
                </>
              )}

              <TouchableOpacity
                style={[styles.submitBtn, (!canSubmit || saving) && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit || saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={styles.submitBtnText}>
                      {activeTab === 'needs' ? 'Log Need' : 'Submit Report'}
                    </Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

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

  // Tabs
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  tabActive:          { backgroundColor: C.accent, borderColor: C.accent },
  tabText:            { fontSize: 14, fontWeight: '600', color: C.muted },
  tabTextActive:      { color: '#000' },
  tabCount: {
    backgroundColor: C.border,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabCountActive:     { backgroundColor: 'rgba(0,0,0,0.2)' },
  tabCountText:       { fontSize: 10, fontWeight: '700', color: C.muted },
  tabCountTextActive: { color: '#000' },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: { color: C.muted, fontSize: 15 },

  // Card
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222222',
    padding: 16,
    marginBottom: 10,
  },
  cardTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMain:  { flex: 1, marginRight: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardMeta:  { fontSize: 13, color: C.muted, marginTop: 2 },
  cardNotes: { fontSize: 13, color: C.text, marginTop: 4, fontStyle: 'italic', opacity: 0.7 },

  // Status pill
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  // Card actions
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.border,
  },
  actionBtnText: { fontSize: 12, color: C.muted, fontWeight: '600' },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  modalBox: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },

  // Form
  fieldWrap:  { marginBottom: 16 },
  fieldLabel: {
    fontSize: 11,
    color: C.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.input,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: {
    height: 90,
    textAlignVertical: 'top',
    paddingTop: 12,
  },

  submitBtn: {
    marginTop: 8,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },

  // Photo thumbnail on damage card
  photoThumb: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginTop: 10,
    backgroundColor: '#1a1a1a',
  },

  // Photo picker in form
  photoPickerBtn: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    borderStyle: 'dashed',
    overflow: 'hidden',
    position: 'relative',
  },
  photoPickerEmpty: {
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.input,
  },
  photoPickerText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  photoPickerPreview: {
    width: '100%',
    height: 140,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
  },

  // Resolution badge (crew view of resolved damage)
  resolutionBadge: {
    marginTop: 8,
    backgroundColor: '#0a1f10',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#14532d',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resolutionBadgeText: { fontSize: 11, fontWeight: '700', color: '#22c55e', letterSpacing: 0.3 },
  resolutionNotes:     { fontSize: 12, color: '#4ade80', marginTop: 4, fontStyle: 'italic' },

  // Toast
  toastView: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  toastViewError:  { backgroundColor: '#ef4444' },
  toastText:       { color: '#0a1f10', fontWeight: '700', fontSize: 14 },
  toastTextError:  { color: '#fff' },
});
