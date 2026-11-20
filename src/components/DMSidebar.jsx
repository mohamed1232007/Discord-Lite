import { useState, useEffect, useRef } from 'react';
import {
  Users,
  Sparkles,
  ShoppingBag,
  Compass,
  Plus,
  Mic, MicOff,
  Headphones, VolumeX,
  Settings,
  X,
  LogIn,
  LogOut,
  Wifi,
  ChevronDown,
  Check
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useVoice } from '../context/VoiceContext';
import { useToast } from '../context/ToastContext';
import { useNotification } from '../context/NotificationContext';
import { BACKEND_URL } from '../services/backendUrl';
import SettingsPage from './SettingsPage';

const UNREAD_STORAGE_KEY = 'dis_lite_unread_messages';
const UNREAD_CURSOR_STORAGE_KEY = 'dis_lite_unread_cursor';

const readStoredValue = (key, fallback) => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn('[Messages] Could not restore unread message state:', error);
    return fallback;
  }
};

const readStoredCursor = (key) => {
  try {
    const storedCursor = window.localStorage.getItem(key);
    if (!storedCursor || Number.isNaN(Date.parse(storedCursor))) return null;
    return new Date(storedCursor).toISOString();
  } catch (error) {
    console.warn('[Messages] Could not restore unread message cursor:', error);
    return null;
  }
};

