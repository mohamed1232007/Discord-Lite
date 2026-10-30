import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PhoneOff,
  Mic, MicOff,
  Video, VideoOff,
  Monitor,
  Sparkles,
  Maximize2,
  Volume2,
  ChevronDown,
  MessageSquare,
  UserPlus,
  VolumeX,
  Headphones,
  MoreHorizontal
} from 'lucide-react';
import { useVoice } from '../context/VoiceContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';

export default function CallScreen({ onOpenChat }) {
  const {
    activeCall,
    callParticipants,
    remoteCallStates,
    remoteStreams,
    remoteAudioElementsRef,
    remoteScreenAudioElementsRef,
    participantAudioSettings,
    streamAudioSettings,
    setParticipantVolume,
    setParticipantMuted,
    setStreamVolume,
    setStreamMuted,
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
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showSpeakerMenu, setShowSpeakerMenu] = useState(false);
  const [showStreamAudioMenu, setShowStreamAudioMenu] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [openParticipantMenuId, setOpenParticipantMenuId] = useState(null);
  const [participantMenuPosition, setParticipantMenuPosition] = useState(null);
  const [friends, setFriends] = useState([]);
  const [selectedInviteIds, setSelectedInviteIds] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(false);

  const micMenuRef = useRef(null);
  const speakerMenuRef = useRef(null);
  const participantMenuRef = useRef(null);
  const participantMenuButtonsRef = useRef(new Map());

  // إغلاق قوائم اختيار الأجهزة عند الضغط خارجها
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (micMenuRef.current && !micMenuRef.current.contains(e.target)) {
        setShowMicMenu(false);
      }
      if (speakerMenuRef.current && !speakerMenuRef.current.contains(e.target)) {
        setShowSpeakerMenu(false);
      }
      const activeMenuButton = participantMenuButtonsRef.current.get(openParticipantMenuId);
      if (
        participantMenuRef.current
        && !participantMenuRef.current.contains(e.target)
        && !activeMenuButton?.contains(e.target)
      ) {
        setOpenParticipantMenuId(null);
        setParticipantMenuPosition(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openParticipantMenuId]);

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
      const participantSettings = participantAudioSettings[userId];
      const streamSettings = streamAudioSettings[userId];
      const [voiceTrack, screenAudioTrack] = stream.getAudioTracks();
      const audioElements = [
        {
          element: remoteAudioElementsRef.current.get(userId),
          track: voiceTrack,
          settings: participantSettings,
        },
        {
          element: remoteScreenAudioElementsRef.current.get(userId),
          track: screenAudioTrack,
          settings: streamSettings,
        },
      ];

      audioElements.forEach(({ element, track, settings }) => {
        if (!element) return;
        const audioStream = track ? new MediaStream([track]) : null;
        if (element.srcObject?.getAudioTracks?.()[0]?.id !== track?.id) {
          element.srcObject = audioStream;
        }
        element.muted = isDeafened || settings?.muted === true;
        element.volume = element.muted ? 0 : settings?.volume ?? 1;
        if (typeof element.setSinkId === 'function') {
          element.setSinkId(selectedSpeaker === 'default' ? '' : selectedSpeaker)
            .catch((error) => console.warn('[Audio] Could not set output device:', error));
        }
        if (track) {
          element.play().catch((error) => console.warn('[Audio] play blocked:', error));
        }
      });
    });
  }, [
    remoteStreams,
    isDeafened,
    remoteAudioElementsRef,
    remoteScreenAudioElementsRef,
    selectedSpeaker,
    participantAudioSettings,
    streamAudioSettings,
  ]);

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

  const activeParticipants = callParticipants.filter((participant) => participant.status === 'active');
  const remoteScreenParticipant = activeParticipants.find((participant) => (
    participant.user_id !== currentUser?.id && remoteCallStates[participant.user_id]?.screen
  ));
  const remoteScreenAudioSettings = remoteScreenParticipant
    ? streamAudioSettings[remoteScreenParticipant.user_id] || {}
    : {};
  const remoteScreenAudioVolume = Number.isFinite(remoteScreenAudioSettings.volume)
    ? remoteScreenAudioSettings.volume
    : 1;
  const remoteCameraParticipants = activeParticipants.filter((participant) => (
    participant.user_id !== currentUser?.id && remoteCallStates[participant.user_id]?.camera
  ));
  const isRemoteSharingScreen = !!remoteScreenParticipant || isRemoteScreenSharing;
  const showRemoteCamera = remoteCameraParticipants.length > 0 || isRemoteCamera;
  const showLocalCamera    = isVideoEnabled;
  const isVideoCallActive  = !!activeCall.isVideo || showRemoteCamera || showLocalCamera;
  const getParticipantState = (participant) => {
    const isLocal = participant.user_id === currentUser?.id;
    const remoteState = remoteCallStates[participant.user_id];
    return {
      muted: isLocal ? isMuted : remoteState?.muted,
      deafened: isLocal ? isDeafened : remoteState?.deafened,
      camera: isLocal ? isVideoEnabled : remoteState?.camera,
      screen: isLocal ? isScreenSharing : remoteState?.screen,
      noiseSuppressionActive: isLocal
        ? isNoiseSuppressionActive
        : remoteState?.noiseSuppressionActive ?? participant.noise_suppression_enabled,
      synced: isLocal || !!remoteState?.synced,
    };
  };
  const activeParticipantIds = new Set(callParticipants
    .filter((participant) => ['active', 'invited'].includes(participant.status))
    .map((participant) => participant.user_id));
  const inviteableFriends = friends.filter((friend) => !activeParticipantIds.has(friend.id));
  const selectedFriends = friends.filter((friend) => selectedInviteIds.includes(friend.id));
  const setVideoStream = (element, stream) => {
    if (!element || !stream) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    element.play().catch((error) => console.warn('[Video] play blocked:', error));
  };
  const getRemoteStream = (participantId) => (
    remoteStreams.find((entry) => entry.userId === participantId)?.stream
  );
  const renderParticipantMenu = (participant, participantName) => {
    if (participant.user_id === currentUser?.id) return null;

    const settings = participantAudioSettings[participant.user_id] || {};
    const volume = Number.isFinite(settings.volume) ? settings.volume : 1;
    const isMutedForMe = settings.muted === true;
    const isOpen = openParticipantMenuId === participant.user_id;
    const menu = isOpen && participantMenuPosition
      ? createPortal(
        <div
          ref={participantMenuRef}
          className="fixed z-[100] w-64 rounded-xl border border-[#353740] bg-[#17181c] p-2.5 text-[#dbdee1] shadow-[0_12px_40px_rgba(0,0,0,0.65)]"
          style={{
            top: Math.max(8, participantMenuPosition.top - 205),
            right: Math.max(8, participantMenuPosition.right),
            maxHeight: 'min(320px, calc(100vh - 16px))',
            overflowY: 'auto',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="truncate px-2 pb-2 text-sm font-semibold text-white">{participantName}</div>
          <button
            type="button"
            onClick={() => {
              if (participant.user) onOpenChat?.(participant.user);
              setOpenParticipantMenuId(null);
              setParticipantMenuPosition(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[#272930]"
          >
            <MessageSquare size={16} />
            Message
          </button>
          <div className="my-2 border-t border-[#303239]" />
          <div className="flex items-center justify-between px-2 pt-1">
            <label
              htmlFor={`participant-volume-${participant.user_id}`}
              className="flex items-center gap-2 text-sm font-medium text-[#dbdee1]"
            >
              <Volume2 size={15} className="text-[#949ba4]" />
              User volume
            </label>
            <span className="rounded-md bg-[#2b2d31] px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
              {Math.round(volume * 100)}%
            </span>
          </div>
          <div className="px-2 pb-2 pt-3">
            <input
              id={`participant-volume-${participant.user_id}`}
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(volume * 100)}
              onChange={(event) => setParticipantVolume(participant.user_id, Number(event.target.value) / 100)}
              className="participant-volume-slider w-full cursor-pointer"
              style={{
                background: `linear-gradient(to right, #5865f2 0%, #5865f2 ${volume * 100}%, #3b3d44 ${volume * 100}%, #3b3d44 100%)`,
              }}
              aria-label={`${participantName} volume`}
            />
          </div>
          <label className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-[#272930]">
            <span>Mute</span>
            <input
              type="checkbox"
              checked={isMutedForMe}
              onChange={(event) => setParticipantMuted(participant.user_id, event.target.checked)}
              className="h-4 w-4 accent-[#5865f2]"
            />
          </label>
        </div>,
        document.body,
      )
      : null;

    return (
      <>
        <div className="absolute bottom-3 right-3 z-30" onClick={(event) => event.stopPropagation()}>
          <button
            ref={(element) => {
              if (element) participantMenuButtonsRef.current.set(participant.user_id, element);
              else participantMenuButtonsRef.current.delete(participant.user_id);
            }}
            type="button"
            onClick={(event) => {
              if (isOpen) {
                setOpenParticipantMenuId(null);
                setParticipantMenuPosition(null);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              setParticipantMenuPosition({
                top: rect.top,
                right: window.innerWidth - rect.right,
              });
              setOpenParticipantMenuId(participant.user_id);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/75 text-white shadow-lg transition hover:bg-[#2b2d31]"
            title={`Options for ${participantName}`}
            aria-label={`Options for ${participantName}`}
            aria-expanded={isOpen}
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
        {menu}
      </>
    );
  };

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
          <div key={userId}>
            <audio
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
            <audio
              autoPlay
              playsInline
              ref={(element) => {
                if (element) remoteScreenAudioElementsRef.current.set(userId, element);
                else remoteScreenAudioElementsRef.current.delete(userId);
              }}
            />
          </div>
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
          <button
            type="button"
            onClick={onOpenChat}
            className="hover:text-white p-1 rounded hover:bg-[#1e1f22] transition"
            title="Open chat"
            aria-label="Open chat"
          >
            <MessageSquare size={18} />
          </button>
        </div>
      </div>

      {/* VIDEO / AVATAR AREA */}
      <div className="flex-1 p-4 flex items-center justify-center overflow-hidden relative">

        {/* حالة 1: الشير سكرين شغال من أحد الطرفين (Hero Stage + Picture-in-Picture) */}
        {isRemoteSharingScreen || isScreenSharing ? (
          <div className="relative w-full h-full flex items-center justify-center bg-[#050506] rounded-2xl overflow-hidden border border-[#1e1f22]/80 shadow-2xl">
            {/* الشاشة المعروضة الأساسية (Main Stage Video) */}
            {isRemoteSharingScreen ? (
              <div className="w-full h-full relative flex items-center justify-center">
                <video
                  ref={(element) => setVideoStream(
                    element,
                    getRemoteStream(remoteScreenParticipant?.user_id) || remoteStreamRef.current,
                  )}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
                {/* شارة الشير سكرين للطرف الثاني */}
                <div className="absolute top-4 left-4 bg-[#5865f2] text-white text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow-lg z-10 backdrop-blur-sm">
                  <Monitor size={15} />
                  <span>
                    {remoteScreenParticipant?.user?.display_name
                      || remoteScreenParticipant?.user?.username
                      || friendName} is sharing their screen
                  </span>
                </div>
                {remoteScreenParticipant && (
                  <div className="absolute top-4 right-4 z-20" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setShowStreamAudioMenu((previous) => !previous)}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border shadow-lg transition ${
                        remoteScreenAudioSettings.muted
                          ? 'border-[#f23f43]/40 bg-[#f23f43]/80 text-white'
                          : 'border-white/10 bg-black/75 text-white hover:bg-[#2b2d31]'
                      }`}
                      title="Control stream audio"
                      aria-label="Control stream audio"
                      aria-expanded={showStreamAudioMenu}
                    >
                      {remoteScreenAudioSettings.muted ? <VolumeX size={19} /> : <Headphones size={19} />}
                    </button>
                    {showStreamAudioMenu && (
                      <div className="absolute right-0 top-12 w-64 rounded-xl border border-[#353740] bg-[#17181c] p-3 text-[#dbdee1] shadow-[0_12px_40px_rgba(0,0,0,0.65)]">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Headphones size={16} />
                            Stream audio
                          </span>
                          <span className="rounded-md bg-[#2b2d31] px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                            {Math.round(remoteScreenAudioVolume * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round(remoteScreenAudioVolume * 100)}
                          onChange={(event) => setStreamVolume(
                            remoteScreenParticipant.user_id,
                            Number(event.target.value) / 100,
                          )}
                          className="participant-volume-slider mb-3 w-full cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, #5865f2 0%, #5865f2 ${remoteScreenAudioVolume * 100}%, #3b3d44 ${remoteScreenAudioVolume * 100}%, #3b3d44 100%)`,
                          }}
                          aria-label="Stream audio volume"
                        />
                        <button
                          type="button"
                          onClick={() => setStreamMuted(
                            remoteScreenParticipant.user_id,
                            !remoteScreenAudioSettings.muted,
                          )}
                          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-[#272930]"
                        >
                          <span>{remoteScreenAudioSettings.muted ? 'Unmute stream' : 'Mute stream'}</span>
                          {remoteScreenAudioSettings.muted ? <VolumeX size={16} /> : <Headphones size={16} />}
                        </button>
                      </div>
                    )}
                  </div>
                )}
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
              {isRemoteSharingScreen ? (
                // أنت في الـ PIP لأن الطرف الثاني هو اللي فاتح شير
                <div className="w-full h-full relative flex items-center justify-center">
                  {isScreenSharing ? (
                    <video
                      ref={(element) => setVideoStream(element, screenStreamRef.current)}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : isVideoEnabled ? (
                    <video
                      ref={(element) => setVideoStream(element, localStreamRef.current)}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
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
                  {remoteCameraParticipants[0] ? (
                    <video
                      ref={(element) => setVideoStream(
                        element,
                        getRemoteStream(remoteCameraParticipants[0].user_id),
                      )}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
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
                </div>
              )}
            </div>
          </div>
        ) : isVideoCallActive ? (
          /* حالة 2: عرض فيديو كل أعضاء المكالمة */
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 auto-rows-max gap-4 w-full h-full max-w-6xl items-center justify-center overflow-y-auto">
            {activeParticipants.map((participant) => {
              const isLocal = participant.user_id === currentUser?.id;
              const participantUser = participant.user || {};
              const name = isLocal
                ? `${myName} (You)`
                : participantUser.display_name || participantUser.username || 'Friend';
              const state = getParticipantState(participant);
              const remoteVideoStream = isLocal ? null : getRemoteStream(participant.user_id);
              const cameraVisible = !!state.camera && (isLocal || !!remoteVideoStream);
              return (
                <div key={participant.user_id} className="group relative aspect-video w-full min-h-[220px] max-h-[420px] bg-[#09080c] border border-[#1e1f22] rounded-xl flex items-center justify-center overflow-hidden shadow-2xl transition-all hover:border-[#2b2d31]">
                  {cameraVisible && (
                    <video
                      ref={(element) => setVideoStream(
                        element,
                        isLocal ? localStreamRef.current : remoteVideoStream,
                      )}
                      autoPlay
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {!cameraVisible && (
                    <div className="flex flex-col items-center gap-3">
                      <div                       className={`w-20 h-20 rounded-full bg-[#18191c] border-2 flex items-center justify-center text-white text-2xl font-bold shadow-xl ${
                        state.muted ? 'border-[#f23f43]' : 'border-[#23a55a]'
                      }`}>
                        {participantUser.avatar_url ? (
                          <img src={participantUser.avatar_url} alt={name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          name.substring(0, 2).toUpperCase()
                        )}
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-md bg-black/75 px-2.5 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
                    {name}
                  </div>
                  <div className={`absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium backdrop-blur-sm ${
                    state.muted ? 'text-[#f23f43]' : state.deafened ? 'text-[#f0b132]' : 'text-[#23a55a]'
                  }`}>
                    {state.muted ? 'Muted' : state.deafened ? 'Deafened' : cameraVisible ? 'Video on' : 'Connected'}
                  </div>
                  {renderParticipantMenu(participant, name)}
                </div>
              );
            })}
          </div>
        ) : (
          /* حالة 3: مكالمة صوتية نقية (Pure Voice Call - Classic Discord Stage) */
          <>
            {/* عناصر الفيديو متصلة في الخلفية لكن مخفية تماماً بدون التأثير على الواجهة */}
            <div className="hidden" aria-hidden="true">
              {/* muted إجباري: الصوت بيتم تشغيله من عناصر <audio> المخصصة فقط.
                  لو الفيديو شغّل الصوت كمان، نفس الصوت بيتسمع مرتين => صدى. */}
              <video ref={remoteVideoRef} autoPlay muted playsInline />
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>

            <div className="grid w-full max-w-[860px] grid-cols-1 place-items-center gap-3 sm:grid-cols-2">
              {activeParticipants.map((participant) => {
                const isLocal = participant.user_id === currentUser?.id;
                const participantUser = participant.user || {};
                const participantName = isLocal
                  ? myName
                  : participantUser.display_name || participantUser.username || 'Friend';
                const participantState = getParticipantState(participant);
                const muted = participantState.muted;
                const noiseActive = participantState.noiseSuppressionActive;

                return (
                  <div key={participant.user_id} className="group relative aspect-video w-full max-w-[420px] overflow-hidden rounded-xl border border-[#1e1f22] bg-[#09080c] shadow-2xl transition-all hover:border-[#2b2d31]">
                    <div className={`absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-2 bg-[#1e1f22] text-2xl font-bold text-white shadow-xl ${
                      muted ? 'border-[#f23f43]' : 'border-[#23a55a]'
                    }`}>
                      {participantUser.avatar_url ? (
                        <img src={participantUser.avatar_url} alt={participantName} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        participantName.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-md bg-black/75 px-2.5 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
                      {participantName}{isLocal ? ' (You)' : ''}
                    </div>
                    <div
                      className={`absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium backdrop-blur-sm ${
                        muted ? 'text-[#f23f43]' : noiseActive ? 'text-[#23a55a]' : 'text-[#b5bac1]'
                      }`}
                      title={noiseActive ? 'AI noise suppression is active' : 'AI noise suppression is not active'}
                    >
                      {muted ? 'Muted' : noiseActive ? 'Noise suppression on' : 'Connected'}
                    </div>
                    {renderParticipantMenu(participant, participantName)}
                    {participantState.deafened && (
                      <span className="absolute right-14 top-3 rounded-md border border-[#1e1f22] bg-black/80 px-2 py-1 text-xs">🔇 Deafened</span>
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
