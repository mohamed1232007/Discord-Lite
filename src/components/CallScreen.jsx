import React, { useRef, useEffect, useState } from 'react';
import {
  PhoneOff,
  Mic, MicOff,
  Video, VideoOff,
  Monitor,
  Smile,
  Sparkles,
  Maximize2,
  Minimize2,
  Volume2,
  ChevronDown,
  MessageSquare,
  UserPlus,
  VolumeX,
  Headphones,
  Phone,
  Expand
} from 'lucide-react';
import { useVoice } from '../context/VoiceContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function CallScreen() {
  const {
    activeCall,
    callStatus,      // 'calling' | 'connected'
    isMuted,
    isDeafened,
    isVideoEnabled,
    isScreenSharing,
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
    microphones,
    speakers,
    selectedMic,
    selectedSpeaker,
    changeMicrophone,
    changeSpeaker,
  } = useVoice();

  const { user: currentUser } = useAuth();
  const toast = useToast();
  const containerRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const [callDuration, setCallDuration] = useState(0);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showSpeakerMenu, setShowSpeakerMenu] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

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
  
  // خاصية تكبير الشير سكرين: 'remote' | 'local' | null
  const [focusedVideo, setFocusedVideo] = useState(null);

  // 1. مراقبة وصول فيديو من الطرف الآخر تلقائياً
  useEffect(() => {
    const checkRemoteVideo = () => {
      if (remoteStreamRef?.current) {
        const vTracks = remoteStreamRef.current.getVideoTracks();
        // نعتبر الفيديو حقيقي فقط إذا كان شغالاً وليس المسار الخامل (canvas blank)
        const hasLiveVideo = vTracks.some(t => {
          if (!t.enabled || t.readyState !== 'live') return false;
          // المسارات الخاملة تكون بدون settings أو حجمها 640x360 مع mute
          return !t.muted;
        });
        setHasRemoteVideo(hasLiveVideo || !!activeCall?.isVideo);
      } else {
        setHasRemoteVideo(false);
      }
    };

    checkRemoteVideo();
    const interval = setInterval(checkRemoteVideo, 1000);
    return () => clearInterval(interval);
  }, [remoteStreamRef?.current, activeCall]);

  // 2. توصيل البث المحلي (كاميرا أو شير سكرين)
  useEffect(() => {
    if (localVideoRef.current) {
      if (isScreenSharing && screenStreamRef?.current) {
        localVideoRef.current.srcObject = screenStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      } else if (isVideoEnabled && localStreamRef?.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      }
    }
  }, [isScreenSharing, isVideoEnabled, screenStreamRef?.current, localStreamRef?.current]);

  // 3. توصيل البث الوارد تلقائياً
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef?.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStreamRef?.current, callStatus, hasRemoteVideo]);

  // عداد مدة المكالمة
  useEffect(() => {
    if (callStatus !== 'connected') { setCallDuration(0); return; }
    startTimeRef.current = Date.now();
    const t = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
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

  const isConnected   = callStatus === 'connected';
  const isCalling     = callStatus === 'calling';

  const friendName = activeCall.friend?.display_name || activeCall.friend?.username || 'Friend';
  const friendUser = activeCall.friend?.username || 'user';
  const myName     = currentUser?.display_name || currentUser?.username || 'Me';
  const myUser     = currentUser?.username || 'me';

  const showLocalVideo  = isVideoEnabled || isScreenSharing;
  const showRemoteVideo = (hasRemoteVideo || activeCall.isVideo) && isConnected;

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-[#000000] h-full overflow-hidden select-none relative font-sans">

      {/* REMOTE AUDIO */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ position: 'fixed', width: 0, height: 0, opacity: 0, zIndex: -1 }}
      />

      {/* HEADER */}
      <div className="h-12 border-b border-[#18191c] px-4 flex items-center justify-between shrink-0 bg-[#000000] z-20">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Volume2 size={18} className="text-[#80848e]" />
          <span>Voice Call</span>
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
      <div className="flex-1 p-3 flex flex-col gap-3 justify-center items-center overflow-hidden relative">

        {/* 1. كارد الطرف الثاني (Friend Card) */}
        <div className={`relative bg-[#08080a] border border-[#1e1f22]/60 rounded-xl flex items-center justify-center overflow-hidden shadow-2xl transition-all duration-300 group ${
          focusedVideo === 'remote' 
            ? 'absolute inset-3 z-30 h-auto' 
            : focusedVideo === 'local' 
              ? 'hidden' 
              : 'w-full max-w-4xl h-[48%]'
        }`}>
          {/* Remote Video Element */}
          <video
            ref={remoteVideoRef}
            autoPlay playsInline
            className={`w-full h-full object-contain bg-black ${showRemoteVideo ? 'block' : 'hidden'}`}
          />

          {/* الأفاتار — يظهر لو مفيش فيديو شغال */}
          {!showRemoteVideo && (
            <div className="flex flex-col items-center gap-4">
              <div className={`w-24 h-24 rounded-full bg-[#18191c] border-4 flex items-center justify-center text-white text-3xl font-bold shadow-2xl ${
                isConnected ? 'border-[#23a55a]' : 'border-[#f0b132]'
              } ${isCalling ? 'animate-pulse' : ''}`}>
                {activeCall.friend?.avatar_url
                  ? <img src={activeCall.friend.avatar_url} alt={friendName} className="w-full h-full rounded-full object-cover" />
                  : friendName.substring(0, 2).toUpperCase()}
              </div>
              {/* حالة الكول */}
              {isCalling && (
                <div className="flex items-center gap-2 text-[#f0b132] text-sm font-medium">
                  <Phone size={14} className="animate-bounce" />
                  <span>Calling {friendName}...</span>
                </div>
              )}
              {isConnected && (
                <div className="flex items-center gap-2 text-[#23a55a] text-sm font-medium">
                  <span>Connected</span>
                </div>
              )}
            </div>
          )}

          {/* زر تكبير/تصغير الشاشة في الجانب */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
            <button
              type="button"
              onClick={() => setFocusedVideo(focusedVideo === 'remote' ? null : 'remote')}
              className="p-2 bg-[#111214]/80 hover:bg-[#2b2d31] text-white rounded-lg shadow-lg border border-[#1e1f22] backdrop-blur-sm transition cursor-pointer"
              title={focusedVideo === 'remote' ? 'Restore View' : 'Maximize Screen'}
            >
              {focusedVideo === 'remote' ? <Minimize2 size={16} /> : <Expand size={16} />}
            </button>
          </div>

          {/* User Badge */}
          <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-md font-medium border border-[#1e1f22] flex items-center gap-2 z-10">
            <span>{friendName}</span>
            <span className="text-[#80848e] text-[10px]">(@{friendUser})</span>
            {isDeafened && <span className="text-[#f23f43] text-[10px] font-bold">🔇</span>}
          </div>
        </div>

        {/* 2. كارد حسابك وشاشتك (Local Card) */}
        <div className={`relative bg-[#08080a] border border-[#1e1f22]/60 rounded-xl flex items-center justify-center overflow-hidden shadow-2xl transition-all duration-300 group ${
          focusedVideo === 'local' 
            ? 'absolute inset-3 z-30 h-auto' 
            : focusedVideo === 'remote' 
              ? 'hidden' 
              : 'w-full max-w-4xl h-[48%]'
        }`}>
          {/* Local Video Element */}
          <video
            ref={localVideoRef}
            autoPlay muted playsInline
            className={`w-full h-full ${isScreenSharing ? 'object-contain bg-black' : 'object-cover'} ${showLocalVideo ? 'block' : 'hidden'}`}
          />

          {!showLocalVideo && (
            <div className={`w-24 h-24 rounded-full bg-[#111214] border-2 flex items-center justify-center text-white text-3xl font-bold shadow-2xl ${
              isMuted || isDeafened ? 'border-[#f23f43]' : 'border-[#1e1f22]'
            }`}>
              {currentUser?.avatar_url
                ? <img src={currentUser.avatar_url} alt={myName} className="w-full h-full rounded-full object-cover" />
                : myName.substring(0, 2).toUpperCase()}
            </div>
          )}

          {/* زر تكبير/تصغير الشير سكرين في الجانب (Maximize / Full Size Button) */}
          {showLocalVideo && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
              <button
                type="button"
                onClick={() => setFocusedVideo(focusedVideo === 'local' ? null : 'local')}
                className="p-2 bg-[#111214]/80 hover:bg-[#2b2d31] text-white rounded-lg shadow-lg border border-[#1e1f22] backdrop-blur-sm transition cursor-pointer"
                title={focusedVideo === 'local' ? 'Restore View' : 'Maximize Screen Share'}
              >
                {focusedVideo === 'local' ? <Minimize2 size={16} /> : <Expand size={16} />}
              </button>
            </div>
          )}

          {/* Screen Share Tag */}
          {isScreenSharing && (
            <div className="absolute top-3 left-3 bg-[#23a55a]/90 text-white text-[11px] px-2.5 py-1 rounded font-bold flex items-center gap-1.5 shadow-md z-10">
              <Monitor size={13} />
              <span>You are sharing your screen</span>
            </div>
          )}

          {/* User Badge */}
          <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-md font-medium border border-[#1e1f22] flex items-center gap-2 z-10">
            <span>{myName}</span>
            <span className="text-[#80848e] text-[10px]">(@{myUser})</span>
            {isMuted    && <span className="text-[#f23f43] text-[10px] font-bold">🔇 Muted</span>}
            {isDeafened && !isMuted && <span className="text-[#f23f43] text-[10px] font-bold">🎧 Deafened</span>}
          </div>
        </div>
      </div>

      {/* CONTROLS BAR */}
      <div className="h-20 flex items-center justify-between px-6 shrink-0 border-t border-[#18191c]/40 relative bg-[#000000] z-20">

        {/* Left: Invite */}
        <div className="flex items-center">
          <button type="button"
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
              }
              toast.success('Call link copied to clipboard!');
            }}
            className="text-[#80848e] hover:text-white p-2 hover:bg-[#111214] rounded-lg transition cursor-pointer"
            title="Invite"
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
      </div>
    </div>
  );
}
