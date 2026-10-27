import { useState, useEffect, useRef } from 'react';
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
import { supabase } from '../services/supabaseClient';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';

export default function ChatView({ user, onBack }) {
  const { user: currentUser, token, onlineUsers } = useAuth();
  const { startCall } = useVoice();

  const isOnline = onlineUsers?.has(user.id);
  const displayName = user.display_name || user.username || user.name || 'Friend';
  const myName = currentUser?.display_name || currentUser?.username || 'Me';

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchMessages = async () => {
    if (!token || !user?.id) return;
    try {
      const res = await fetch(`${BACKEND_URL}/messages/direct/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [user.id, token]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Realtime DMs
  useEffect(() => {
    if (!currentUser?.id || !user?.id) return;

    const channel = supabase
      .channel(`direct_messages:${currentUser.id}-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages'
        },
        (payload) => {
          const newMsg = payload.new;
          const isRelevant = 
            (newMsg.sender_id === currentUser.id && newMsg.receiver_id === user.id) ||
            (newMsg.sender_id === user.id && newMsg.receiver_id === currentUser.id);

          if (isRelevant) {
            setMessages((prev) => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, user?.id]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !token) return;

    const messageText = inputText.trim();
    setInputText('');

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

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      }
    } catch (err) {
      console.error('Send message error:', err);
    }
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
            onClick={() => startCall(user, false)}
            className="hover:text-[#23a55a] p-2 hover:bg-[#111214] rounded-full transition" 
            title="Start Voice Call"
          >
            <Phone size={19} />
          </button>
          <button 
            onClick={() => startCall(user, true)}
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4 discord-scrollbar">
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
              className={`transition ${inputText.trim() ? 'text-[#5865f2] hover:text-[#4752c4]' : 'opacity-40 cursor-not-allowed'}`}
              disabled={!inputText.trim()}
            >
              <SendHorizontal size={22} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
