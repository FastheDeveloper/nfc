import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { TabBarIcon } from '../../components/TabBarIcon';

export default function TabLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: dark ? '#a5b4fc' : '#4f46e5',
        tabBarInactiveTintColor: dark ? '#71717a' : '#a1a1aa',
        tabBarStyle: {
          backgroundColor: dark ? '#0a0a0a' : '#ffffff',
          borderTopColor: dark ? '#27272a' : '#e4e4e7',
        },
        headerStyle: { backgroundColor: dark ? '#0a0a0a' : '#ffffff' },
        headerTitleStyle: { color: dark ? '#fafafa' : '#18181b' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Read',
          tabBarIcon: ({ color }) => <TabBarIcon name="wifi" color={color} />,
        }}
      />
      <Tabs.Screen
        name="write"
        options={{
          title: 'Write',
          tabBarIcon: ({ color }) => <TabBarIcon name="pencil" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
        }}
      />
    </Tabs>
  );
}
