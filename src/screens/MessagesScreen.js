import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { postWorkOrderNote, getWorkOrdersByProjectNumber } from '../lib/innergy';
import { getTenantId } from '../lib/tenant';

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:          '#07090F',
  surface:     '#0D1117',
  input:       '#111620',
  border:      '#1A2535',
  text:        '#FFFFFF',
  muted:       '#2D8A94',
  accent:      '#00C5CC',
  accentDark:  '#0AAFB8',
  // Bubbles
  bubbleIn:    '#1e1e1e',
  bubbleOwn:   '#0a2a2a',
  bubbleSup:   '#00C5CC',
};

// ── Helpers ───────────────────────────────────────────────────
const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDateHeader = (iso) => {
  const d = new Date(iso);
  const today     = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const injectDateSeparators = (messages) => {
  const result = [];
  let lastDate = null;
  for (const msg of messages) {
    const day = new Date(msg.created_at).toDateString();
    if (day !== lastDate) {
      result.push({ type: 'separator', id: `sep-${msg.id}`, date: msg.created_at });
      lastDate = day;
    }
    result.push({ type: 'message', ...msg });
  }
  return result;
};

// ── Message Bubble ────────────────────────────────────────────
const MessageBubble = React.memo(({ item, isOwn }) => {
  const isSupervisor = item.sender_name === 'Supervisor';
  return (
    <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOut : styles.bubbleRowIn]}>
      {!isOwn && (
        <Text style={[styles.senderLabel, isSupervisor && styles.senderLabelSup]}>
          {item.sender_name}
          {!isSupervisor && item.dept ? (
            <Text style={styles.senderDept}> · {item.dept}</Text>
          ) : null}
        </Text>
      )}
      <View style={[
        styles.bubble,
        isOwn        ? styles.bubbleOut  : styles.bubbleIn,
        isSupervisor ? styles.bubbleSup  : null,
      ]}>
        <Text style={[
          styles.bubbleText,
          isOwn        ? styles.bubbleTextOwn : styles.bubbleTextIn,
          isSupervisor ? styles.bubbleTextSup : null,
        ]}>
          {item.body}
        </Text>
      </View>
      <Text style={[styles.timestamp, isOwn ? styles.timestampOut : styles.timestampIn]}>
        {formatTime(item.created_at)}
      </Text>
    </View>
  );
});

// ── Swipe-to-delete for own messages ─────────────────────────
function SwipeableMessageRow({ onDelete, children }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const DELETE_WIDTH = 72;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 6,
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) translateX.setValue(Math.max(g.dx, -DELETE_WIDTH - 20));
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -DELETE_WIDTH / 2) {
        Animated.spring(translateX, { toValue: -DELETE_WIDTH, useNativeDriver: true }).start();
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const snapBack = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();

  const handleDeleteTap = () => {
    Alert.alert(
      'Delete message?',
      'This message will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel', onPress: snapBack },
        {
          text: 'Delete', style: 'destructive',
          onPress: () =>
            Animated.timing(translateX, { toValue: -400, duration: 180, useNativeDriver: true })
              .start(() => onDelete()),
        },
      ]
    );
  };

  return (
    <View style={{ overflow: 'hidden' }}>
      <View style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        width: DELETE_WIDTH, backgroundColor: '#ef4444',
        justifyContent: 'center', alignItems: 'center',
      }}>
        <TouchableOpacity
          onPress={handleDeleteTap}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}
        >
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// ── Date Separator ────────────────────────────────────────────
const DateSeparator = ({ date }) => (
  <View style={styles.separatorRow}>
    <View style={styles.separatorLine} />
    <Text style={styles.separatorText}>{formatDateHeader(date)}</Text>
    <View style={styles.separatorLine} />
  </View>
);

// Post message to Innergy work order notes when a task is active or a job number is mentioned
async function syncMessageToInnergy(text, senderName) {
  try {
    const raw  = await AsyncStorage.getItem('@inline_current_task');
    const task = raw ? JSON.parse(raw) : null;
    const note = `[${senderName ?? 'Crew'}] ${text}`;

    if (task?.workOrderId) {
      await postWorkOrderNote(task.workOrderId, note);
      return;
    }
    const match = text.match(/P-\d{2}-\d{4}/i);
    if (match) {
      const wos = await getWorkOrdersByProjectNumber(match[0]);
      const wo  = wos?.[0];
      const id  = wo?.Id ?? wo?.WorkOrderId;
      if (id) await postWorkOrderNote(id, note);
    }
  } catch (_) {}
}