export default function DMSidebar({
  selectedChat,
  isChatVisible,
  onSelectChat,
  onShowCall,
  onOpenAuth,
}) {
  const { user, token, onlineUsers, signOut } = useAuth();
  const toast = useToast();
  const {
    activeCall,
    callParticipants,
    isMuted,
    isDeafened,
    isVideoEnabled,
    isScreenSharing,
    microphones,
    speakers,
    selectedMic,
    selectedSpeaker,
    speakingUsers,
    changeMicrophone,
    changeSpeaker,
    updateAudioDevices,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    endCall,
  } = useVoice();
  const { showNotification } = useNotification();
  const showNotificationRef = useRef(showNotification);
  useEffect(() => {
    showNotificationRef.current = showNotification;
  }, [showNotification]);

  const [friends, setFriends] = useState([]);
  const friendsRef = useRef([]);
  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showSpeakerMenu, setShowSpeakerMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [unreadState, setUnreadState] = useState(() => ({
    userId: user?.id || null,
    counts: user?.id ? readStoredValue(`${UNREAD_STORAGE_KEY}:${user.id}`, {}) : {},
  }));
  const unreadCounts = unreadState.userId === user?.id
    ? unreadState.counts
    : user?.id
      ? readStoredValue(`${UNREAD_STORAGE_KEY}:${user.id}`, {})
      : {};

  const settingsMenuRef = useRef(null);
  const micMenuRef = useRef(null);
  const speakerMenuRef = useRef(null);
  const unreadCountsRef = useRef({});
  const unreadCursorRef = useRef(null);
  const unreadPollInFlightRef = useRef(false);
  const selectedChatIdRef = useRef(isChatVisible ? selectedChat?.id : null);
  // إغلاق القوائم عند النقر في أي مكان خارجها
  useEffect(() => {
    selectedChatIdRef.current = isChatVisible ? selectedChat?.id : null;
  }, [isChatVisible, selectedChat?.id]);

  // مسح علامة الأنريد تلقائياً لما يفتح المستخدم أي محادثة (من أي مسار)
  useEffect(() => {
    if (!isChatVisible || !selectedChat?.id || !user?.id) return;
    const friendId = selectedChat.id;
    if (!unreadCountsRef.current[friendId]) return;
    const nextCounts = { ...unreadCountsRef.current };
    delete nextCounts[friendId];
    unreadCountsRef.current = nextCounts;
    setUnreadState({ userId: user.id, counts: nextCounts });
    try {
      window.localStorage.setItem(`${UNREAD_STORAGE_KEY}:${user.id}`, JSON.stringify(nextCounts));
    } catch (err) {
      console.warn('[Messages] Could not clear unread state:', err);
    }
  }, [isChatVisible, selectedChat?.id, user?.id]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) {
        setShowSettingsMenu(false);
      }
      if (micMenuRef.current && !micMenuRef.current.contains(e.target)) {
        setShowMicMenu(false);
      }
      if (speakerMenuRef.current && !speakerMenuRef.current.contains(e.target)) {
        setShowSpeakerMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!token) return undefined;

    const fetchFriends = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/friends`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const list = data.friends || [];
          setFriends(list);
          try {
            window.localStorage.setItem('dis_lite_friends_cache', JSON.stringify(list));
          } catch (err) {
            console.warn('[Friends] Failed to cache friends:', err);
          }
        }
      } catch (err) {
        console.error('Failed to load friends:', err);
      }
    };

    fetchFriends();
    const interval = setInterval(fetchFriends, 30000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!user?.id || !token) {
      unreadCountsRef.current = {};
      unreadCursorRef.current = null;
      return;
    }

    const countsKey = `${UNREAD_STORAGE_KEY}:${user.id}`;
    const cursorKey = `${UNREAD_CURSOR_STORAGE_KEY}:${user.id}`;
    const storedCounts = readStoredValue(countsKey, {});
    const storedCursor = readStoredCursor(cursorKey);
    const counts = storedCounts && typeof storedCounts === 'object' && !Array.isArray(storedCounts)
      ? storedCounts
      : {};

    unreadCountsRef.current = counts;
    // المؤشر يأتي من توقيت السيرفر فقط؛ أول طلب يحدده تلقائياً
    unreadCursorRef.current = storedCursor || null;
  }, [token, user?.id]);

  useEffect(() => {
    if (!token || !user?.id) return undefined;

    const pollUnreadMessages = async () => {
      if (unreadPollInFlightRef.current) return;
      unreadPollInFlightRef.current = true;
      const after = unreadCursorRef.current;

      try {
        const query = new URLSearchParams();
        if (after) query.set('after', after);
        const response = await fetch(`${BACKEND_URL}/messages/inbox/unread?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`Unread messages request failed (${response.status}).`);

        const data = await response.json();
        const unreadBySender = data.unreadBySender || {};
        const latestMessages = data.latestMessages || [];

        // تشغيل الإشعار للرسائل الجديدة
        let handledNotification = false;
        if (after && Array.isArray(latestMessages) && latestMessages.length > 0) {
          latestMessages.forEach((msg) => {
            const isCurrentChatActive = !document.hidden && document.hasFocus() && selectedChatIdRef.current === msg.senderId;
            if (!isCurrentChatActive) {
              handledNotification = true;
              const sender = msg.sender
                || friendsRef.current.find((f) => f.id === msg.senderId)
                || {
                  id: msg.senderId,
                  username: msg.senderName || 'Friend',
                  display_name: msg.senderName || 'Friend',
                  avatar_url: msg.senderAvatarUrl || null,
                };
              showNotificationRef.current({
                id: msg.id,
                sender,
                content: msg.content,
                fileUrl: msg.fileUrl || msg.file_url,
              });
            }
          });
        }

        // مسار بديل موثوق: في حال كان السيرفر الحالي يرجع unreadBySender فقط
        if (!handledNotification && after && unreadBySender && typeof unreadBySender === 'object') {
          const sendersNeedingFallback = Object.entries(unreadBySender).filter(([senderId, count]) => {
            const isCurrentChatActive = !document.hidden && document.hasFocus() && selectedChatIdRef.current === senderId;
            return count > 0 && !isCurrentChatActive;
          });

          await Promise.all(sendersNeedingFallback.map(async ([senderId]) => {
            try {
              const messagesResponse = await fetch(
                `${BACKEND_URL}/messages/direct/${encodeURIComponent(senderId)}?limit=100`,
                { headers: { Authorization: `Bearer ${token}` } },
              );
              if (!messagesResponse.ok) {
                throw new Error(`Direct messages request failed (${messagesResponse.status}).`);
              }

              const { messages = [] } = await messagesResponse.json();
              const latestIncomingMessage = messages
                .filter((message) => message.sender_id === senderId)
                .pop();
              if (!latestIncomingMessage) return;

              const sender = friendsRef.current.find((friend) => friend.id === senderId) || {
                id: senderId,
                username: 'Friend',
                display_name: 'Friend',
              };
              showNotificationRef.current({
                id: latestIncomingMessage.id,
                sender,
                content: latestIncomingMessage.content,
                fileUrl: latestIncomingMessage.file_url,
              });
            } catch (error) {
              console.error('[Notifications] Failed to load unread message content:', error);
            }
          }));
        }

        const nextCounts = { ...unreadCountsRef.current };
        Object.entries(unreadBySender).forEach(([senderId, count]) => {
          if (senderId !== selectedChatIdRef.current) {
            nextCounts[senderId] = (nextCounts[senderId] || 0) + count;
          }
        });

        unreadCountsRef.current = nextCounts;
        setUnreadState({ userId: user.id, counts: nextCounts });
        window.localStorage.setItem(`${UNREAD_STORAGE_KEY}:${user.id}`, JSON.stringify(nextCounts));

        // استخدام مؤشر السيرفر يمنع فقدان/تكرار العدّاد عند اختلاف ساعة الجهاز
        const nextCursor = data.cursor || new Date().toISOString();
        unreadCursorRef.current = nextCursor;
        window.localStorage.setItem(`${UNREAD_CURSOR_STORAGE_KEY}:${user.id}`, nextCursor);
      } catch (error) {
        console.error('[Messages] Could not update unread counts:', error);
      } finally {
        unreadPollInFlightRef.current = false;
      }
    };

    pollUnreadMessages();
    const interval = window.setInterval(pollUnreadMessages, 5000);
    const handleVisibilityChange = () => {
      if (!document.hidden) pollUnreadMessages();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, user?.id, selectedChat?.id, isChatVisible]);

  const openFriendChat = (friend) => {
    if (user?.id && unreadCountsRef.current[friend.id]) {
      const nextCounts = { ...unreadCountsRef.current };
      delete nextCounts[friend.id];
      unreadCountsRef.current = nextCounts;
      setUnreadState({ userId: user.id, counts: nextCounts });
      try {
        window.localStorage.setItem(`${UNREAD_STORAGE_KEY}:${user.id}`, JSON.stringify(nextCounts));
      } catch (error) {
        console.error('[Messages] Could not save unread message state:', error);
      }
    }
    onSelectChat(friend);
  };

  const currentDisplayName = user?.display_name || user?.username || 'Guest';
  const currentUsername    = user?.username || 'guest';
  const visibleFriends = token ? friends : [];

  const callFriendName = activeCall?.friend?.display_name || activeCall?.friend?.username || 'Bedo';
  const activeParticipantCount = callParticipants?.filter((participant) => participant.status === 'active').length || 0;

  return (
    <div className="w-64 bg-(--app-sidebar) border-r border-(--app-border) flex flex-col h-full select-none shrink-0 font-sans">

      {/* ── Search Bar ── */}
      <div className="h-12 px-2.5 flex items-center border-b border-[#111214]">
        <button
          type="button"
          onClick={() => onSelectChat(null)}
          className="w-full h-7 bg-[#111214] text-[#80848e] text-xs px-2 rounded flex items-center justify-start gap-2 hover:bg-[#18191c] transition cursor-pointer"
        >
          <span>Find or start a conversation</span>
        </button>
      </div>

      {/* ── Navigation & DM List ── */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 text-[#949ba4] font-medium text-sm discord-scrollbar">

        <button
          type="button"
          onClick={() => onSelectChat(null)}
          className={`w-full flex items-center gap-4 px-3 py-2 rounded-md transition cursor-pointer ${
            selectedChat === null ? 'bg-[#18191c] text-white' : 'hover:bg-[#111214] hover:text-[#dbdee1]'
          }`}
        >
          <Users size={18} className="text-[#dbdee1]" />
          <span>Friends</span>
        </button>

        <button 
          type="button" 
          onClick={() => toast.info('Under development')}
          className="w-full flex items-center gap-4 px-3 py-2 rounded-md hover:bg-[#111214] hover:text-[#dbdee1] transition cursor-pointer"
        >
          <Sparkles size={18} className="text-[#dbdee1]" />
          <span>Nitro</span>
        </button>

        <button 
          type="button" 
          onClick={() => toast.info('Under development')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-[#111214] hover:text-[#dbdee1] transition cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <ShoppingBag size={18} className="text-[#dbdee1]" />
            <span>Shop</span>
          </div>
        </button>

        <button 
          type="button" 
          onClick={() => toast.info('Under development')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-[#111214] hover:text-[#dbdee1] transition cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <Compass size={18} className="text-[#dbdee1]" />
            <span>Quests</span>
          </div>
        </button>

        {/* ── Direct Messages Header ── */}
        <div className="pt-4 pb-1 px-2 flex items-center justify-between text-xs font-bold text-[#80848e] hover:text-[#dbdee1] tracking-wide uppercase">
          <span>Direct Messages</span>
          <button 
            type="button" 
            onClick={() => toast.info('Under development')}
            title="Create DM" 
            className="hover:text-white transition cursor-pointer"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-0.5 pt-1">
          {visibleFriends.length === 0 ? (
            <div className="text-[11px] text-[#80848e] px-2 py-2">
              No active conversations yet. Add friends to start chatting!
            </div>
          ) : (
            visibleFriends.map((u) => {
              const isSelected = selectedChat?.id === u.id;
              const isOnline   = onlineUsers.has(u.id);
              const isInCall = callParticipants?.some((participant) => (
                participant.user_id === u.id && participant.status === 'active'
              )) || activeCall?.friend?.id === u.id;

              return (
                <div
                  key={u.id}
                  onClick={() => openFriendChat(u)}
                  className={`w-full group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition ${
                    isSelected ? 'bg-[#18191c] text-white' : 'hover:bg-[#111214] hover:text-[#dbdee1]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-full bg-[#1e1f22] flex items-center justify-center font-bold text-xs text-white">
                        {(u.display_name || u.username).substring(0, 2).toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#000000] ${
                        isInCall   ? 'bg-[#23a55a]' :
                        isOnline   ? 'bg-[#23a55a]' : 'bg-[#80848e]'
                      }`} />
                    </div>

                    <div className="text-left min-w-0 flex-1">
                      <div className="truncate text-sm font-medium leading-tight text-white">
                        {u.display_name || u.username}
                      </div>
                      <div className={`text-[11px] truncate ${isInCall ? 'text-[#23a55a]' : 'text-[#80848e]'}`}>
                        {isInCall ? '🔊 In Call' : isOnline ? 'Online' : 'Offline'}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelectChat(null); }}
                      className="text-[#80848e] hover:text-white p-0.5 rounded cursor-pointer"
                      title="Close DM"
                    >
                      <X size={14} />
                    </button>
                  )}
                  {!isSelected && unreadCounts[u.id] > 0 && (
                    <span
                      className="ml-2 min-w-5 h-5 px-1.5 rounded-full bg-[#f23f43] text-white text-[11px] font-bold leading-5 text-center shrink-0"
                      aria-label={`${unreadCounts[u.id]} unread messages`}
                    >
                      {unreadCounts[u.id] > 99 ? '99+' : unreadCounts[u.id]}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Discord Official Voice Connected Bottom Module (تطابق كامل 100%) ── */}
      <div className={`relative z-20 shrink-0 ${
        activeCall
          ? '-ml-14 w-[calc(100%+3.5rem)] rounded-t-xl border-x border-t border-[#1e1f22] bg-[#050506]'
          : '-ml-14 w-[calc(100%+3.5rem)] border-t border-[#111214] bg-[#070708]'
      }`}>
        
        {/* صندوق الـ Voice Connected */}
        {activeCall && (
          <div className="p-2.5 pb-2 border-b border-[#141517]">
            {/* Top row: Status info & right actions */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Signal Icon Box */}
                <div className="w-9 h-9 rounded-xl bg-[#0e1011] border border-[#1b1c1e] flex items-center justify-center text-[#23a55a] shrink-0">
                  <Wifi size={18} className="stroke-[2.5]" />
                </div>
                {/* Titles */}
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={onShowCall}
                    className="voice-call-title -ml-1 rounded px-1 py-0.5 text-left text-[#23a55a] text-xs font-bold leading-tight tracking-wide transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2] focus-visible:ring-offset-2 focus-visible:ring-offset-(--app-background)"
                    title="Return to voice call"
                  >
                    Voice Call
                  </button>
                  <div className="text-[11px] text-[#949ba4] truncate leading-tight mt-0.5">
                    {callFriendName} · {activeParticipantCount} in voice
                  </div>
                </div>
              </div>

              {/* Right Side: Ping Audio Waveform + Disconnect Button */}
              <div className="flex items-center gap-2.5 text-[#b5bac1]">
                {/* Waveform graphic */}
                <div className="flex items-center gap-0.5 text-[#b5bac1]" title="Ping status">
                  <span className="w-0.5 h-3 bg-[#b5bac1] rounded-full inline-block" />
                  <span className="w-0.5 h-4 bg-[#b5bac1] rounded-full inline-block" />
                  <span className="w-0.5 h-2 bg-[#b5bac1] rounded-full inline-block" />
                  <span className="w-0.5 h-3.5 bg-[#b5bac1] rounded-full inline-block" />
                </div>

                {/* Disconnect Phone Down Button */}
                <button
                  type="button"
                  onClick={() => endCall(true)}
                  className="hover:text-[#f23f43] transition cursor-pointer p-0.5"
                  title="Disconnect"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.28 8.77 7.42 7 12 7s8.72 1.77 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 4 Discord Action Buttons Grid */}
            <div className="grid grid-cols-4 gap-1.5 pt-0.5">
              {/* 1. Camera Toggle */}
              <button
                type="button"
                onClick={toggleCamera}
                className="h-8 bg-[#18191c] hover:bg-[#2b2d31] text-[#dbdee1] hover:text-white rounded flex items-center justify-center transition cursor-pointer"
                title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
              >
                {isVideoEnabled ? (
                  <svg className="w-4 h-4 fill-current text-[#23a55a]" viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                ) : (
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>
                )}
              </button>

              {/* 2. Screen Share (Stream) */}
              <button
                type="button"
                onClick={toggleScreenShare}
                className={`h-8 rounded flex items-center justify-center transition cursor-pointer ${
                  isScreenSharing ? 'bg-[#23a55a] text-white' : 'bg-[#18191c] hover:bg-[#2b2d31] text-[#dbdee1] hover:text-white'
                }`}
                title={isScreenSharing ? 'Stop Streaming' : 'Share Your Screen'}
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6zm7 3l4 3-4 3V9z"/>
                </svg>
              </button>

              {/* 3. Activities (Rocket / Shapes) */}
              <button
                type="button"
                onClick={() => toast.info('Under development')}
                className="h-8 bg-[#18191c] hover:bg-[#2b2d31] text-[#dbdee1] hover:text-white rounded flex items-center justify-center transition cursor-pointer"
                title="Start an Activity"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5h-2v-2h2zm0-4h-2V7h2z"/>
                </svg>
              </button>

              {/* 4. Soundboard */}
              <button
                type="button"
                onClick={() => toast.info('Under development')}
                className="h-8 bg-[#18191c] hover:bg-[#2b2d31] text-[#dbdee1] hover:text-white rounded flex items-center justify-center transition cursor-pointer"
                title="Under development"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5h-2v-2h2zm0-4h-2V7h2z"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ── User Footer Profile ── */}
        <div className={activeCall ? 'mb-2 w-full rounded-b-xl border-x border-b border-(--app-border) px-2.5 pb-2' : 'w-full px-2 pb-2'}>
          <div className={`flex h-16 w-full items-center justify-between text-(--app-text) ${
            activeCall
              ? 'rounded-b-xl bg-(--app-surface) px-3'
              : 'rounded-xl border border-(--app-border) bg-(--app-surface) px-3'
          }`}>
            {user ? (
              <div
                className="flex items-center gap-3 min-w-0 flex-1"
                title={`@${currentUsername}`}
              >
                <div className="relative h-9 w-9 shrink-0">
                  <div className={`h-9 w-9 overflow-hidden rounded-full bg-(--app-surface-raised) flex items-center justify-center text-xs font-semibold text-(--app-text) transition-all duration-150 ${
                    speakingUsers?.[user.id] ? 'speaking-ring' : ''
                  }`}>
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={currentDisplayName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      currentDisplayName.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-(--app-surface) bg-[#23a55a]" />
                </div>

                <div className="min-w-0 leading-tight">
                  <div className="text-sm font-semibold text-(--app-text) truncate">{currentDisplayName}</div>
                  {activeCall ? (
                    <div className="text-[11px] text-(--app-text-muted) font-normal flex items-center gap-1 leading-tight mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-[#23a55a] shrink-0" />
                      In voice
                    </div>
                  ) : (
                    <div className="text-[11px] text-(--app-text-muted) font-normal flex items-center gap-1 leading-tight mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-[#23a55a] shrink-0" />
                      Online
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition cursor-pointer"
              >
                <LogIn size={14} />
                <span>Log In / Sign Up</span>
              </button>
            )}

            <div className="flex items-center gap-1 text-(--app-text-secondary) shrink-0">
              {user ? (
                <>
                  {/* Mute Split Button with Devices Dropdown */}
                  <div className="relative" ref={micMenuRef}>
                    <div className="flex items-center bg-[#1e1f22] rounded-lg">
                      <button
                        type="button"
                        onClick={toggleMute}
                        className={`p-1.5 transition flex items-center justify-center cursor-pointer rounded-l-lg ${
                          isMuted ? 'text-[#f23f43] bg-[#f23f43]/20 hover:bg-[#f23f43]/30' : 'text-white hover:bg-[#2b2d31]'
                        }`}
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted ? <MicOff size={17} /> : <Mic size={17} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateAudioDevices?.();
                          setShowMicMenu((prev) => !prev);
                          setShowSpeakerMenu(false);
                          setShowSettingsMenu(false);
                        }}
                        className={`px-1.5 py-1.5 text-[#80848e] hover:text-white hover:bg-[#2b2d31] transition cursor-pointer rounded-r-lg ${
                          showMicMenu ? 'bg-[#2b2d31] text-white' : ''
                        }`}
                        title="Select Input Device"
                      >
                        <ChevronDown size={11} />
                      </button>
                    </div>

                    {/* Microphone Devices Menu */}
                    {showMicMenu && (
                      <div className="absolute bottom-9 left-0 w-60 bg-[#111214] border border-[#2b2d31] rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
                        <div className="text-[10px] font-bold tracking-wider text-[#80848e] uppercase px-2 py-1">
                          Input Device (Microphone)
                        </div>
                        <div className="max-h-48 overflow-y-auto discord-scrollbar flex flex-col gap-0.5">
                          {microphones.length === 0 ? (
                            <div className="text-xs text-[#80848e] px-2 py-1.5">Default Microphone</div>
                          ) : (
                            microphones.map((mic) => {
                              const isSelected = selectedMic === mic.deviceId;
                              return (
                                <button
                                  key={mic.deviceId}
                                  type="button"
                                  onClick={() => {
                                    changeMicrophone(mic.deviceId);
                                    setShowMicMenu(false);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-lg transition text-left cursor-pointer ${
                                    isSelected
                                      ? 'bg-[#5865f2] text-white font-semibold'
                                      : 'text-[#dbdee1] hover:bg-[#1e1f22] hover:text-white'
                                  }`}
                                >
                                  <span className="truncate">{mic.label}</span>
                                  {isSelected && <Check size={14} className="shrink-0" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Deafen Split Button with Devices Dropdown */}
                  <div className="relative" ref={speakerMenuRef}>
                    <div className="flex items-center bg-[#1e1f22] rounded-lg">
                      <button
                        type="button"
                        onClick={toggleDeafen}
                        className={`p-1.5 rounded-l-lg transition cursor-pointer ${
                          isDeafened ? 'text-[#f23f43] bg-[#f23f43]/20 hover:bg-[#f23f43]/30' : 'text-[#dbdee1] hover:text-white hover:bg-[#2b2d31]'
                        }`}
                        title={isDeafened ? 'Undeafen' : 'Deafen'}
                      >
                        {isDeafened ? <VolumeX size={17} /> : <Headphones size={17} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateAudioDevices?.();
                          setShowSpeakerMenu((prev) => !prev);
                          setShowMicMenu(false);
                          setShowSettingsMenu(false);
                        }}
                        className={`px-1.5 py-1.5 text-[#80848e] hover:text-white hover:bg-[#2b2d31] transition cursor-pointer rounded-r-lg ${
                          showSpeakerMenu ? 'bg-[#2b2d31] text-white' : ''
                        }`}
                        title="Select Output Device"
                      >
                        <ChevronDown size={11} />
                      </button>
                    </div>

                    {/* Speaker Devices Menu */}
                    {showSpeakerMenu && (
                      <div className="absolute bottom-9 left-0 w-60 bg-[#111214] border border-[#2b2d31] rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
                        <div className="text-[10px] font-bold tracking-wider text-[#80848e] uppercase px-2 py-1">
                          Output Device (Speaker)
                        </div>
                        <div className="max-h-48 overflow-y-auto discord-scrollbar flex flex-col gap-0.5">
                          {speakers.length === 0 ? (
                            <div className="text-xs text-[#80848e] px-2 py-1.5">Default Speaker</div>
                          ) : (
                            speakers.map((spk) => {
                              const isSelected = selectedSpeaker === spk.deviceId;
                              return (
                                <button
                                  key={spk.deviceId}
                                  type="button"
                                  onClick={() => {
                                    changeSpeaker(spk.deviceId);
                                    setShowSpeakerMenu(false);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-lg transition text-left cursor-pointer ${
                                    isSelected
                                      ? 'bg-[#5865f2] text-white font-semibold'
                                      : 'text-[#dbdee1] hover:bg-[#1e1f22] hover:text-white'
                                  }`}
                                >
                                  <span className="truncate">{spk.label}</span>
                                  {isSelected && <Check size={14} className="shrink-0" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Settings Gear with Dropdown Menu */}
                  <div className="relative" ref={settingsMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowSettingsMenu((prev) => !prev)}
                      className={`p-1.5 rounded transition cursor-pointer ${
                        showSettingsMenu
                          ? 'bg-(--app-surface-active) text-(--app-text)'
                          : 'hover:bg-(--app-surface-hover) hover:text-(--app-text)'
                      }`}
                      title="User Settings"
                    >
                      <Settings size={17} />
                    </button>

                    {/* Settings Popup Menu */}
                    {showSettingsMenu && (
                      <div className="settings-menu-enter absolute bottom-9 right-0 z-50 flex w-44 flex-col gap-0.5 rounded-xl border border-(--app-border) bg-(--app-surface) p-1.5 shadow-2xl">
                        <button
                          type="button"
                          onClick={() => {
                            setShowSettingsMenu(false);
                            setShowSettings(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-(--app-text) hover:text-white hover:bg-[#5865f2] rounded-lg transition text-left cursor-pointer font-medium"
                        >
                          <Settings size={14} />
                          <span>Settings</span>
                        </button>

                        <div className="w-full h-px bg-(--app-border) my-0.5" />

                        <button
                          type="button"
                          onClick={() => {
                            setShowSettingsMenu(false);
                            signOut();
                          }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-[#f23f43] hover:text-white hover:bg-[#f23f43] rounded-lg transition text-left cursor-pointer font-medium"
                        >
                          <LogOut size={14} />
                          <span>Log Out</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="p-1.5 hover:bg-[#18191c] hover:text-white rounded transition cursor-pointer"
                  title="Log In"
                >
                  <LogIn size={17} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Settings Full Page Modal ─── */}
      {showSettings && (
        <SettingsPage onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
