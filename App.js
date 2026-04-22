import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useRef } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './src/lib/supabase';
import { registerForPushNotifications } from './src/lib/notifications';
import HomeScreen      from './src/screens/HomeScreen';
import PartsScreen     from './src/screens/PartsScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import MessagesScreen  from './src/screens/MessagesScreen';

const Tab = createBottomTabNavigator();

// ── Colors ────────────────────────────────────────────────────
const C = {
  bg:       '#0d0d0d',
  tabBar:   '#111111',
  border:   '#2a2a2a',
  active:   '#f59e0b',
  inactive: '#444444',
  badge:    '#ef4444',
};

// ── Per-tab top accent indicator ──────────────────────────────
function TabButton({ children, onPress, accessibilityState, style }) {
  const focused = accessibilityState?.selected;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[style, styles.tabButton]}
      activeOpacity={0.7}
    >
      {focused && <View style={styles.tabAccent} />}
      {children}
    </TouchableOpacity>
  );
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [userInfo,    setUserInfo]    = useState({ userName: '', userDept: '' });
  const [unreadCount, setUnreadCount] = useState(0);
  const channelRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [name, dept] = await Promise.all([
        AsyncStorage.getItem('@sawdust_user_name'),
        AsyncStorage.getItem('@sawdust_user_dept'),
      ]);
      if (name && dept) {
        setUserInfo({ userName: name, userDept: dept });
        registerForPushNotifications(name, dept).catch((err) =>
          console.warn('[App] push registration error:', err)
        );
      }
    })();
  }, []);

  useEffect(() => {
    channelRef.current = supabase
      .channel('app-messages-badge')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.new.sender_name !== userInfo.userName) {
            setUnreadCount((n) => n + 1);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channelRef.current); };
  }, [userInfo.userName]);

  const screenParams = userInfo;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: styles.tabBar,
            tabBarActiveTintColor:   C.active,
            tabBarInactiveTintColor: C.inactive,
            tabBarLabelStyle: styles.tabLabel,
          }}
        >
          {/* Home */}
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            initialParams={screenParams}
            options={{
              tabBarButton: (props) => <TabButton {...props} />,
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
              ),
            }}
          />

          {/* Parts / Scan */}
          <Tab.Screen
            name="ScanPart"
            component={PartsScreen}
            initialParams={screenParams}
            options={{
              title: 'Parts',
              tabBarButton: (props) => <TabButton {...props} />,
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons name={focused ? 'scan' : 'scan-outline'} size={size} color={color} />
              ),
            }}
          />

          {/* Inventory / Damage */}
          <Tab.Screen
            name="LogInventory"
            component={InventoryScreen}
            initialParams={screenParams}
            options={{
              title: 'Inventory',
              tabBarButton: (props) => <TabButton {...props} />,
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons name={focused ? 'layers' : 'layers-outline'} size={size} color={color} />
              ),
            }}
          />

          {/* Messages */}
          <Tab.Screen
            name="Messages"
            component={MessagesScreen}
            initialParams={screenParams}
            options={{
              title: 'Messages',
              tabBarButton: (props) => <TabButton {...props} />,
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons
                  name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
                  size={size}
                  color={color}
                />
              ),
              tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
              tabBarBadgeStyle: styles.nativeBadge,
            }}
            listeners={{
              tabPress: () => setUnreadCount(0),
            }}
          />

          {/* ReportDamage — hidden tab, navigated to from HomeScreen */}
          <Tab.Screen
            name="ReportDamage"
            component={InventoryScreen}
            initialParams={{ ...screenParams, activeTab: 'damage' }}
            options={{
              tabBarButton: () => null,
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: C.tabBar,
    borderTopWidth:  1,
    borderTopColor:  C.border,
    paddingBottom:   6,
    paddingTop:      4,
    height:          62,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  tabAccent: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: 2.5,
    backgroundColor: C.active,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  nativeBadge: {
    backgroundColor: C.badge,
    fontSize: 10,
    fontWeight: '700',
  },
});