// ── Main Screen ───────────────────────────────────────────────
export default function MessagesScreen({ route }) {
  const { userName, userDept } = route.params ?? {};

  const [messages, setMessages] = useState([]);
  const [body,     setBody]     = useState('');
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);

  const listRef    = useRef(null);
  const channelRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    if (!userName) return;
    // Fetch own messages + Supervisor messages, then filter to this dept
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .in('sender_name', [userName, 'Supervisor'])
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) {
      console.error('[Messages] fetch failed:', error.message);
      setLoading(false);
      return;
    }
    // Only show own messages or supervisor replies targeted at this dept
    const visible = (data || []).filter(
      (m) => m.sender_name === userName ||
             (m.sender_name === 'Supervisor' && m.dept === userDept)
    );
    setMessages(visible);
    setLoading(false);
  }, [userName, userDept]);

  const deleteMessage = useCallback(async (id) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await supabase.from('messages').delete().eq('id', id);
  }, []);

  useEffect(() => {
    fetchMessages();

    channelRef.current = supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new;
          const isOwn = msg.sender_name === userName;
          const isSupToMyDept = msg.sender_name === 'Supervisor' && msg.dept === userDept;
          if (!isOwn && !isSupToMyDept) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channelRef.current); };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;

    const optimistic = {
      id:          `opt-${Date.now()}`,
      sender_name: userName,
      dept:        userDept,
      body:        trimmed,
      created_at:  new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setBody('');
    setSending(true);

    const tenantId = await getTenantId();
    const { data, error } = await supabase
      .from('messages')
      .insert({ sender_name: userName, dept: userDept, body: trimmed, ...(tenantId && { tenant_id: tenantId }) })
      .select()
      .single();

    if (error) {
      console.error('[Messages] insert failed:', error.message);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setBody(trimmed);
    } else {
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? data : m)));
      // Post to Innergy work order notes — best-effort, no await
      syncMessageToInnergy(trimmed, userName);
    }
    setSending(false);
  };

  const renderItem = useCallback(({ item }) => {
    if (item.type === 'separator') return <DateSeparator date={item.date} />;
    const isOwn = item.sender_name === userName;
    if (isOwn) {
      return (
        <SwipeableMessageRow onDelete={() => deleteMessage(item.id)}>
          <MessageBubble item={item} isOwn />
        </SwipeableMessageRow>
      );
    }
    return <MessageBubble item={item} isOwn={false} />;
  }, [userName, deleteMessage]);

  const displayItems = injectDateSeparators(messages);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        {userDept ? (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{userDept}</Text>
          </View>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={displayItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={48} color={C.border} />
                <Text style={styles.emptyText}>No messages yet.{'\n'}Start the conversation.</Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            placeholder="Message…"
            placeholderTextColor={C.muted}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!body.trim() || sending}
            activeOpacity={0.7}
          >
            {sending
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="arrow-up" size={20} color="#000" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.3,
  },
  headerBadge: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  headerBadgeText: {
    fontSize: 12,
    color: C.muted,
    fontWeight: '600',
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    color: C.muted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
  },

  // Date separator
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 10,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
  separatorText: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Bubbles
  bubbleRow: {
    marginBottom: 12,
    maxWidth: '78%',
  },
  bubbleRowOut: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  bubbleRowIn: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  senderLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.muted,
    marginBottom: 3,
    marginLeft: 2,
  },
  senderLabelSup: {
    color: C.accent,
  },
  senderDept: {
    fontWeight: '400',
    color: C.muted,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleOut: {
    backgroundColor: C.bubbleOwn,
    borderBottomRightRadius: 4,
  },
  bubbleIn: {
    backgroundColor: C.bubbleIn,
    borderBottomLeftRadius: 4,
  },
  bubbleSup: {
    backgroundColor: C.bubbleSup,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleTextIn:  { color: C.text },
  bubbleTextOwn: { color: '#86efac' },
  bubbleTextSup: { color: '#000' },
  timestamp: {
    fontSize: 10,
    color: C.muted,
    marginTop: 3,
  },
  timestampOut: { marginRight: 2 },
  timestampIn:  { marginLeft: 2 },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: C.input,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: C.border,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 1,
  },
  sendBtnDisabled: {
    backgroundColor: C.border,
  },
});
