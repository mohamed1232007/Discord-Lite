import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { 
  Phone, 
  Video, 
  Search, 
  Inbox, 
  HelpCircle,
  PlusCircle, 
  Gift, 
  SendHorizontal,
  ArrowLeft,
  Loader2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useVoice } from '../context/VoiceContext';
import { useToast } from '../context/ToastContext';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';
const PAGE_SIZE = 100;

const sortByCreatedAt = (a, b) => {
  const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (diff !== 0) return diff;
  return String(a.id).localeCompare(String(b.id));
};

export default function ChatView({ user, onBack, onCallStarted }) {
  const { user: currentUser, token, onlineUsers } = useAuth();
  const { startCall } = useVoice();
  const toast = useToast();

  const isOnline = onlineUsers?.has(user.id);
  const displayName = user.display_name || user.username || user.name || 'Friend';
  const myName = currentUser?.display_name || currentUser?.username || 'Me';

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const initialLoadDoneRef = useRef(false);
  const pendingScrollRestoreRef = useRef(null);

  const handleScroll = () => {
    const element = scrollContainerRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  };

  useLayoutEffect(() => {
    if (pendingScrollRestoreRef.current !== null) {
      const element = scrollContainerRef.current;
      if (element) element.scrollTop = element.scrollHeight - pendingScrollRestoreRef.current;
      pendingScrollRestoreRef.current = null;
      return;
    }
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // جلب أحدث صفحة من الرسائل + دمجها مع ما تم تحميله مسبقاً
  const currentUserId = user?.id;
  const fetchMessages = useCallback(async () => {
    if (!token || !currentUserId) return;
    try {
      const res = await fetch(`${BACKEND_URL}/messages/direct/${currentUserId}?limit=${PAGE_SIZE}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        if (res.status !== 401) {
          console.error(`Fetch messages failed with status ${res.status}.`);
        }
        return;
      }
      const data = await res.json();
      const latest = data.messages || [];

      setMessages((previousMessages) => {
        if (previousMessages.length === 0) return latest;
        const knownIds = new Set(previousMessages.map((message) => message.id));
        const additions = latest.filter((message) => !knownIds.has(message.id));
        if (additions.length === 0) return previousMessages;
        return [...previousMessages, ...additions].sort(sortByCreatedAt);
      });

      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        setHasMore(Boolean(data.hasMore));
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  }, [token, currentUserId]);

  // تحميل الرسائل الأقدم (pagination) مع الحفاظ على موضع التمرير
  const loadOlderMessages = async () => {
    if (!hasMore || loadingMore || !token || messages.length === 0) return;

    const element = scrollContainerRef.current;
    pendingScrollRestoreRef.current = element ? element.scrollHeight : null;
    stickToBottomRef.current = false;
    setLoadingMore(true);

    try {
      const before = encodeURIComponent(messages[0].created_at);
      const res = await fetch(`${BACKEND_URL}/messages/direct/${user.id}?limit=${PAGE_SIZE}&before=${before}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}.`);

      const data = await res.json();
      const older = data.messages || [];
      setMessages((previousMessages) => {
        const knownIds = new Set(previousMessages.map((message) => message.id));
        const additions = older.filter((message) => !knownIds.has(message.id));
        if (additions.length === 0) return previousMessages;
        return [...additions, ...previousMessages].sort(sortByCreatedAt);
      });
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      console.error('Error loading older messages:', err);
      pendingScrollRestoreRef.current = null;
      toast.error('Could not load older messages.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(fetchMessages, 0);
    return () => window.clearTimeout(timer);
  }, [fetchMessages]);

  // تحديث الرسائل عبر الـ API الموثّق (Realtime غير متاح حالياً بسبب سياسات RLS)
  useEffect(() => {
    if (!currentUser?.id || !user?.id) return undefined;

    const poll = window.setInterval(() => {
      if (!document.hidden) fetchMessages();
    }, 3000);
    const handleVisibilityChange = () => {
      if (!document.hidden) fetchMessages();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.id, user?.id, fetchMessages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const messageText = inputText.trim();
    if (!messageText || !token || sending) return;

    setSending(true);
    setInputText('');
    stickToBottomRef.current = true;

    try {
      const res = await fetch(`${BACKEND_URL}/messages/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          receiverId: user.id,
          content: messageText
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Message could not be sent (${res.status}).`);
      }

      const data = await res.json();
      setMessages((prev) => (
        prev.some((message) => message.id === data.message.id) ? prev : [...prev, data.message]
      ));
    } catch (err) {
      console.error('Send message error:', err);
      // إعادة النص حتى لا تضيع الرسالة على المستخدم
      setInputText((current) => (current ? current : messageText));
      toast.error(err.message || 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const handleStartCall = async (isVideo) => {
    onCallStarted?.();
    await startCall(user, isVideo);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#000000] h-full overflow-hidden">
      {/* Chat Top Header */}
      <div className="h-12 border-b border-[#18191c] px-4 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="md:hidden text-[#80848e] hover:text-white p-1"
            title="Back to friends"
          >
            <ArrowLeft size={18} />
          </button>
          
          <div className="relative">
            <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white bg-[#1e1f22] border border-[#2b2d31]">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={displayName} className="w-full h-full rounded-full object-cover" />
              ) : (
                displayName.substring(0, 2).toUpperCase()
              )}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#000000] ${
              isOnline ? 'bg-[#23a55a]' : 'bg-[#80848e]'
            }`} />
          </div>
          <span className="font-bold text-white text-base">{displayName}</span>
        </div>

        {/* Action icons - تفعيل المكالمات الصوتية والفيديو */}
        <div className="flex items-center gap-2 text-[#80848e]">
          <button 
            onClick={() => handleStartCall(false)}
            className="hover:text-[#23a55a] p-2 hover:bg-[#111214] rounded-full transition" 
            title="Start Voice Call"
          >
            <Phone size={19} />
          </button>
          <button 
            onClick={() => handleStartCall(true)}
            className="hover:text-[#23a55a] p-2 hover:bg-[#111214] rounded-full transition" 
            title="Start Video Call"
          >
            <Video size={19} />
          </button>
          <div className="relative hidden md:block ml-2">
            <input 
              type="text" 
              placeholder="Search" 
              className="bg-[#111214] text-xs text-[#dbdee1] px-2 py-1 pr-6 rounded focus:outline-none focus:w-40 w-32 transition-all border border-[#18191c]"
            />
            <Search size={14} className="absolute right-1.5 top-1.5 text-[#80848e]" />
          </div>

          <button className="hover:text-white p-2 hover:bg-[#111214] rounded-full transition" title="Inbox">
            <Inbox size={19} />
          </button>
          <button className="hover:text-white p-2 hover:bg-[#111214] rounded-full transition" title="Help">
            <HelpCircle size={19} />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 discord-scrollbar"
      >
        {/* Welcome Banner */}
        <div className="pt-6 pb-2">
          <div className="w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl text-white mb-3 bg-[#1e1f22] border-2 border-[#2b2d31]">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={displayName} className="w-full h-full rounded-full object-cover" />
            ) : (
              displayName.substring(0, 2).toUpperCase()
            )}
          </div>
          <h2 className="text-3xl font-extrabold text-white mb-1">{displayName}</h2>
          <div className="text-sm font-semibold text-[#80848e] mb-2">@{user.username || 'user'}</div>
          <p className="text-sm text-[#80848e]">
            This is the beginning of your direct message history with <strong className="text-white">{displayName}</strong>.
          </p>
        </div>

        <div className="w-full h-[1px] bg-[#18191c] my-2" />

        {hasMore && !loading && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-md bg-[#111214] px-3 py-1.5 text-xs font-semibold text-[#dbdee1] transition hover:bg-[#1e1f22] disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={13} className="animate-spin" />}
              {loadingMore ? 'Loading older messages…' : 'Load older messages'}
            </button>
          </div>
        )}

        {/* Message bubbles */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-[#5865f2]" size={24} />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[#80848e] text-xs py-4">
            No messages yet. Say hello to {displayName}! 👋
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.sender_id === currentUser?.id;
            const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

            return (
              <div key={m.id} className="flex items-start gap-4 hover:bg-[#0c0d0e] -mx-4 px-4 py-1.5 rounded transition group">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                  isMe ? 'bg-[#5865f2]' : 'bg-[#1e1f22] border border-[#2b2d31]'
                }`}>
                  {isMe ? myName.substring(0, 2).toUpperCase() : displayName.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sm text-white hover:underline cursor-pointer">
                      {isMe ? myName : displayName}
                    </span>
                    <span className="text-[11px] text-[#80848e]">{timeStr}</span>
                  </div>
                  <p className="text-[#dbdee1] text-sm mt-0.5 leading-relaxed break-words">{m.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Bar */}
      <div className="px-4 pb-6 shrink-0">
        <form onSubmit={handleSend} className="bg-[#111214] border border-[#18191c] rounded-lg px-4 py-2.5 flex items-center gap-4">
          <button type="button" className="text-[#80848e] hover:text-white transition">
            <PlusCircle size={22} />
          </button>
          
          <input
            type="text"
            placeholder={`Message @${displayName}`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-transparent text-[#dbdee1] placeholder-[#80848e] text-sm focus:outline-none"
          />

          <div className="flex items-center gap-3 text-[#80848e]">
            <button type="button" className="hover:text-white transition">
              <Gift size={22} />
            </button>
            <button 
              type="submit" 
              className={`transition ${inputText.trim() && !sending ? 'text-[#5865f2] hover:text-[#4752c4]' : 'opacity-40 cursor-not-allowed'}`}
              disabled={!inputText.trim() || sending}
            >
              {sending ? <Loader2 size={22} className="animate-spin" /> : <SendHorizontal size={22} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
