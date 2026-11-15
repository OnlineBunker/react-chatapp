import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  SafeAreaView, Alert, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as api from './ChatApiClient';

export default function App() {
  const [me, setMe] = useState(null);
  const [chat, setChat] = useState(null); // conversation currently open
  const [users, setUsers] = useState([]);

  async function login(username, password) {
    try {
      api.setCredentials(username, password);
      setMe(await api.getMyProfile());
      setUsers(await api.getUsers());
    } catch (e) {
      Alert.alert('Login failed', e.message);
    }
  }

  if (!me) return <LoginScreen onLogin={login} />;
  if (chat) return <ChatScreen me={me} users={users} chat={chat} onBack={() => setChat(null)} />;
  return <HomeScreen me={me} users={users} onOpen={setChat} />;
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <SafeAreaView style={styles.center}>
      <Text style={styles.title}>Chat App</Text>
      <Text style={styles.hint}>New username? An account is created automatically.</Text>
      <TextInput style={styles.input} placeholder="Username" autoCapitalize="none"
        value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry autoCapitalize="none"
        value={password} onChangeText={setPassword} />
      <TouchableOpacity style={styles.button} onPress={() => onLogin(username.trim(), password.trim())}>
        <Text style={styles.buttonText}>Login</Text>
      </TouchableOpacity>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function HomeScreen({ me, users, onOpen }) {
  const [tab, setTab] = useState('chats'); // 'chats' | 'users' | 'group'
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState([]); // user ids for the new group
  const [groupName, setGroupName] = useState('');

  const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || 'Unknown';
  const titleOf = (c) =>
    c.name || c.participants_ids.filter((id) => id !== me.id).map(nameOf).join(', ') || 'Chat';
  const otherUsers = users.filter((u) => u.id !== me.id);

  async function loadConversations() {
    try {
      setConversations(await api.getConversations());
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  useEffect(() => { loadConversations(); }, []);

  async function startDm(user) {
    try {
      onOpen(await api.createConversation('DM', undefined, [user.id]));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function createGroup() {
    if (!groupName.trim() || selected.length === 0) {
      Alert.alert('Group', 'Enter a group name and pick at least one user.');
      return;
    }
    try {
      const group = await api.createConversation('GROUP', groupName.trim(), selected);
      setSelected([]);
      setGroupName('');
      onOpen(group);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <SafeAreaView style={styles.flex}>
      <Text style={styles.header}>Hi, {me.name}</Text>
      <View style={styles.tabs}>
        {[['chats', 'Chats'], ['users', 'Users'], ['group', 'New Group']].map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => { setTab(key); if (key === 'chats') loadConversations(); }}>
            <Text>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'chats' && (
        <FlatList data={conversations} keyExtractor={(c) => c.id}
          ListEmptyComponent={<Text style={styles.hint}>No conversations yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => onOpen(item)}>
              <Text style={styles.rowTitle}>{titleOf(item)}</Text>
              <Text style={styles.hint}>{item.type}</Text>
            </TouchableOpacity>
          )} />
      )}

      {tab === 'users' && (
        <FlatList data={otherUsers} keyExtractor={(u) => u.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => startDm(item)}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.hint}>Tap to message</Text>
            </TouchableOpacity>
          )} />
      )}

      {tab === 'group' && (
        <View style={styles.flex}>
          <TextInput style={styles.input} placeholder="Group name" value={groupName}
            onChangeText={setGroupName} />
          <FlatList data={otherUsers} keyExtractor={(u) => u.id} extraData={selected}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.row, selected.includes(item.id) && styles.rowSelected]}
                onPress={() => toggle(item.id)}>
                <Text style={styles.rowTitle}>{selected.includes(item.id) ? '✓ ' : ''}{item.name}</Text>
              </TouchableOpacity>
            )} />
          <TouchableOpacity style={styles.button} onPress={createGroup}>
            <Text style={styles.buttonText}>Create Group ({selected.length})</Text>
          </TouchableOpacity>
        </View>
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function ChatScreen({ me, users, chat, onBack }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || 'Unknown';
  const title = chat.name ||
    chat.participants_ids.filter((id) => id !== me.id).map(nameOf).join(', ') || 'Chat';

  async function load() {
    try {
      const res = await api.getMessages(chat.id);
      setMessages(res.data);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  // Load once, then refresh every 3 seconds so new messages show up.
  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setText('');
    try {
      await api.sendMessage(chat.id, content);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function sendImage() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.4 });
    if (r.canceled) return;
    try {
      await api.sendMessage(chat.id, undefined, `data:image/jpeg;base64,${r.assets[0].base64}`);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  // FlatList is inverted (newest at the bottom), so give it newest-first.
  const newestFirst = [...messages].reverse();

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={styles.chatTitle} numberOfLines={1}>{title}</Text>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList inverted data={newestFirst} keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const mine = item.senderId === me.id;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && <Text style={styles.sender}>{nameOf(item.senderId)}</Text>}
                {!!item.imageInfo && <Image source={{ uri: item.imageInfo }} style={styles.image} />}
                {!!item.content && <Text>{item.content}</Text>}
              </View>
            );
          }} />
        <View style={styles.inputRow}>
          <TouchableOpacity onPress={sendImage}><Text style={styles.attach}>📷</Text></TouchableOpacity>
          <TextInput style={[styles.input, styles.flex]} placeholder="Message" value={text}
            onChangeText={setText} onSubmitEditing={send} />
          <TouchableOpacity style={styles.sendButton} onPress={send}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  header: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  hint: { color: '#888', textAlign: 'center', margin: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, margin: 8 },
  button: { backgroundColor: '#2f6fed', padding: 14, borderRadius: 8, margin: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  tabs: { flexDirection: 'row' },
  tab: { flex: 1, padding: 12, alignItems: 'center', borderBottomWidth: 2, borderColor: '#eee' },
  tabActive: { borderColor: '#2f6fed' },
  row: { padding: 16, borderBottomWidth: 1, borderColor: '#eee' },
  rowSelected: { backgroundColor: '#e6efff' },
  rowTitle: { fontSize: 16 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderColor: '#eee' },
  back: { color: '#2f6fed', fontSize: 18, marginRight: 12 },
  chatTitle: { fontSize: 18, fontWeight: 'bold', flex: 1 },
  bubble: { maxWidth: '75%', padding: 10, borderRadius: 12, marginHorizontal: 10, marginVertical: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#cfe0ff' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#eee' },
  image: { width: 200, height: 200, borderRadius: 8 },
  attach: { fontSize: 26, marginLeft: 6 },
  sender: { fontSize: 11, color: '#666', marginBottom: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: 4 },
  sendButton: { backgroundColor: '#2f6fed', padding: 12, borderRadius: 8, marginRight: 8 },
});
