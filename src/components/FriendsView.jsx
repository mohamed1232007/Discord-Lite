import { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  Search, 
  MessageSquare, 
  MoreVertical, 
  Inbox, 
  HelpCircle,
  Check,
  X,
  Loader2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';

export default function FriendsView({ onStartChat }) {
  const { token, onlineUsers } = useAuth();
  const [tab, setTab] = useState('online');
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [addSearchInput, setAddSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState('');
  const [requestStatus, setRequestStatus] = useState({});
  const [respondError, setRespondError] = useState('');

  const fetchFriends = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/friends`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    } catch (err) {
      console.error('Error fetching friends:', err);
    }
  }, [token]);

  const fetchPending = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/friends/pending`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.requests || []);
      }
    } catch (err) {
      console.error('Error fetching pending:', err);
    }
  }, [token]);

  // تحديث أولي + تحديث دوري حتى تظهر طلبات الصداقة الجديدة بدون إعادة تحميل
  useEffect(() => {
    if (!token) return undefined;

    const refresh = () => {
      fetchFriends();
      fetchPending();
    };
    const initialLoad = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 15000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [token, fetchFriends, fetchPending]);

  const handleSearchUsers = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (!addSearchInput.trim() || !token) return;

    setSearching(true);
    setSearchFeedback('');
    try {
      const res = await fetch(`${BACKEND_URL}/friends/search?username=${encodeURIComponent(addSearchInput.trim())}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.users || []);
        if (!data.users || data.users.length === 0) {
          setSearchFeedback(`No users found matching "${addSearchInput.trim()}".`);
        }
      } else {
        const errData = await res.json();
        setSearchFeedback(errData.error || 'Failed to search.');
      }
    } catch {
      setSearchFeedback('Error connecting to search server.');
    } finally {
      setSearching(false);
    }
  }, [addSearchInput, token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (addSearchInput.trim()) {
        handleSearchUsers();
      } else {
        setSearchResults([]);
        setSearchFeedback('');
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [addSearchInput, handleSearchUsers]);

  const handleSendRequest = async (targetUserId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/friends/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetUserId })
      });
      const data = await res.json();
      if (res.ok) {
        setRequestStatus(prev => ({ ...prev, [targetUserId]: 'Request Sent! ✅' }));
      } else {
        setRequestStatus(prev => ({ ...prev, [targetUserId]: data.error || 'Failed' }));
      }
    } catch {
      setRequestStatus(prev => ({ ...prev, [targetUserId]: 'Error' }));
    }
  };

  const handleRespond = async (requestId, action) => {
    setRespondError('');
    try {
      const res = await fetch(`${BACKEND_URL}/friends/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ requestId, action })
      });
      if (res.ok) {
        fetchPending();
        fetchFriends();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setRespondError(data.error || 'Could not update the friend request.');
    } catch (err) {
      console.error('Respond error:', err);
      setRespondError('Could not reach the server. Please try again.');
    }
  };

  // تحديد هل الصديق أونلاين حقيقي الآن عبر الـ Presence
  const isFriendOnline = (friendId) => {
    return onlineUsers.has(friendId);
  };

  const filteredFriends = friends.filter(friend => {
    const matchesSearch = (friend.display_name || friend.username).toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    
    // فلتر Online يعتمد الآن على الحضور الفعلي في نفس اللحظة
    if (tab === 'online') {
      return isFriendOnline(friend.id);
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#000000] h-full overflow-hidden select-none">
      {/* Top Navigation Bar */}
      <div className="h-12 border-b border-[#18191c] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[#80848e] pr-4 border-r border-[#1e1f22]">
            <Users size={22} className="text-[#80848e]" />
            <span className="font-semibold text-white text-base">Friends</span>
          </div>

          <div className="flex items-center gap-2 text-sm font-medium">
            <button
              onClick={() => setTab('online')}
              className={`px-2 py-1 rounded transition ${
                tab === 'online' ? 'bg-[#1e1f22] text-white' : 'text-[#80848e] hover:bg-[#18191c] hover:text-[#dbdee1]'
              }`}
            >
              Online
            </button>
            <button
              onClick={() => setTab('all')}
              className={`px-2 py-1 rounded transition ${
                tab === 'all' ? 'bg-[#1e1f22] text-white' : 'text-[#80848e] hover:bg-[#18191c] hover:text-[#dbdee1]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => { setTab('pending'); fetchPending(); }}
              className={`relative px-2 py-1 rounded transition ${
                tab === 'pending' ? 'bg-[#1e1f22] text-white' : 'text-[#80848e] hover:bg-[#18191c] hover:text-[#dbdee1]'
              }`}
            >
              Pending
              {pendingRequests.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 bg-[#f23f43] text-white text-[10px] font-bold rounded-full">
                  {pendingRequests.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setTab('add')}
              className={`px-2 py-1 rounded font-semibold transition ${
                tab === 'add' ? 'bg-transparent text-[#23a55a]' : 'bg-[#248046] text-white hover:bg-[#1a6334]'
              }`}
            >
              Add Friend
            </button>
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center gap-3 text-[#80848e]">
          <button className="hover:text-white p-1" title="New Group DM">
            <MessageSquare size={20} />
          </button>
          <div className="w-px h-4 bg-[#1e1f22]" />
          <button className="hover:text-white p-1" title="Inbox">
            <Inbox size={20} />
          </button>
          <button className="hover:text-white p-1" title="Help">
            <HelpCircle size={20} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {tab === 'add' ? (
          <div className="flex-1 p-6 overflow-y-auto discord-scrollbar">
            <h2 className="text-white font-bold text-base uppercase tracking-wider mb-2">ADD FRIEND</h2>
            <p className="text-xs text-[#80848e] mb-4">You can add friends with their Discord Lite username.</p>

            <form onSubmit={handleSearchUsers} className="relative flex items-center bg-[#111214] border border-[#18191c] rounded-lg p-3 focus-within:border-[#5865f2] transition mb-6">
              <input
                type="text"
                placeholder="Type a username to search (e.g. mohamed12112)"
                value={addSearchInput}
                onChange={(e) => setAddSearchInput(e.target.value)}
                className="flex-1 bg-transparent text-sm text-white placeholder-[#80848e] focus:outline-none"
              />
              <button
                type="submit"
                disabled={searching || !addSearchInput.trim()}
                className="bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold px-4 py-2 rounded transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                <span>Find User</span>
              </button>
            </form>

            {searchFeedback && (
              <div className="text-xs text-[#80848e] mb-4 italic">
                {searchFeedback}
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-[#80848e] uppercase tracking-wider mb-3">
                  Found Users ({searchResults.length}):
                </div>
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center justify-between p-3 bg-[#0c0d0e] border border-[#18191c] rounded-lg hover:border-[#1e1f22] transition">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#1e1f22] text-white font-bold flex items-center justify-center text-sm border border-[#2b2d31]">
                        {u.display_name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{u.display_name}</div>
                        <div className="text-xs text-[#80848e]">@{u.username}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSendRequest(u.id)}
                      disabled={!!requestStatus[u.id]}
                      className="bg-[#248046] hover:bg-[#1a6334] text-white text-xs font-semibold px-4 py-2 rounded transition disabled:opacity-60"
                    >
                      {requestStatus[u.id] || 'Send Friend Request'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'pending' ? (
          <div className="flex-1 p-6 overflow-y-auto discord-scrollbar">
            <div className="text-xs font-bold text-[#80848e] uppercase tracking-wider mb-4">
              Pending Requests — {pendingRequests.length}
            </div>
            {respondError && (
              <div className="mb-3 rounded border border-[#f23f43]/30 bg-[#f23f43]/10 p-3 text-xs text-[#f23f43]">
                {respondError}
              </div>
            )}
            {pendingRequests.length === 0 ? (
              <div className="text-center text-[#80848e] text-sm py-12">No pending friend requests.</div>
            ) : (
              <div className="space-y-2">
                {pendingRequests.map((req) => (
                  <div key={req.requestId} className="flex items-center justify-between p-3 bg-[#0c0d0e] border border-[#18191c] rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#1e1f22] text-white font-bold flex items-center justify-center text-sm">
                        {req.user?.display_name?.substring(0, 2).toUpperCase() || 'U'}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{req.user?.display_name || req.user?.username}</div>
                        <div className="text-xs text-[#80848e]">Incoming Friend Request • @{req.user?.username}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRespond(req.requestId, 'accept')}
                        className="w-9 h-9 rounded-full bg-[#111214] hover:bg-[#23a55a] text-[#80848e] hover:text-white flex items-center justify-center transition"
                        title="Accept"
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={() => handleRespond(req.requestId, 'decline')}
                        className="w-9 h-9 rounded-full bg-[#111214] hover:bg-[#f23f43] text-[#80848e] hover:text-white flex items-center justify-center transition"
                        title="Decline"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto discord-scrollbar">
            <div className="relative mb-6">
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#111214] text-[#dbdee1] placeholder-[#80848e] text-sm px-3 py-2 pr-8 rounded-md focus:outline-none focus:ring-1 focus:ring-[#5865f2]"
              />
              <Search size={18} className="absolute right-2.5 top-2.5 text-[#80848e]" />
            </div>

            <div className="text-xs font-bold text-[#80848e] uppercase tracking-wider mb-4">
              {tab === 'online' ? `Online — ${filteredFriends.length}` : `All Friends — ${filteredFriends.length}`}
            </div>

            {filteredFriends.length === 0 ? (
              <div className="text-center text-[#80848e] text-sm py-12">
                {tab === 'online' ? 'No friends currently online.' : 'You have not added any friends yet.'}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredFriends.map((f) => {
                  const online = isFriendOnline(f.id);
                  return (
                    <div
                      key={f.id}
                      onClick={() => onStartChat(f)}
                      className="group flex items-center justify-between p-2.5 rounded-lg hover:bg-[#111214] cursor-pointer border-t border-[#18191c]/50 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full bg-[#1e1f22] flex items-center justify-center font-bold text-sm text-white">
                            {(f.display_name || f.username).substring(0, 2).toUpperCase()}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#000000] ${
                            online ? 'bg-[#23a55a]' : 'bg-[#80848e]'
                          }`} />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white text-sm group-hover:underline">{f.display_name || f.username}</span>
                          </div>
                          <div className="text-xs text-[#80848e] truncate">
                            {online ? 'Online' : 'Offline'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); onStartChat(f); }}
                          className="w-9 h-9 rounded-full bg-[#111214] flex items-center justify-center text-[#80848e] hover:text-white hover:bg-[#1e1f22] transition"
                          title="Message"
                        >
                          <MessageSquare size={18} />
                        </button>
                        <button 
                          onClick={(e) => e.stopPropagation()}
                          className="w-9 h-9 rounded-full bg-[#111214] flex items-center justify-center text-[#80848e] hover:text-white hover:bg-[#1e1f22] transition"
                          title="More"
                        >
                          <MoreVertical size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Right Panel: Active Now */}
        <div className="w-85 border-l border-[#18191c] p-4 hidden xl:flex flex-col select-none overflow-y-auto discord-scrollbar">
          <h3 className="text-xl font-extrabold text-white mb-4">Active Now</h3>
          <div className="text-xs text-[#80848e]">
            When your friends are active (in voice or playing), they will appear right here.
          </div>
        </div>
      </div>
    </div>
  );
}
