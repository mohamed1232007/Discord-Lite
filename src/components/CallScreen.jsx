import { useRef, useEffect, useState } from 'react';
import {
  PhoneOff,
  Mic, MicOff,
  Video, VideoOff,
  Monitor,
  Smile,
  Sparkles,
  Maximize2,
  Volume2,
  ChevronDown,
  MessageSquare,
  UserPlus,
  VolumeX,
  Headphones
} from 'lucide-react';
import { useVoice } from '../context/VoiceContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';

export default function CallScreen() {
  const {
    activeCall,
    callParticipants,
    remoteStreams,
    remoteAudioElementsRef,
    callStatus,      // 'calling' | 'connected'
    isMuted,
    isDeafened,
    isVideoEnabled,
    isScreenSharing,
    isRemoteScreenSharing,
    isRemoteCamera,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    remoteStreamRef,
    localStreamRef,
    screenStreamRef,
    endCall,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    isNoiseSuppressionEnabled,
    isNoiseSuppressionActive,
    toggleNoiseSuppression,
    microphones,
    speakers,
    selectedMic,
    selectedSpeaker,
    changeMicrophone,
    changeSpeaker,
    inviteParticipants,
  } = useVoice();

  const { user: currentUser, token } = useAuth();
  const toast = useToast();
  const containerRef = useRef(null);
  const startTimeRef = useRef(0);
  const [callDuration, setCallDuration] = useState(0);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showSpeakerMenu, setShowSpeakerMenu] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friends, setFriends] = useState([]);
  const [selectedInviteIds, setSelectedInviteIds] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(false);

  const micMenuRef = useRef(null);
  const speakerMenuRef = useRef(null);

  // إغلاق قوائم اختيار الأجهزة عند الضغط خارجها
  useEffect(() => {
    const handleClickOutside = (e) => {
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
  
  // توصيل البث المحلي (كاميرا أو شير سكرين)
  useEffect(() => {
    if (localVideoRef.current) {
      if (isScreenSharing && screenStreamRef.current) {
        localVideoRef.current.srcObject = screenStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      } else if (isVideoEnabled && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      }
    }
  }, [isScreenSharing, isVideoEnabled, localVideoRef, screenStreamRef, localStreamRef]);

  // توصيل البث الوارد تلقائياً
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [callStatus, isRemoteScreenSharing, isRemoteCamera, remoteVideoRef, remoteStreamRef]);

  useEffect(() => {
    remoteStreams.forEach(({ userId, stream }) => {
      const element = remoteAudioElementsRef.current.get(userId);
      if (!element) return;
      if (element.srcObject !== stream) element.srcObject = stream;
      element.muted = isDeafened;
      element.volume = isDeafened ? 0 : 1;
      if (typeof element.setSinkId === 'function') {
        element.setSinkId(selectedSpeaker === 'default' ? '' : selectedSpeaker)
          .catch((error) => console.warn('[Audio] Could not set output device:', error));
      }
      element.play().catch((error) => console.warn('[Audio] play blocked:', error));
    });
  }, [remoteStreams, isDeafened, remoteAudioElementsRef, selectedSpeaker]);

  // عداد مدة المكالمة
  useEffect(() => {
    if (callStatus !== 'connected') {
      return;
    }
    startTimeRef.current = Date.now();
    const t = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => {
      clearInterval(t);
      setCallDuration(0);
    };
  }, [callStatus]);

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  if (!activeCall) return null;

  const isConnected = callStatus === 'connected';
  const isCalling   = callStatus === 'calling';

  const friendName = activeCall.friend?.display_name || activeCall.friend?.username || 'Friend';
  const myName     = currentUser?.display_name || currentUser?.username || 'Me';
  const myUser     = currentUser?.username || 'me';

  const showRemoteCamera   = (isRemoteCamera || activeCall.isVideo) && isConnected;
  const showLocalCamera    = isVideoEnabled;
  const isVideoCallActive  = showRemoteCamera || showLocalCamera;
  const activeParticipantIds = new Set(callParticipants
    .filter((participant) => ['active', 'invited'].includes(participant.status))
    .map((participant) => participant.user_id));
  const inviteableFriends = friends.filter((friend) => !activeParticipantIds.has(friend.id));
  const selectedFriends = friends.filter((friend) => selectedInviteIds.includes(friend.id));

  const openInviteModal = async () => {
    setSelectedInviteIds([]);
    setShowInviteModal(true);
    if (!token) {
      toast.error('You need to sign in to invite friends.');
      return;
    }

    setLoadingFriends(true);
    try {
      const response = await fetch(`${BACKEND_URL}/friends`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Friends request failed (${response.status}).`);
      const data = await response.json();
      setFriends(data.friends || []);
    } catch (error) {
      console.error('[CallScreen] Failed to load friends for invite:', error);
      toast.error('Could not load your friends.');
    } finally {
      setLoadingFriends(false);
    }
  };

  const handleInvite = async () => {
    await inviteParticipants(selectedFriends);
    setShowInviteModal(false);
    setSelectedInviteIds([]);
  };

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-[#000000] h-full overflow-hidden select-none relative font-sans">

      {/* REMOTE AUDIO */}
      <div className="hidden" aria-hidden="true">
        {remoteStreams.map(({ userId }) => (
          <audio
            key={userId}
            autoPlay
            playsInline
            ref={(element) => {
              if (element) {
                remoteAudioElementsRef.current.set(userId, element);
                if (!remoteAudioRef.current) remoteAudioRef.current = element;
              } else {
                const removedElement = remoteAudioElementsRef.current.get(userId);
                remoteAudioElementsRef.current.delete(userId);
                if (remoteAudioRef.current === removedElement) {
                  remoteAudioRef.current = remoteAudioElementsRef.current.values().next().value || null;
                }
              }
            }}
          />
        ))}
      </div>

      {/* HEADER */}
      <div className="h-12 border-b border-[#18191c] px-4 flex items-center justify-between shrink-0 bg-[#000000] z-20">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Volume2 size={18} className="text-[#80848e]" />
          <span>Voice Call</span>
          <span className="text-xs font-normal text-[#949ba4]">
            {callParticipants.filter((participant) => participant.status === 'active').length} participants
          </span>
          {isConnected && (
            <span className="text-xs text-[#23a55a] font-normal ml-2">● {fmt(callDuration)}</span>
          )}
          {isCalling && (
            <span className="text-xs text-[#f0b132] font-normal ml-2 animate-pulse">● Ringing...</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[#80848e]">
          <button type="button" className="hover:text-white p-1 rounded hover:bg-[#1e1f22] transition" title="Chat">
            <MessageSquare size={18} />
          </button>
        </div>
      </div>

      {/* VIDEO / AVATAR AREA */}
      <div className="flex-1 p-4 flex items-center justify-center overflow-hidden relative">

        {/* حالة 1: الشير سكرين شغال من أحد الطرفين (Hero Stage + Picture-in-Picture) */}
        {isRemoteScreenSharing || isScreenSharing ? (
          <div className="relative w-full h-full flex items-center justify-center bg-[#050506] rounded-2xl overflow-hidden border border-[#1e1f22]/80 shadow-2xl">
            {/* الشاشة المعروضة الأساسية (Main Stage Video) */}
            {isRemoteScreenSharing ? (
              <div className="w-full h-full relative flex items-center justify-center">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
                {/* شارة الشير سكرين للطرف الثاني */}
                <div className="absolute top-4 left-4 bg-[#5865f2] text-white text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow-lg z-10 backdrop-blur-sm">
                  <Monitor size={15} />
                  <span>{friendName} is sharing their screen</span>
                </div>
              </div>
            ) : (
              <div className="w-full h-full relative flex items-center justify-center">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
                {/* شارة الشير سكرين الخاصة بك */}
                <div className="absolute top-4 left-4 bg-[#23a55a] text-white text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow-lg z-10 backdrop-blur-sm">
                  <Monitor size={15} />
                  <span>You are sharing your screen</span>
                  <button
                    type="button"
                    onClick={toggleScreenShare}
                    className="ml-2 bg-black/40 hover:bg-black/60 px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer"
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}

            {/* كارت الـ PIP الصغير في الزاوية للطرف الآخر */}
            <div className="absolute bottom-4 right-4 w-52 h-36 bg-[#111214]/95 border border-[#2b2d31] rounded-xl shadow-2xl overflow-hidden z-20 flex items-center justify-center backdrop-blur-md transition-all hover:scale-105">
              {isRemoteScreenSharing ? (
                // أنت في الـ PIP لأن الطرف الثاني هو اللي فاتح شير
                <div className="w-full h-full relative flex items-center justify-center">
                  {isVideoEnabled ? (
                    <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-[#1e1f22] border-2 border-[#2b2d31] flex items-center justify-center text-white font-bold text-sm">
                        {currentUser?.avatar_url ? (
                          <img src={currentUser.avatar_url} alt={myName} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          myName.substring(0, 2).toUpperCase()
                        )}
                      </div>
                      <span className="text-white text-xs font-medium mt-1.5">{myName} (You)</span>
                    </div>
                  )}
                  {isMuted && (
                    <span className="absolute bottom-2 right-2 text-xs bg-black/80 px-1.5 py-0.5 rounded">🔇</span>
                  )}
                </div>
              ) : (
                // صديقك في الـ PIP لأنك أنت اللي فاتح شير
                <div className="w-full h-full relative flex items-center justify-center">
                  {showRemoteCamera && !isRemoteScreenSharing ? (
                    <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className={`w-12 h-12 rounded-full bg-[#1e1f22] border-2 flex items-center justify-center text-white font-bold text-sm ${
                        isConnected ? 'border-[#23a55a]' : 'border-[#f0b132]'
                      }`}>
                        {activeCall.friend?.avatar_url ? (
                          <img src={activeCall.friend.avatar_url} alt={friendName} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          friendName.substring(0, 2).toUpperCase()
                        )}
                      </div>
                      <span className="text-white text-xs font-medium mt-1.5">{friendName}</span>
                    </div>
                  )}
                  {isDeafened && (
                    <span className="absolute bottom-2 right-2 text-xs bg-black/80 px-1.5 py-0.5 rounded">🔇</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : isVideoCallActive ? (
          /* حالة 2: مكالمة فيديو عادية بالكاميرا بدون شير سكرين (Side-by-Side Video Grid) */
          <div className="grid grid-cols-2 gap-4 w-full h-full max-w-5xl items-center justify-center">
            {/* Friend Video Card */}
            <div className="relative w-full h-full max-h-[500px] bg-[#08080a] border border-[#1e1f22] rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl">
              <video ref={remoteVideoRef} autoPlay playsInline className={`w-full h-full object-cover ${showRemoteCamera ? 'block' : 'hidden'}`} />
              {!showRemoteCamera && (
                <div className="flex flex-col items-center gap-3">
                  <div className={`w-24 h-24 rounded-full bg-[#18191c] border-4 flex items-center justify-center text-white text-2xl font-bold shadow-xl ${
                    isConnected ? 'border-[#23a55a]' : 'border-[#f0b132]'
                  }`}>
                    {activeCall.friend?.avatar_url ? (
                      <img src={activeCall.friend.avatar_url} alt={friendName} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      friendName.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  <span className="text-white font-semibold text-sm">{friendName}</span>
                </div>
              )}
              <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md font-medium border border-[#1e1f22]">
                {friendName}
              </div>
            </div>

            {/* Local Video Card */}
            <div className="relative w-full h-full max-h-[500px] bg-[#08080a] border border-[#1e1f22] rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl">
              <video ref={localVideoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${showLocalCamera ? 'block' : 'hidden'}`} />
              {!showLocalCamera && (
                <div className="flex flex-col items-center gap-3">
                  <div className={`w-24 h-24 rounded-full bg-[#18191c] border-4 flex items-center justify-center text-white text-2xl font-bold shadow-xl ${
                    isMuted ? 'border-[#f23f43]' : 'border-[#23a55a]'
                  }`}>
                    {currentUser?.avatar_url ? (
                      <img src={currentUser.avatar_url} alt={myName} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      myName.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  <span className="text-white font-semibold text-sm">{myName}</span>
                </div>
              )}
              <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md font-medium border border-[#1e1f22]">
                {myName} (You)
              </div>
            </div>
          </div>
        ) : (
          /* حالة 3: مكالمة صوتية نقية (Pure Voice Call - Classic Discord Stage) */
          <>
            {/* عناصر الفيديو متصلة في الخلفية لكن مخفية تماماً بدون التأثير على الواجهة */}
            <div className="hidden" aria-hidden="true">
              <video ref={remoteVideoRef} autoPlay playsInline />
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-5 w-full max-w-5xl">
              {callParticipants.filter((participant) => participant.status === 'active').map((participant) => {
                const isLocal = participant.user_id === currentUser?.id;
                const participantUser = participant.user || {};
                const participantName = isLocal
                  ? myName
                  : participantUser.display_name || participantUser.username || 'Friend';
                const participantUsername = isLocal
                  ? myUser
                  : participantUser.username || 'user';
                const muted = isLocal && isMuted;
                const noiseActive = isLocal
                  ? isNoiseSuppressionActive
                  : participant.noise_suppression_enabled;

                return (
                  <div key={participant.user_id} className="w-64 min-h-72 bg-[#111214] border border-[#1e1f22] rounded-2xl flex flex-col items-center justify-center p-6 shadow-2xl relative transition-all hover:border-[#2b2d31]">
                    <div className={`w-28 h-28 rounded-full bg-[#1e1f22] border-4 flex items-center justify-center text-white text-3xl font-bold shadow-xl ${
                      muted ? 'border-[#f23f43]' : 'border-[#23a55a] ring-4 ring-[#23a55a]/20'
                    }`}>
                      {participantUser.avatar_url ? (
                        <img src={participantUser.avatar_url} alt={participantName} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        participantName.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="mt-4 text-center">
                      <div className="text-white font-bold text-base truncate max-w-[200px]">
                        {participantName}{isLocal ? ' (You)' : ''}
                      </div>
                      <div className="text-[#80848e] text-xs mt-0.5 truncate max-w-[200px]">@{participantUsername}</div>
                      <div className={`text-xs mt-2.5 font-medium ${muted ? 'text-[#f23f43]' : 'text-[#23a55a]'}`}>
                        {muted ? 'Muted' : 'Connected'}
                      </div>
                      <div className={`text-[10px] mt-2 ${noiseActive ? 'text-[#23a55a]' : 'text-[#80848e]'}`}>
                        {noiseActive ? 'AI noise suppression active' : 'Built-in noise suppression requested'}
                      </div>
                    </div>
                    {isDeafened && !isLocal && (
                      <span className="absolute bottom-3 right-3 text-xs bg-black/80 px-2 py-1 rounded-md border border-[#1e1f22]">🔇 Deafened</span>
                    )}
                    {muted && (
                      <span className="absolute bottom-3 right-3 text-xs bg-black/80 px-2 py-1 rounded-md border border-[#1e1f22] text-[#f23f43]">🔇 Muted</span>
                    )}
                  </div>
                );
              })}
            </div>
            {callParticipants.some((participant) => participant.status === 'invited') && (
              <p className="absolute bottom-3 text-xs text-[#f0b132]">
                Inviting: {callParticipants
                  .filter((participant) => participant.status === 'invited')
                  .map((participant) => participant.user?.display_name || participant.user?.username || 'Friend')
                  .join(', ')}
              </p>
            )}
        </>
        )}
      </div>

      {/* CONTROLS BAR */}
      <div className="h-20 flex items-center justify-between px-6 shrink-0 border-t border-[#18191c]/40 relative bg-[#000000] z-20">

        {/* Left: Invite */}
        <div className="flex items-center">
          <button type="button"
            onClick={openInviteModal}
            className="text-[#80848e] hover:text-white p-2 hover:bg-[#111214] rounded-lg transition cursor-pointer"
            title="Invite friends"
          >
            <UserPlus size={20} />
          </button>
        </div>

        {/* Center: Controls */}
        <div className="flex items-center gap-2 bg-[#111214] border border-[#1e1f22] px-3 py-2 rounded-xl shadow-2xl">

          {/* MUTE with Device Selector Chevron */}
          <div ref={micMenuRef} className="relative flex items-center bg-[#1e1f22] rounded-lg">
            <button type="button" onClick={toggleMute}
              className={`p-2.5 transition flex items-center justify-center cursor-pointer rounded-l-lg ${
                isMuted ? 'text-[#f23f43] bg-[#f23f43]/20 hover:bg-[#f23f43]/30' : 'text-white hover:bg-[#2b2d31]'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button 
              type="button" 
              onClick={() => {
                setShowMicMenu(prev => !prev);
                setShowSpeakerMenu(false);
              }}
              className={`px-1.5 py-2.5 text-[#80848e] hover:text-white hover:bg-[#2b2d31] transition cursor-pointer rounded-r-lg ${
                showMicMenu ? 'bg-[#2b2d31] text-white' : ''
              }`}
              title="Select Input Device (Microphone)"
            >
              <ChevronDown size={14} />
            </button>

            {/* Microphone Selection Popup Menu */}
            {showMicMenu && (
              <div className="absolute bottom-12 left-0 w-64 bg-[#111214] border border-[#2b2d31] rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
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
                            isSelected ? 'bg-[#5865f2] text-white font-medium' : 'text-[#dbdee1] hover:bg-[#1e1f22] hover:text-white'
                          }`}
                        >
                          <span className="truncate">{mic.label}</span>
                          {isSelected && <span className="text-xs shrink-0">✓</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* DEAFEN with Speaker Device Selector Chevron */}
          <div ref={speakerMenuRef} className="relative flex items-center bg-[#1e1f22] rounded-lg">
            <button type="button" onClick={toggleDeafen}
              className={`p-2.5 rounded-l-lg transition cursor-pointer ${
                isDeafened ? 'text-[#f23f43] bg-[#f23f43]/20 hover:bg-[#f23f43]/30' : 'text-[#dbdee1] hover:text-white hover:bg-[#2b2d31]'
              }`}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isDeafened ? <VolumeX size={20} /> : <Headphones size={20} />}
            </button>
            <button 
              type="button" 
              onClick={() => {
                setShowSpeakerMenu(prev => !prev);
                setShowMicMenu(false);
              }}
              className={`px-1.5 py-2.5 text-[#80848e] hover:text-white hover:bg-[#2b2d31] transition cursor-pointer rounded-r-lg ${
                showSpeakerMenu ? 'bg-[#2b2d31] text-white' : ''
              }`}
              title="Select Output Device (Speaker / Headphone)"
            >
              <ChevronDown size={14} />
            </button>

            {/* Speaker Selection Popup Menu */}
            {showSpeakerMenu && (
              <div className="absolute bottom-12 left-0 w-64 bg-[#111214] border border-[#2b2d31] rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
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
                            isSelected ? 'bg-[#5865f2] text-white font-medium' : 'text-[#dbdee1] hover:bg-[#1e1f22] hover:text-white'
                          }`}
                        >
                          <span className="truncate">{spk.label}</span>
                          {isSelected && <span className="text-xs shrink-0">✓</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* CAMERA */}
          <div className="flex items-center bg-[#1e1f22] rounded-lg overflow-hidden">
            <button type="button" onClick={toggleCamera}
              className={`p-2.5 transition flex items-center justify-center cursor-pointer ${
                isVideoEnabled ? 'text-[#23a55a] bg-[#23a55a]/20 hover:bg-[#23a55a]/30' : 'text-white hover:bg-[#2b2d31]'
              }`}
              title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
            >
              {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
            <button type="button" onClick={toggleCamera}
              className="px-1 py-2.5 text-[#80848e] hover:text-white hover:bg-[#2b2d31] transition cursor-pointer">
              <ChevronDown size={14} />
            </button>
          </div>

          {/* SCREEN SHARE */}
          <button type="button" onClick={toggleScreenShare}
            className={`p-2.5 rounded-lg transition cursor-pointer ${
              isScreenSharing ? 'text-[#23a55a] bg-[#23a55a]/20 hover:bg-[#23a55a]/30' : 'text-[#dbdee1] hover:text-white hover:bg-[#1e1f22]'
            }`}
            title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
          >
            <Monitor size={20} />
          </button>

          {/* NOISE SUPPRESSION (RNNoise) */}
          <button type="button" onClick={toggleNoiseSuppression}
            className={`p-2.5 rounded-lg transition cursor-pointer ${
              isNoiseSuppressionEnabled ? 'text-[#23a55a] bg-[#23a55a]/20 hover:bg-[#23a55a]/30' : 'text-[#80848e] hover:text-white hover:bg-[#1e1f22]'
            }`}
            title={isNoiseSuppressionActive
              ? 'AI Noise Suppression is processing your microphone'
              : isNoiseSuppressionEnabled
                ? 'AI Noise Suppression is enabled but not currently processing'
                : 'AI Noise Suppression: Off'}
          >
            <Sparkles size={20} />
          </button>

          {/* SOUNDBOARD */}
          <div className="relative">
            <button type="button" onClick={() => setShowSoundboard(v => !v)}
              className={`p-2.5 rounded-lg transition cursor-pointer ${
                showSoundboard ? 'bg-[#5865f2] text-white' : 'text-[#dbdee1] hover:text-white hover:bg-[#1e1f22]'
              }`} title="Soundboard"
            >
              <Smile size={20} />
            </button>
            {showSoundboard && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-[#111214] border border-[#2b2d31] p-3 rounded-xl shadow-2xl flex gap-2 z-50 whitespace-nowrap">
                {[
                  { label: '🔔 Beep', freq: 600,  dur: 0.2,  type: 'sine'     },
                  { label: '🎺 Horn', freq: 440,  dur: 0.3,  type: 'triangle' },
                  { label: '🔔 Ding', freq: 880,  dur: 0.15, type: 'sine'     }
                ].map(s => (
                  <button key={s.label} type="button"
                    onClick={() => {
                      const ctx = new AudioContext();
                      const osc = ctx.createOscillator();
                      osc.type = s.type; osc.frequency.value = s.freq;
                      osc.connect(ctx.destination);
                      osc.start(); osc.stop(ctx.currentTime + s.dur);
                    }}
                    className="px-3 py-2 bg-[#1e1f22] hover:bg-[#5865f2] text-xs font-semibold rounded-lg text-white transition cursor-pointer"
                  >{s.label}</button>
                ))}
                <button type="button" onClick={() => setShowSoundboard(false)}
                  className="px-2 py-2 bg-[#1e1f22] hover:bg-[#f23f43] text-xs rounded-lg text-[#80848e] hover:text-white transition cursor-pointer">✕</button>
              </div>
            )}
          </div>

          {/* END CALL */}
          <button type="button"
            onClick={() => endCall(true)}
            className="w-12 h-10 bg-[#f23f43] hover:bg-[#c93034] text-white flex items-center justify-center rounded-xl shadow-lg transition cursor-pointer ml-1"
            title="End Call"
          >
            <PhoneOff size={20} />
          </button>
        </div>

        {/* Right: Fullscreen */}
        <div className="flex items-center">
          <button type="button" onClick={toggleFullscreen}
            className="text-[#80848e] hover:text-white p-2 hover:bg-[#111214] rounded-lg transition cursor-pointer"
            title="Fullscreen"
          >
            <Maximize2 size={20} />
          </button>
        </div>
        {showInviteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-xl border border-[#2b2d31] bg-[#111214] p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Invite friends to call</h2>
                  <p className="mt-1 text-xs text-[#949ba4]">Choose one or more friends to add to this voice room.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded p-1 text-[#949ba4] hover:bg-[#2b2d31] hover:text-white"
                  aria-label="Close invite dialog"
                >
                  ×
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto discord-scrollbar">
                {loadingFriends ? (
                  <p className="py-6 text-center text-sm text-[#949ba4]">Loading friends...</p>
                ) : inviteableFriends.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[#949ba4]">No friends available to invite.</p>
                ) : inviteableFriends.map((friend) => {
                  const isSelected = selectedInviteIds.includes(friend.id);
                  const displayName = friend.display_name || friend.username || 'Friend';
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => setSelectedInviteIds((previous) => (
                        isSelected
                          ? previous.filter((id) => id !== friend.id)
                          : [...previous, friend.id]
                      ))}
                      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                        isSelected ? 'bg-[#5865f2]/25 text-white' : 'text-[#dbdee1] hover:bg-[#1e1f22]'
                      }`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#2b2d31] text-xs font-bold">
                        {friend.avatar_url
                          ? <img src={friend.avatar_url} alt="" className="h-full w-full object-cover" />
                          : displayName.substring(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{displayName}</span>
                        <span className="block truncate text-xs text-[#949ba4]">@{friend.username || 'user'}</span>
                      </span>
                      <span className="text-sm">{isSelected ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-lg px-3 py-2 text-sm text-[#dbdee1] hover:bg-[#2b2d31]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={selectedInviteIds.length === 0}
                  className="rounded-lg bg-[#5865f2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Invite ({selectedInviteIds.length})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
