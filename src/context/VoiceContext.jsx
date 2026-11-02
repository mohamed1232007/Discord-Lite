import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track } from 'livekit-client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { supabase } from '../services/supabaseClient';
import { DenoiseEngine, preloadDenoiser } from '../services/denoiser';
import { callApi } from '../services/callApi';
import { useCallRoomSync } from '../hooks/useCallRoomSync';
import { MediaPermissionModal, ScreenSharePicker } from '../components/CallPermissionModals';

const VoiceContext = createContext({});
const SELECTED_MIC_STORAGE_KEY = 'dis_lite_selected_mic';
const SELECTED_SPEAKER_STORAGE_KEY = 'dis_lite_selected_speaker';
const MIC_VOLUME_STORAGE_KEY = 'dis_lite_mic_volume';
const SPEAKER_VOLUME_STORAGE_KEY = 'dis_lite_speaker_volume';
const PARTICIPANT_AUDIO_STORAGE_KEY = 'dis_lite_participant_audio';
const STREAM_AUDIO_STORAGE_KEY = 'dis_lite_stream_audio';
const NOISE_LEVEL_STORAGE_KEY = 'dis_lite_noise_level';
const NOISE_LEVELS = ['standard', 'strong', 'max', 'voiceFocus'];
const NOISE_LEVEL_LABELS = {
  standard: 'Standard',
  strong: 'Strong',
  max: 'Maximum',
  voiceFocus: 'Voice Focus (Silero VAD)',
};

const getSavedParticipantAudio = () => {
  try {
    const savedSettings = JSON.parse(window.localStorage.getItem(PARTICIPANT_AUDIO_STORAGE_KEY) || '{}');
    if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) return {};

    return Object.fromEntries(
      Object.entries(savedSettings)
        .filter(([, settings]) => settings && typeof settings === 'object')
        .map(([userId, settings]) => [
          userId,
          {
            volume: Number.isFinite(settings.volume)
              ? Math.min(2, Math.max(0, settings.volume))
              : 1,
            muted: settings.muted === true,
          },
        ]),
    );
  } catch (error) {
    console.warn('[Audio] Could not restore participant volume settings:', error);
    return {};
  }
};

const getSavedStreamAudio = () => {
  try {
    const savedSettings = JSON.parse(window.localStorage.getItem(STREAM_AUDIO_STORAGE_KEY) || '{}');
    if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) return {};

    return Object.fromEntries(
      Object.entries(savedSettings)
        .filter(([, settings]) => settings && typeof settings === 'object')
        .map(([userId, settings]) => [
          userId,
          {
            volume: Number.isFinite(settings.volume)
              ? Math.min(1, Math.max(0, settings.volume))
              : 1,
            muted: settings.muted === true,
          },
        ]),
    );
  } catch (error) {
    console.warn('[Audio] Could not restore stream volume settings:', error);
    return {};
  }
};

const getSavedAudioDevice = (storageKey) => {
  try {
    return window.localStorage.getItem(storageKey) || 'default';
  } catch (error) {
    console.warn('[Audio] Could not restore saved device selection:', error);
    return 'default';
  }
};

const getSavedVolume = (storageKey, defaultVal = 1) => {
  try {
    const val = parseFloat(window.localStorage.getItem(storageKey));
    return Number.isFinite(val) ? Math.max(0, Math.min(2, val)) : defaultVal;
  } catch (error) {
    console.warn('[Audio] Could not restore volume:', error);
    return defaultVal;
  }
};

const getSavedNoiseLevel = () => {
  try {
    const saved = window.localStorage.getItem(NOISE_LEVEL_STORAGE_KEY);
    return NOISE_LEVELS.includes(saved) ? saved : 'standard';
  } catch (error) {
    console.warn('[Audio] Could not restore noise suppression level:', error);
    return 'standard';
  }
};

const applyNativeNoiseFallback = async (stream) => {
  const track = stream?.getAudioTracks()[0];
  if (!track) return;

  try {
    await track.applyConstraints({ noiseSuppression: true, autoGainControl: false });
  } catch (error) {
    console.warn('[Audio] Could not enable native noise suppression fallback:', error);
  }
};

const applyVoiceFocusNoiseSuppression = async (stream, enabled) => {
  const track = stream?.getAudioTracks()[0];
  if (!track) return;

  try {
    await track.applyConstraints({ noiseSuppression: { ideal: enabled } });
  } catch (error) {
    console.warn('[Audio] Could not update native noise suppression for Voice Focus:', error);
  }
};

export const VoiceProvider = ({ children }) => {
  const { user, token, onlineUsers } = useAuth();
  const toast = useToast();

  // ── State ──────────────────────────────────────────────
  const [activeCall,      setActiveCall]     = useState(null);
  const [incomingCall,    setIncomingCall]   = useState(null);
  const [callStatus,      setCallStatus]     = useState('idle'); // 'idle' | 'calling' | 'ringing' | 'connected'
  const [callConnectedAt, setCallConnectedAt] = useState(null);
  const [isMuted,         setIsMuted]        = useState(false);
  const [isDeafened,      setIsDeafened]     = useState(false);
  const [isVideoEnabled,  setIsVideoEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing]= useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [isRemoteCamera,        setIsRemoteCamera]        = useState(false);
  const [remoteCallStates, setRemoteCallStates] = useState({});
  const [voiceReady,      setVoiceReady]     = useState(false);
  const [callParticipants, setCallParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [mediaPermissionRequest, setMediaPermissionRequest] = useState(null);
  const [isScreenSharePickerOpen, setIsScreenSharePickerOpen] = useState(false);
  const remoteCallStatesRef = useRef({});

  // ── Audio Devices State ────────────────────────────────
  const [microphones,     setMicrophones]    = useState([]);
  const [speakers,        setSpeakers]       = useState([]);
  const [selectedMic,     setSelectedMic]    = useState(() => getSavedAudioDevice(SELECTED_MIC_STORAGE_KEY));
  const [selectedSpeaker, setSelectedSpeaker]= useState(() => getSavedAudioDevice(SELECTED_SPEAKER_STORAGE_KEY));
  const [micVolume,       setMicVolume]      = useState(() => getSavedVolume(MIC_VOLUME_STORAGE_KEY, 1));
  const [speakerVolume,   setSpeakerVolume]  = useState(() => getSavedVolume(SPEAKER_VOLUME_STORAGE_KEY, 1));
  const [participantAudioSettings, setParticipantAudioSettings] = useState(getSavedParticipantAudio);
  const [streamAudioSettings, setStreamAudioSettings] = useState(getSavedStreamAudio);
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] = useState(true);
  const [isNoiseSuppressionActive, setIsNoiseSuppressionActive] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState(getSavedNoiseLevel);
  const [speakingUsers, setSpeakingUsers] = useState({});

  // ── Refs (لا تتغيرش بين renders) ──────────────────────
  const roomRef = useRef(null);
  const localPublishedTracksRef = useRef(new Map());
  const remotePublishedTracksRef = useRef(new Map());
  const intentionalDisconnectRef = useRef(false);
  const mediaPermissionResolverRef = useRef(null);
  const cameraEnabledRef = useRef(false);
  const cameraTogglePendingRef = useRef(false);
  const pendingVideoCallRef = useRef(false);
  const mutedBeforeDeafenRef = useRef(false);
  const localStreamRef  = useRef(null);
  const rawMicStreamRef = useRef(null);      // Raw mic stream قبل الفلتر
  const denoiseEngineRef = useRef(null);     // محرك إزالة الضوضاء (graph ثابت طول المكالمة)
  const denoiseGenerationRef = useRef(0);
  const noiseSuppressionActiveRef = useRef(false);
  const remoteStreamRef = useRef(null);
  const remoteStreamOwnerRef = useRef(null);
  const remoteStreamsRef = useRef([]);
  const remoteDenoiseCleanupRef = useRef(null); // تنظيف فلتر الطرف المستقبل
  const remoteAudioElementsRef = useRef(new Map());
  const remoteScreenAudioElementsRef = useRef(new Map());
  const screenStreamRef = useRef(null);
  const screenAudioTrackRef = useRef(null);   // صوت مشاركة الشاشة الحقيقي أثناء الشير
  const dbCallIdRef     = useRef(null);
  const activeCallRef   = useRef(null);      // mirror of activeCall state (للـ closures)
  const callConnectedAtRef = useRef(null);
  const mediaChannelRef = useRef(null);
  const localCallStateRef = useRef({
    muted: false,
    deafened: false,
    camera: false,
    screen: false,
    videoCall: false,
    noiseSuppressionActive: false,
  });
  const incomingCallRef = useRef(incomingCall);
  const dismissedIncomingRoomsRef = useRef(new Map());
  const answeringCallRef = useRef(false);
  const pendingIncomingRoomRef = useRef(null);
  const callParticipantsRef = useRef(callParticipants);
  const localMembershipActiveRef = useRef(false);
  const endCallCleanupRef = useRef(null);
  const onlineUsersRef = useRef(onlineUsers);
  const offlineTimersRef = useRef(new Map());
  const OFFLINE_GRACE_MS = 10_000;
  const noiseLevelRef = useRef(noiseLevel);

  const requestMediaPermission = (kind) => new Promise((resolve) => {
    mediaPermissionResolverRef.current?.(false);
    mediaPermissionResolverRef.current = resolve;
    setMediaPermissionRequest({ kind });
  });

  const resolveMediaPermission = (granted) => {
    mediaPermissionResolverRef.current?.(granted);
    mediaPermissionResolverRef.current = null;
    setMediaPermissionRequest(null);
  };

  const markCallConnected = () => {
    if (callConnectedAtRef.current === null) {
      const connectedAt = Date.now();
      callConnectedAtRef.current = connectedAt;
      setCallConnectedAt(connectedAt);
    }
    setCallStatus('connected');
  };

  useEffect(() => {
    onlineUsersRef.current = onlineUsers;
  }, [onlineUsers]);

  useEffect(() => {
    if (!user?.id || !isNoiseSuppressionEnabled) return undefined;

    let cancelled = false;
    let idleHandle;
    let timeoutHandle;
    const warmDenoiser = () => {
      if (cancelled) return;
      preloadDenoiser(noiseLevelRef.current).catch((error) => {
        console.warn('[NoiseSuppression] Could not preload the audio model:', error);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(warmDenoiser, { timeout: 2500 });
    } else {
      timeoutHandle = window.setTimeout(warmDenoiser, 1000);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [user?.id, isNoiseSuppressionEnabled, noiseLevel]);

  useEffect(() => {
    noiseLevelRef.current = noiseLevel;
    try {
      window.localStorage.setItem(NOISE_LEVEL_STORAGE_KEY, noiseLevel);
    } catch (error) {
      console.error('[Audio] Could not save noise suppression level:', error);
    }
  }, [noiseLevel]);

  const updateRemoteCallState = (participantId, changes) => {
    const state = {
      ...(remoteCallStatesRef.current[participantId] || {}),
      ...changes,
      synced: true,
    };
    const states = { ...remoteCallStatesRef.current, [participantId]: state };
    remoteCallStatesRef.current = states;
    setRemoteCallStates(states);
    setIsRemoteScreenSharing(Object.values(states).some((item) => item.screen));
    setIsRemoteCamera(Object.values(states).some((item) => item.camera));
  };

  const publishCallState = (changes = {}) => {
    localCallStateRef.current = { ...localCallStateRef.current, ...changes };
    sendMediaSignal({ type: 'call_state', ...localCallStateRef.current });
  };

  const applyRemoteCallState = (payload) => {
    if (!payload?.senderId || payload.senderId === user?.id) return;

    if (payload.type === 'call_state') {
      const state = {
        muted: !!payload.muted,
        deafened: !!payload.deafened,
        camera: !!payload.camera,
        screen: !!payload.screen,
        screenAudio: !!payload.screenAudio,
        noiseSuppressionActive: !!payload.noiseSuppressionActive,
        synced: true,
      };
      updateRemoteCallState(payload.senderId, state);
      if (payload.videoCall && activeCallRef.current) {
        activeCallRef.current = { ...activeCallRef.current, isVideo: true };
        setActiveCall(activeCallRef.current);
      }
      return;
    }

    if (payload.type === 'screen') updateRemoteCallState(payload.senderId, { screen: !!payload.enabled });
    if (payload.type === 'camera') updateRemoteCallState(payload.senderId, { camera: !!payload.enabled });
    if (payload.type === 'video_call' && payload.enabled) {
      setIsRemoteCamera(true);
      pendingVideoCallRef.current = true;
      if (activeCallRef.current) {
        activeCallRef.current = { ...activeCallRef.current, isVideo: true };
        setActiveCall(activeCallRef.current);
        pendingVideoCallRef.current = false;
      }
    }
  };

  // مزامنة حالة الميديا عبر Supabase Realtime؛ الصوت والفيديو ينتقلان عبر LiveKit.
  const sendMediaSignal = (payload) => {
    const fullPayload = { ...payload, senderId: user?.id };
    if (mediaChannelRef.current) {
      mediaChannelRef.current.send({
        type: 'broadcast',
        event: 'media_state',
        payload: fullPayload
      }).catch(err => console.warn('[sendMediaSignal] error:', err));
    }
  };

  const mediaSignalHandlersRef = useRef(null);
  useEffect(() => {
    mediaSignalHandlersRef.current = { applyRemoteCallState, publishCallState };
  });

  // مزامنة حالة الصوت والكاميرا ومشاركة الشاشة لجميع أعضاء المكالمة
  useEffect(() => {
    if (!activeCall?.roomId || !user?.id) {
      if (mediaChannelRef.current) {
        supabase.removeChannel(mediaChannelRef.current);
        mediaChannelRef.current = null;
      }
      // حالة المشاركة البعيدة تُصفَّر في endCallCleanup عند إنهاء المكالمة
      remoteCallStatesRef.current = {};
      return;
    }

    const ch = supabase.channel(`call-media-${activeCall.roomId}`)
      .on('broadcast', { event: 'media_state' }, ({ payload }) => {
        mediaSignalHandlersRef.current?.applyRemoteCallState(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') mediaSignalHandlersRef.current?.publishCallState();
      });

    mediaChannelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      mediaChannelRef.current = null;
    };
  }, [activeCall?.roomId, user?.id]);

  // DOM refs
  const remoteAudioRef = useRef(null);
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);

  // Keep the latest call state available to asynchronous handlers.
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);
  useEffect(() => { callParticipantsRef.current = callParticipants; }, [callParticipants]);

  const publishLiveKitTrack = async (mediaTrack, key, source, options = {}) => {
    const room = roomRef.current;
    if (!room) throw new Error('The LiveKit room is not connected.');

    const previousTrack = localPublishedTracksRef.current.get(key);
    if (previousTrack?.mediaStreamTrack === mediaTrack) return previousTrack;
    if (previousTrack) await unpublishLiveKitTrack(key, false);

    const localTrack = mediaTrack.kind === 'audio'
      ? new LocalAudioTrack(mediaTrack)
      : new LocalVideoTrack(mediaTrack);
    try {
      await room.localParticipant.publishTrack(localTrack, { source, ...options });
      localPublishedTracksRef.current.set(key, localTrack);
      return localTrack;
    } catch (error) {
      localTrack.stop();
      throw error;
    }
  };

  const unpublishLiveKitTrack = async (key, stopTrack = true) => {
    const localTrack = localPublishedTracksRef.current.get(key);
    if (!localTrack) return;

    const room = roomRef.current;
    try {
      if (room) await room.localParticipant.unpublishTrack(localTrack, false);
    } finally {
      localPublishedTracksRef.current.delete(key);
      if (stopTrack) localTrack.stop();
    }
  };

  const updateRemoteParticipantStream = (participantId) => {
    const tracks = remotePublishedTracksRef.current.get(participantId) || {};
    const mediaTracks = [
      tracks.microphone,
      tracks.screenAudio,
      tracks.screenShare,
      tracks.camera,
    ].filter((track) => track?.readyState === 'live');
    const existingIndex = remoteStreamsRef.current.findIndex((entry) => entry.userId === participantId);
    const nextStreams = [...remoteStreamsRef.current];

    if (mediaTracks.length === 0) {
      if (existingIndex !== -1) nextStreams.splice(existingIndex, 1);
      remotePublishedTracksRef.current.delete(participantId);
    } else {
      const stream = new MediaStream(mediaTracks);
      const entry = { userId: participantId, stream };
      if (existingIndex === -1) nextStreams.push(entry);
      else nextStreams[existingIndex] = entry;
    }

    remoteStreamsRef.current = nextStreams;
    setRemoteStreams(nextStreams);

    if (remoteStreamOwnerRef.current === participantId || !remoteStreamOwnerRef.current) {
      const currentEntry = nextStreams.find((entry) => entry.userId === participantId);
      const selectedEntry = currentEntry || nextStreams[0] || null;
      remoteStreamOwnerRef.current = selectedEntry?.userId || null;
      remoteStreamRef.current = selectedEntry?.stream || null;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        remoteVideoRef.current.play().catch((error) => console.warn('[Video] play blocked:', error));
      }
    }
  };

  const addRemoteTrack = (track, publication, participant) => {
    const participantId = participant.identity;
    if (!participantId) return;

    const source = publication.source;
    const key = source === Track.Source.Microphone
      ? 'microphone'
      : source === Track.Source.ScreenShareAudio
        ? 'screenAudio'
        : source === Track.Source.ScreenShare
          ? 'screenShare'
          : source === Track.Source.Camera
            ? 'camera'
            : track.kind === 'audio'
              ? 'microphone'
              : 'camera';
    const participantTracks = remotePublishedTracksRef.current.get(participantId) || {};
    participantTracks[key] = track.mediaStreamTrack;
    remotePublishedTracksRef.current.set(participantId, participantTracks);
    updateRemoteParticipantStream(participantId);
    markCallConnected();
  };

  const removeRemoteTrack = (track, publication, participant) => {
    const participantId = participant.identity;
    const participantTracks = remotePublishedTracksRef.current.get(participantId);
    if (!participantTracks) return;

    const source = publication.source;
    const key = source === Track.Source.Microphone
      ? 'microphone'
      : source === Track.Source.ScreenShareAudio
        ? 'screenAudio'
        : source === Track.Source.ScreenShare
          ? 'screenShare'
          : source === Track.Source.Camera
            ? 'camera'
            : track.kind === 'audio'
              ? 'microphone'
              : 'camera';
    if (participantTracks[key] === track.mediaStreamTrack) delete participantTracks[key];
    updateRemoteParticipantStream(participantId);
  };

  const connectLiveKitRoom = async (roomId) => {
    if (roomRef.current) throw new Error('A LiveKit room is already connected.');

    const room = new Room({ adaptiveStream: true, dynacast: true });
    intentionalDisconnectRef.current = false;
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, addRemoteTrack);
    room.on(RoomEvent.TrackUnsubscribed, removeRemoteTrack);
    room.on(RoomEvent.ParticipantConnected, markCallConnected);
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      remotePublishedTracksRef.current.delete(participant.identity);
      updateRemoteParticipantStream(participant.identity);
    });
    room.on(RoomEvent.Disconnected, () => {
      if (roomRef.current !== room) return;
      roomRef.current = null;
      localPublishedTracksRef.current.clear();
      setVoiceReady(false);
      if (!intentionalDisconnectRef.current && activeCallRef.current) {
        toast.error('The voice connection was interrupted.');
        endCallCleanupRef.current?.(true);
      }
    });

    try {
      const { token: roomToken, serverUrl } = await callApi(token, `/${roomId}/token`, { method: 'POST' });
      await room.connect(serverUrl, roomToken);
      const microphoneTrack = localStreamRef.current?.getAudioTracks()
        .find((track) => track.readyState === 'live');
      if (!microphoneTrack) throw new Error('The processed microphone track is unavailable.');
      await publishLiveKitTrack(microphoneTrack, 'microphone', Track.Source.Microphone);

      const cameraTrack = localStreamRef.current?.getVideoTracks()
        .find((track) => track.readyState === 'live');
      if (cameraTrack && cameraEnabledRef.current) {
        await publishLiveKitTrack(cameraTrack, 'camera', Track.Source.Camera, {
          videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 },
          degradationPreference: 'maintain-framerate',
        });
      }
      setVoiceReady(true);
      if (room.remoteParticipants.size > 0) markCallConnected();
    } catch (error) {
      intentionalDisconnectRef.current = true;
      roomRef.current = null;
      localPublishedTracksRef.current.clear();
      try {
        await room.disconnect();
      } catch (cleanupError) {
        console.error('[LiveKit] Could not clean up a failed room connection:', cleanupError);
      }
      throw error;
    }
  };

  const disposeScreenAudio = () => {
    if (screenAudioTrackRef.current) {
      screenAudioTrackRef.current.onended = null;
      screenAudioTrackRef.current.stop();
      screenAudioTrackRef.current = null;
    }
  };

  // ─────────────────────────────────────────────────────
  // Helper: Enumerate Audio Devices (جلب المايكات والسماعات الحقيقية)
  // ─────────────────────────────────────────────────────
  const updateAudioDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();

      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${index + 1}`,
        }));

      const spks = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker / Headphone ${index + 1}`,
        }));

      setMicrophones(mics);
      setSpeakers(spks);
    } catch (err) {
      console.warn('[Devices] Failed to enumerate audio devices:', err);
    }
  };

  useEffect(() => {
    // التأجيل لمهمة قصيرة يمنع setState المتزامن داخل الـ effect
    const initialScan = window.setTimeout(updateAudioDevices, 0);
    navigator.mediaDevices?.addEventListener?.('devicechange', updateAudioDevices);
    return () => {
      window.clearTimeout(initialScan);
      navigator.mediaDevices?.removeEventListener?.('devicechange', updateAudioDevices);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_MIC_STORAGE_KEY, selectedMic);
    } catch (error) {
      console.error('[Audio] Could not save microphone selection:', error);
    }
  }, [selectedMic]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_SPEAKER_STORAGE_KEY, selectedSpeaker);
    } catch (error) {
      console.error('[Audio] Could not save speaker selection:', error);
    }
  }, [selectedSpeaker]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PARTICIPANT_AUDIO_STORAGE_KEY, JSON.stringify(participantAudioSettings));
    } catch (error) {
      console.error('[Audio] Could not save participant volume settings:', error);
    }
  }, [participantAudioSettings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STREAM_AUDIO_STORAGE_KEY, JSON.stringify(streamAudioSettings));
    } catch (error) {
      console.error('[Audio] Could not save stream volume settings:', error);
    }
  }, [streamAudioSettings]);

  // مستوى صوت مشاركة الشاشة (زي الدسكورد) — بيتحفظ في localStorage لكل مستخدم.
  const setStreamVolume = (userId, volume) => {
    if (!userId || !Number.isFinite(volume)) return;
    const nextVolume = Math.min(1, Math.max(0, volume));
    setStreamAudioSettings((previous) => ({
      ...previous,
      [userId]: {
        ...previous[userId],
        volume: nextVolume,
      },
    }));
  };

  const setStreamMuted = (userId, muted) => {
    if (!userId) return;
    setStreamAudioSettings((previous) => ({
      ...previous,
      [userId]: {
        volume: previous[userId]?.volume ?? 1,
        muted: !!muted,
      },
    }));
  };

  const setParticipantVolume = (participantId, volume) => {
    if (!participantId || !Number.isFinite(volume)) return;
    const nextVolume = Math.min(2, Math.max(0, volume));
    setParticipantAudioSettings((previous) => ({
      ...previous,
      [participantId]: {
        ...previous[participantId],
        volume: nextVolume,
      },
    }));
  };

  const setParticipantMuted = (participantId, muted) => {
    if (!participantId) return;
    setParticipantAudioSettings((previous) => ({
      ...previous,
      [participantId]: {
        ...previous[participantId],
        muted: !!muted,
      },
    }));
  };

  const destroyDenoiseEngine = () => {
    if (denoiseEngineRef.current) {
      denoiseEngineRef.current.destroy();
      denoiseEngineRef.current = null;
    }
  };

  const getDenoiseEngine = () => {
    if (!denoiseEngineRef.current || denoiseEngineRef.current.destroyed) {
      denoiseEngineRef.current = new DenoiseEngine();
    }
    return denoiseEngineRef.current;
  };

  // تنظيف محرك الصوت عند إغلاق الـ provider (تسجيل خروج/إغلاق التطبيق)
  useEffect(() => () => {
    intentionalDisconnectRef.current = true;
    const room = roomRef.current;
    roomRef.current = null;
    localPublishedTracksRef.current.clear();
    room?.disconnect().catch((error) => {
      console.warn('[LiveKit] Could not disconnect during provider cleanup:', error);
    });
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    mediaPermissionResolverRef.current?.(false);
    destroyDenoiseEngine();
  }, []);

  // دالة تغيير المايك
  const changeMicrophone = async (deviceId) => {
    // لو في مكالمة شغالة، نغيّر مصدر الصوت في محرك إزالة الضوضاء.
    // الـ track اللي بيتبعت للطرف التاني بيفضل نفسه، فمفيش انقطاع.
    if (activeCall && localStreamRef.current) {
      const generation = denoiseGenerationRef.current + 1;
      denoiseGenerationRef.current = generation;

      try {
        const newRawStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: { ideal: isNoiseSuppressionEnabled && noiseLevelRef.current === 'voiceFocus' },
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
          },
        });

        if (denoiseGenerationRef.current !== generation) {
          newRawStream.getTracks().forEach((track) => track.stop());
          return;
        }

        const engine = denoiseEngineRef.current;
        if (engine && !engine.destroyed) {
          await engine.setSource(newRawStream);
        } else {
          // مفيش محرك (فشل تشغيله) — نستخدم المايك الجديد مباشرة
          const newTrack = newRawStream.getAudioTracks()[0];
          if (!newTrack) throw new Error('The selected microphone did not provide an audio track.');
          newTrack.enabled = !localCallStateRef.current.muted;
          await publishLiveKitTrack(newTrack, 'microphone', Track.Source.Microphone);

          const localStream = localStreamRef.current;
          const oldTrack = localStream.getAudioTracks()[0];
          if (oldTrack && oldTrack !== newTrack) localStream.removeTrack(oldTrack);
          if (!localStream.getAudioTracks().includes(newTrack)) localStream.addTrack(newTrack);
          if (oldTrack && oldTrack !== newTrack) oldTrack.stop();

          noiseSuppressionActiveRef.current = false;
          setIsNoiseSuppressionActive(false);
        }

        const previousRawStream = rawMicStreamRef.current;
        rawMicStreamRef.current = newRawStream;
        previousRawStream?.getTracks().forEach((track) => track.stop());

        publishCallState({ noiseSuppressionActive: noiseSuppressionActiveRef.current });

        if (activeCall.roomId) {
          await callApi(token, `/${activeCall.roomId}/noise`, {
            method: 'PATCH',
            body: { enabled: noiseSuppressionActiveRef.current },
          });
        }
        setSelectedMic(deviceId);
        toast.success('Microphone changed successfully.');
      } catch (err) {
        console.error('[changeMicrophone] Error switching mic:', err);
        toast.error('Could not switch microphones. Check the selected device and its permission.');
      }
      return;
    }

    setSelectedMic(deviceId);
    toast.info('Microphone selected for your next call.');
  };

  // دالة تغيير السماعة
  const changeSpeaker = async (deviceId) => {
    setSelectedSpeaker(deviceId);
    toast.info('Audio output device changed successfully');

    const audioElements = Array.from(remoteAudioElementsRef.current.values());
    if (audioElements.some((element) => typeof element.setSinkId === 'function')) {
      try {
        await Promise.all(audioElements.map((element) => (
          typeof element.setSinkId === 'function'
            ? element.setSinkId(deviceId === 'default' ? '' : deviceId)
            : Promise.resolve()
        )));
      } catch (err) {
        console.warn('[changeSpeaker] setSinkId error:', err);
      }
    }
  };

  const changeMicVolume = (vol) => {
    const next = Math.max(0, Math.min(2, Number(vol)));
    setMicVolume(next);
    try {
      window.localStorage.setItem(MIC_VOLUME_STORAGE_KEY, String(next));
    } catch (e) {
      console.warn('[Audio] Failed to persist mic volume:', e);
    }

    const engine = denoiseEngineRef.current;
    if (engine && !engine.destroyed) {
      engine.setMicGain(next);
    }
  };

  const changeSpeakerVolume = (vol) => {
    const next = Math.max(0, Math.min(2, Number(vol)));
    setSpeakerVolume(next);
    try {
      window.localStorage.setItem(SPEAKER_VOLUME_STORAGE_KEY, String(next));
    } catch (e) {
      console.warn('[Audio] Failed to persist speaker volume:', e);
    }

    remoteAudioElementsRef.current.forEach((el) => {
      if (el) {
        el.volume = Math.min(1, Math.max(0, next > 1 ? 1 : next));
      }
    });
  };

  // ─────────────────────────────────────────────────────
  // Call sound effects
  // ─────────────────────────────────────────────────────
  const soundEffectsRef = useRef(new Map());

  const getSoundEffect = (name) => {
    let audio = soundEffectsRef.current.get(name);
    if (!audio) {
      const soundUrl = new URL(
        `${import.meta.env.BASE_URL}sounds/${name}.mp3`,
        window.location.href,
      );
      audio = new Audio(soundUrl);
      audio.preload = 'auto';
      soundEffectsRef.current.set(name, audio);
    }
    return audio;
  };

  const playSoundEffect = (name, volume = 0.35) => {
    const audio = getSoundEffect(name);
    audio.pause();
    audio.currentTime = 0;
    audio.loop = false;
    audio.volume = volume;
    audio.play().catch((error) => {
      console.warn(`[Sound] Could not play ${name}.mp3:`, error);
    });
  };

  const playNotificationSound = () => playSoundEffect('notification', 0.45);

  const startCallRingtone = () => {
    const audio = getSoundEffect('calling');
    if (!audio.paused) return;
    audio.loop = true;
    audio.currentTime = 0;
    audio.volume = 0.25;
    audio.play().catch((error) => {
      console.warn('[Sound] Could not play calling.mp3:', error);
    });
  };

  const stopCallRingtone = () => {
    const audio = soundEffectsRef.current.get('calling');
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  };

  // مراقبة حالات المكالمة لتشغيل وإيقاف الرنين تلقائياً
  useEffect(() => {
    // 1. لو في مكالمة واردة (Incoming Call Ringing)
    if (incomingCall) {
      startCallRingtone();
    }
    // 2. لو المتصل في وضع الاتصال والطرف التاني لسه ماردش (Outgoing Ringing)
    else if (activeCall && callStatus === 'calling') {
      startCallRingtone();
    }
    // 3. أول ما المكالمة تتقبل (Connected) أو تنتهي (Idle) -> إيقاف الرنين فوراً
    else {
      stopCallRingtone();
    }

    return () => stopCallRingtone();
    // دوال الرنين تعتمد على refs فقط، وإضافتها للاعتماديات تعيد تشغيل النغمة بلا داعٍ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall, activeCall, callStatus]);

  useEffect(() => () => {
    soundEffectsRef.current.forEach((audio) => audio.pause());
    soundEffectsRef.current.clear();
  }, []);

  // ─────────────────────────────────────────────────────
  // Helper: Acquire microphone & initial media stream (with RNNoise Neural Denoise)
  // ─────────────────────────────────────────────────────
  const acquireMediaStream = async ({ includeVideo = false } = {}) => {
    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: {
          ideal: isNoiseSuppressionEnabled && noiseLevelRef.current === 'voiceFocus',
        },
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
      };
      if (selectedMic && selectedMic !== 'default') {
        audioConstraints.deviceId = { exact: selectedMic };
      }

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: includeVideo
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            }
          : false,
      });
      if (rawStream.getAudioTracks().length === 0) {
        rawStream.getTracks().forEach((track) => track.stop());
        const error = new Error('The selected microphone did not provide an audio track.');
        error.name = 'NotFoundError';
        throw error;
      }
      rawMicStreamRef.current = rawStream;

      let audioTrack = rawStream.getAudioTracks()[0];
      let noiseActive = false;

      // بنشغّل المحرك دايماً (حتى لو الفلتر مقفول) عشان مسار الصوت المرسل
      // يفضل ثابت طول المكالمة، وتبديل المستوى/التشغيل ما يعملش انقطاع.
      try {
        const engine = getDenoiseEngine();
        const result = await engine.start(rawStream, {
          enabled: isNoiseSuppressionEnabled,
          level: noiseLevelRef.current,
        });

        if (result.track) audioTrack = result.track;
        noiseActive = isNoiseSuppressionEnabled && result.active;

        // تطبيق مستوى صوت المايك الحالي
        engine.setMicGain(micVolume);

        if (isNoiseSuppressionEnabled && !result.active) {
          await applyNativeNoiseFallback(rawStream);
          toast.warning('AI noise suppression is unavailable; microphone noise reduction remains enabled.');
        }
      } catch (error) {
        console.warn('[NoiseSuppression] Could not start the denoise engine:', error);
        destroyDenoiseEngine();
        audioTrack = rawStream.getAudioTracks()[0];
        noiseActive = false;
        if (isNoiseSuppressionEnabled) {
          await applyNativeNoiseFallback(rawStream);
          toast.warning('AI noise suppression is unavailable; microphone noise reduction remains enabled.');
        }
      }

      noiseSuppressionActiveRef.current = noiseActive;
      setIsNoiseSuppressionActive(noiseActive);

      // نفصل الـ stream المحلي عن الـ stream الخام (raw) في كائن مستقل.
      // ده مهم جداً: أي إضافة/إزالة tracks أثناء المكالمة ما تأثرش على مصدر
      // إزالة الضوضاء => ما يحصلش صوت من طرف واحد.
      const outputStream = new MediaStream();
      if (audioTrack) outputStream.addTrack(audioTrack);

      rawStream.getVideoTracks().forEach((track) => {
        if (!outputStream.getVideoTracks().some((item) => item.id === track.id)) {
          outputStream.addTrack(track);
        }
      });

      return outputStream;
    } catch (e) {
      console.error('[Media] microphone unavailable:', e);
      throw e;
    }
  };

  const microphoneErrorMessage = (error) => (
    ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error?.name)
      ? 'Could not access your microphone. Check its permission and selected device.'
      : null
  );

  const cameraAccessErrorMessage = (error) => {
    switch (error?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission is blocked. Allow camera access for Discord Lite in Windows Privacy settings, then restart the app.';
      case 'NotFoundError':
        return 'No camera was found. Connect a camera and try again.';
      case 'NotReadableError':
        return 'The camera is already in use by another app. Close that app and try again.';
      case 'OverconstrainedError':
        return 'The camera could not meet the requested video settings. Check the camera and try again.';
      case 'AbortError':
        return 'The camera could not start. Close other apps using it and try again.';
      default:
        return null;
    }
  };

  const callErrorMessage = (error, fallback) => {
    const microphoneMessage = microphoneErrorMessage(error);
    if (microphoneMessage) return microphoneMessage;
    if (typeof error?.message === 'string' && error.message.trim()) {
      return `${fallback}: ${error.message}`;
    }
    return fallback;
  };

  const refreshCallParticipants = async (roomId, roomData = null) => {
    let participants;
    try {
      ({ participants } = roomData || await callApi(token, `/${roomId}`));
    } catch (error) {
      console.error('[Call] Failed to load participants:', error);
      toast.error('Could not load the call participants.');
      return [];
    }

    if (dbCallIdRef.current !== roomId || !localMembershipActiveRef.current) {
      return [];
    }

    const participantsChanged = JSON.stringify(callParticipantsRef.current) !== JSON.stringify(participants);
    callParticipantsRef.current = participants;
    if (participantsChanged) setCallParticipants(participants);
    if (roomRef.current && participants.some((participant) => (
      participant.user_id !== user?.id && participant.status === 'active'
    ))) {
      markCallConnected();
    }
    if (participantsChanged) {
      setActiveCall((previous) => previous?.roomId === roomId
        ? {
          ...previous,
          participants,
          friend: participants.find((participant) => participant.user_id !== user?.id)?.user || previous.friend,
        }
        : previous);
    }
    return participants;
  };

  const triggerIncoming = async (invitation) => {
    if (activeCallRef.current || incomingCallRef.current || pendingIncomingRoomRef.current) return;
    const now = Date.now();
    dismissedIncomingRoomsRef.current.forEach((expiresAt, roomId) => {
      if (expiresAt <= now) dismissedIncomingRoomsRef.current.delete(roomId);
    });
    if (dismissedIncomingRoomsRef.current.has(invitation.roomId)) return;
    pendingIncomingRoomRef.current = invitation.roomId;

    try {
      const { room } = await callApi(token, `/${invitation.roomId}`);
      if (room.status !== 'active') return;
      const incoming = {
        callId: invitation.roomId,
        roomId: invitation.roomId,
        callerId: invitation.callerId,
        callerName: invitation.callerName,
        caller: invitation.caller,
      };
      incomingCallRef.current = incoming;
      dbCallIdRef.current = invitation.roomId;
      setIncomingCall(incoming);
    } catch (error) {
      console.error('[Call] Failed to prepare incoming call:', error);
    } finally {
      pendingIncomingRoomRef.current = null;
    }
  };

  useCallRoomSync({
    token,
    userId: user?.id,
    activeRoomId: activeCall?.roomId,
    incomingRoomId: incomingCall?.roomId,
    onInvitation: triggerIncoming,
    onActiveRoom: (roomData) => refreshCallParticipants(roomData.room.id, roomData),
    onIncomingRoomEnded: () => endCallCleanupRef.current?.(true),
    onActiveRoomEnded: () => endCallCleanupRef.current?.(false),
  });

  useEffect(() => {
    const timers = offlineTimersRef.current;
    const otherActiveParticipants = activeCall
      ? callParticipants.filter((participant) => (
        participant.user_id !== user?.id && participant.status === 'active'
      ))
      : [];
    const activeParticipantIds = new Set(
      otherActiveParticipants.map((participant) => participant.user_id),
    );

    for (const [participantId, timer] of timers) {
      if (onlineUsers.has(participantId) || !activeParticipantIds.has(participantId)) {
        clearTimeout(timer);
        timers.delete(participantId);
      }
    }

    for (const participant of otherActiveParticipants) {
      if (onlineUsers.has(participant.user_id) || timers.has(participant.user_id)) continue;

      const timer = setTimeout(() => {
        timers.delete(participant.user_id);
        const online = onlineUsersRef.current;
        if (!user?.id || !online.has(user.id)) return;

        const anyoneOnline = callParticipantsRef.current.some((currentParticipant) => (
          currentParticipant.user_id !== user.id
          && currentParticipant.status === 'active'
          && online.has(currentParticipant.user_id)
        ));
        if (!anyoneOnline) {
          toast.info('The other person disconnected.');
          endCallCleanupRef.current?.(true);
        }
      }, OFFLINE_GRACE_MS);
      timers.set(participant.user_id, timer);
    }
  }, [onlineUsers, callParticipants, activeCall, user?.id, toast]);

  useEffect(() => () => {
    offlineTimersRef.current.forEach((timer) => clearTimeout(timer));
    offlineTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!incomingCall || !user?.id) return undefined;
    if (!onlineUsers.has(user.id) || onlineUsers.has(incomingCall.callerId)) return undefined;

    const timer = setTimeout(() => {
      const online = onlineUsersRef.current;
      if (online.has(user.id) && !online.has(incomingCall.callerId)) {
        endCallCleanupRef.current?.(true);
      }
    }, OFFLINE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [incomingCall, onlineUsers, user?.id]);

  useEffect(() => {
    if (!activeCall?.roomId || callStatus !== 'calling') return undefined;

    const timer = setTimeout(() => {
      toast.info('No answer.');
      endCallCleanupRef.current?.(true);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [activeCall?.roomId, callStatus, toast]);

  // ─────────────────────────────────────────────────────
  // 4. Start a direct call; participants can invite others after joining
  // ─────────────────────────────────────────────────────
  const startCall = async (friend, isVideo = false) => {
    if (!friend?.id || !user?.id) return;
    if (friend.id === user.id) {
      toast.warning("You can't start a call with yourself.");
      return;
    }
    if (activeCallRef.current || incomingCallRef.current) {
      toast.warning('You are already in a call.');
      return;
    }
    try {
      if (!await requestMediaPermission(isVideo ? 'camera' : 'microphone')) return;
      const stream = await acquireMediaStream({ includeVideo: isVideo });
      localStreamRef.current = stream;

      const { room } = await callApi(token, '', {
        method: 'POST',
        body: {
          targetUserId: friend.id,
          noiseSuppressionEnabled: noiseSuppressionActiveRef.current === true,
        },
      });

      dbCallIdRef.current = room.id;
      localMembershipActiveRef.current = true;
      const participants = [
        { user_id: user.id, status: 'active', noise_suppression_enabled: noiseSuppressionActiveRef.current === true, user },
        { user_id: friend.id, status: 'invited', noise_suppression_enabled: true, user: friend },
      ];
      callParticipantsRef.current = participants;
      setCallParticipants(participants);
      const callState = { roomId: room.id, callId: room.id, friend, isVideo, participants };
      callConnectedAtRef.current = null;
      setCallConnectedAt(null);
      activeCallRef.current = callState;
      setActiveCall(callState);
      setIsMuted(false);
      setIsDeafened(false);
      mutedBeforeDeafenRef.current = false;
      localCallStateRef.current = {
        muted: false,
        deafened: false,
        camera: isVideo,
        screen: false,
        videoCall: isVideo,
        noiseSuppressionActive: noiseSuppressionActiveRef.current,
      };
      cameraEnabledRef.current = isVideo;
      setIsVideoEnabled(isVideo);
      setCallStatus('calling');
      await connectLiveKitRoom(room.id);
    } catch (err) {
      console.error('[startCall] error:', err);
      if (dbCallIdRef.current) {
        endCallCleanupRef.current?.(true);
      } else {
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
        rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
        rawMicStreamRef.current = null;
        destroyDenoiseEngine();
        disposeScreenAudio();
      }
      toast.error(callErrorMessage(err, 'Could not start the call'));
    }
  };

  // ─────────────────────────────────────────────────────
  // 5. Answer an incoming room invitation
  // ─────────────────────────────────────────────────────
  const answerCall = async () => {
    const inc = incomingCallRef.current;
    if (!inc || answeringCallRef.current) return false;
    answeringCallRef.current = true;
    let acceptedMembership = false;

    try {
      if (!await requestMediaPermission('microphone')) return false;
      const { room } = await callApi(token, `/${inc.roomId}`);
      if (room?.status !== 'active') {
        toast.warning('This call has already ended.');
        endCallCleanup(false);
        return false;
      }

      const stream = await acquireMediaStream();
      localStreamRef.current = stream;
      await callApi(token, `/${inc.roomId}/answer`, {
        method: 'POST',
        body: {
          noiseSuppressionEnabled: noiseSuppressionActiveRef.current,
        },
      });
      acceptedMembership = true;

      dbCallIdRef.current = inc.roomId;
      localMembershipActiveRef.current = true;
      const participants = await refreshCallParticipants(inc.roomId);
      if (participants.length === 0) throw new Error('Could not load members of the call.');
      setIsMuted(false);
      setIsDeafened(false);
      mutedBeforeDeafenRef.current = false;
      const isVideoCall = pendingVideoCallRef.current;
      const callState = {
        roomId: inc.roomId,
        callId: inc.roomId,
        friend: inc.caller,
        isVideo: isVideoCall,
        participants,
      };
      localCallStateRef.current = {
        muted: false,
        deafened: false,
        camera: false,
        screen: false,
        videoCall: isVideoCall,
        noiseSuppressionActive: noiseSuppressionActiveRef.current,
      };
      activeCallRef.current = callState;
      setActiveCall(callState);
      incomingCallRef.current = null;
      setIncomingCall(null);
      pendingVideoCallRef.current = false;
      await connectLiveKitRoom(inc.roomId);
      return true;
    } catch (err) {
      console.error('[answerCall] error:', err);
      localMembershipActiveRef.current = false;
      const invitationExpired = [
        'This call invitation is no longer active.',
        'This call has already ended.',
      ].includes(err.message);
      if (invitationExpired) {
        toast.warning('This call invitation is no longer available.');
        incomingCallRef.current = null;
        dbCallIdRef.current = null;
        setIncomingCall(null);
      } else {
        toast.error(callErrorMessage(err, 'Could not join the call'));
      }
      if (acceptedMembership) {
        try {
          await callApi(token, `/${inc.roomId}/leave`, {
            method: 'POST',
            body: { status: 'left' },
          });
        } catch (rollbackError) {
          console.error('[answerCall] Membership rollback failed:', rollbackError);
        }
        incomingCallRef.current = null;
        dbCallIdRef.current = null;
        setIncomingCall(null);
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
      rawMicStreamRef.current = null;
      destroyDenoiseEngine();
      disposeScreenAudio();
      if (activeCallRef.current?.roomId === inc.roomId) endCallCleanupRef.current?.(false);
      return false;
    } finally {
      answeringCallRef.current = false;
    }
  };

  const inviteParticipants = async (friendsToInvite) => {
    const roomId = activeCallRef.current?.roomId;
    if (!roomId || !Array.isArray(friendsToInvite) || friendsToInvite.length === 0) return;

    const existingIds = new Set(callParticipantsRef.current
      .filter((participant) => ['active', 'invited'].includes(participant.status))
      .map((participant) => participant.user_id));
    const newFriends = friendsToInvite.filter((friend) => friend?.id && !existingIds.has(friend.id));
    if (newFriends.length === 0) {
      toast.info('Those friends are already in this call or invited.');
      return;
    }

    let invitedCount;
    try {
      ({ invited: invitedCount } = await callApi(token, `/${roomId}/invitations`, {
        method: 'POST',
        body: { userIds: newFriends.map((friend) => friend.id) },
      }));
    } catch (error) {
      console.error('[Call] Failed to invite participants:', error);
      toast.error('Could not invite those friends.');
      return;
    }

    await refreshCallParticipants(roomId);
    if (invitedCount === 0) {
      toast.info('Those friends are already in this call or invited.');
      return;
    }
    toast.success(`Invited ${invitedCount} friend${invitedCount === 1 ? '' : 's'}.`);
  };

  // ─────────────────────────────────────────────────────
  // 5. End Call — الدالة الرئيسية لإنهاء المكالمة
  // ─────────────────────────────────────────────────────
  // الدالة تُعاد بناؤها كل render عن قصد؛ نحدّث الـ ref أدناه بأحدث نسخة منها.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const endCallCleanup = (updateDb = true) => {
    denoiseGenerationRef.current += 1;
    const roomId = dbCallIdRef.current;
    const hadCall = !!activeCallRef.current || !!incomingCallRef.current;
    const wasIncoming = !!incomingCallRef.current && !activeCallRef.current;
    if (wasIncoming && roomId) {
      dismissedIncomingRoomsRef.current.set(roomId, Date.now() + 60_000);
    }
    if (hadCall) playSoundEffect('disconnect');
    if (updateDb && roomId && user?.id) {
      (async () => {
        const status = wasIncoming ? 'declined' : 'left';
        try {
          await callApi(token, `/${roomId}/leave`, {
            method: 'POST',
            body: { status },
          });
        } catch (error) {
          console.error('[endCall] Failed to update participant status:', error);
          toast.error('Could not update your call status.');
        }
      })().catch((err) => {
        console.error('[endCall] Failed to update call room:', err);
      });
    }

    try {
      destroyDenoiseEngine();
      disposeScreenAudio();
      if (remoteDenoiseCleanupRef.current) {
        remoteDenoiseCleanupRef.current();
        remoteDenoiseCleanupRef.current = null;
      }
      if (rawMicStreamRef.current) {
        rawMicStreamRef.current.getTracks().forEach(t => t.stop());
        rawMicStreamRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.warn('[endCall] error stopping local tracks:', e);
    }

    try {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => {
          if (t.kind === 'video') t.onended = null;
          t.stop();
        });
      }
    } catch (e) {
      console.warn('[endCall] error stopping screen tracks:', e);
    }

    localStreamRef.current  = null;
    screenStreamRef.current = null;

    intentionalDisconnectRef.current = true;
    const room = roomRef.current;
    roomRef.current = null;
    localPublishedTracksRef.current.clear();
    remotePublishedTracksRef.current.clear();
    room?.disconnect().catch((error) => {
      console.warn('[LiveKit] Could not disconnect the room cleanly:', error);
    });
    setVoiceReady(false);

    remoteAudioElementsRef.current.forEach((element) => {
      element.pause();
      element.srcObject = null;
    });
    remoteAudioElementsRef.current.clear();
    remoteScreenAudioElementsRef.current.forEach((element) => {
      element.pause();
      element.srcObject = null;
    });
    remoteScreenAudioElementsRef.current.clear();
    remoteAudioRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    remoteStreamRef.current = null;
    remoteStreamOwnerRef.current = null;
    remoteStreamsRef.current = [];
    dbCallIdRef.current = null;
    localMembershipActiveRef.current = false;
    callConnectedAtRef.current = null;
    setCallConnectedAt(null);
    activeCallRef.current = null;
    incomingCallRef.current = null;
    pendingIncomingRoomRef.current = null;
    resolveMediaPermission(false);
    setIsScreenSharePickerOpen(false);
    cameraEnabledRef.current = false;
    pendingVideoCallRef.current = false;
    mutedBeforeDeafenRef.current = false;
    localCallStateRef.current = {
      muted: false,
      deafened: false,
      camera: false,
      screen: false,
      videoCall: false,
      noiseSuppressionActive: false,
    };
    setRemoteCallStates({});
    remoteCallStatesRef.current = {};
    noiseSuppressionActiveRef.current = false;
    setIsNoiseSuppressionActive(false);

    // 5. تصفير الـ state فوراً لغلق الشاشة
    stopCallRingtone();
    setActiveCall(null);
    setIncomingCall(null);
    setCallParticipants([]);
    callParticipantsRef.current = [];
    setRemoteStreams([]);
    setSpeakingUsers({});
    setCallStatus('idle');
    setIsMuted(false);
    setIsDeafened(false);
    setIsVideoEnabled(false);
    setIsScreenSharing(false);
    setIsRemoteScreenSharing(false);
    setIsRemoteCamera(false);
  };
  useEffect(() => {
    endCallCleanupRef.current = endCallCleanup;
  }, [endCallCleanup]);

  // نصدّر endCall كـ wrapper يقبل بدون argument أيضاً
  const endCall = (updateDb = true) => endCallCleanup(updateDb);

  // ─────────────────────────────────────────────────────
  // Speaking Detection (Audio Meter / Green Ring for Active Speakers)
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCall || callStatus !== 'connected') {
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;

    let meterCtx;
    try {
      meterCtx = new AudioContextConstructor();
    } catch {
      return;
    }

    const analysers = new Map(); // userId -> { analyser, dataArray }

    // 1. Local mic analyser
    const localTrack = localStreamRef.current?.getAudioTracks().find((track) => track.readyState === 'live');
    if (localTrack && user?.id && !isMuted) {
      try {
        const source = meterCtx.createMediaStreamSource(new MediaStream([localTrack]));
        const analyser = meterCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        analysers.set(user.id, {
          analyser,
          dataArray: new Uint8Array(analyser.frequencyBinCount),
          isLocal: true,
        });
      } catch (e) {
        console.warn('[SpeakingMeter] local setup error:', e);
      }
    }

    // 2. Remote streams analysers
    remoteStreams.forEach(({ userId, stream }) => {
      const remoteTrack = stream?.getAudioTracks().find((t) => t.readyState === 'live');
      if (remoteTrack && userId && !remoteCallStates[userId]?.muted) {
        try {
          const source = meterCtx.createMediaStreamSource(new MediaStream([remoteTrack]));
          const analyser = meterCtx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.4;
          source.connect(analyser);
          analysers.set(userId, {
            analyser,
            dataArray: new Uint8Array(analyser.frequencyBinCount),
            isLocal: false,
          });
        } catch (e) {
          console.warn('[SpeakingMeter] remote setup error for', userId, e);
        }
      }
    });

    let animId;
    let lastState = {};

    const checkAudioLevels = () => {
      const nextSpeaking = {};

      analysers.forEach(({ analyser, dataArray, isLocal }, uid) => {
        if (isLocal && isMuted) {
          nextSpeaking[uid] = false;
          return;
        }
        if (!isLocal && remoteCallStates[uid]?.muted) {
          nextSpeaking[uid] = false;
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        // Threshold for human voice activity in average frequency energy
        nextSpeaking[uid] = average > 12;
      });

      // Avoid unnecessary re-renders
      let changed = false;
      const allUids = new Set([...Object.keys(lastState), ...Object.keys(nextSpeaking)]);
      for (const uid of allUids) {
        if (!!lastState[uid] !== !!nextSpeaking[uid]) {
          changed = true;
          break;
        }
      }

      if (changed) {
        lastState = nextSpeaking;
        setSpeakingUsers(nextSpeaking);
      }

      animId = requestAnimationFrame(checkAudioLevels);
    };

    animId = requestAnimationFrame(checkAudioLevels);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      meterCtx?.close?.().catch?.(() => {});
      setSpeakingUsers({});
    };
  }, [activeCall, callStatus, remoteStreams, isMuted, remoteCallStates, user?.id]);

  // ─────────────────────────────────────────────────────
  // 6. Toggle Mute (كتم المايك محلياً وفي شبكة الـ WebRTC فوراً)
  // ─────────────────────────────────────────────────────
  const toggleMute = () => {
    if (isDeafened && isMuted) {
      toast.info('Undeafen before unmuting your microphone.');
      return;
    }

    const next = !isMuted;
    playSoundEffect('mute');
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    publishCallState({ muted: next });
  };

  // ─────────────────────────────────────────────────────
  // 7. Toggle Deafen (كتم سماع صوت الطرف الآخر تماماً)
  // ─────────────────────────────────────────────────────
  const toggleDeafen = () => {
    const next = !isDeafened;
    playSoundEffect('deafen');
    setIsDeafened(next);
    remoteAudioElementsRef.current.forEach((element) => {
      element.muted = next;
      element.volume = next ? 0 : Math.min(1, Math.max(0, speakerVolume > 1 ? 1 : speakerVolume));
    });

    let muted = isMuted;
    if (next) {
      mutedBeforeDeafenRef.current = isMuted;
      muted = true;
    } else {
      muted = mutedBeforeDeafenRef.current;
    }

    setIsMuted(muted);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    publishCallState({ muted, deafened: next });
  };

  // ─────────────────────────────────────────────────────
  // 8. Toggle Camera
  // ─────────────────────────────────────────────────────
  async function toggleCamera() {
    if (cameraTogglePendingRef.current) return;
    if (screenStreamRef.current) {
      toast.info('Stop screen sharing before changing the camera.');
      return;
    }

    cameraTogglePendingRef.current = true;
    let cameraStream = null;
    try {
      if (cameraEnabledRef.current) {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        await unpublishLiveKitTrack('camera');
        if (cameraTrack) localStreamRef.current?.removeTrack(cameraTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        cameraEnabledRef.current = false;
        setIsVideoEnabled(false);
        publishCallState({ camera: false });
        return;
      }

      if (!await requestMediaPermission('camera')) return;
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      const acquiredTrack = cameraStream.getVideoTracks()[0];
      if (!acquiredTrack) throw new Error('Camera access succeeded, but no video track was provided.');
      acquiredTrack.contentHint = 'motion';

      await publishLiveKitTrack(acquiredTrack, 'camera', Track.Source.Camera, {
        videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 },
        degradationPreference: 'maintain-framerate',
      });
      localStreamRef.current?.addTrack(acquiredTrack);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = new MediaStream([acquiredTrack]);
        localVideoRef.current.play().catch(() => {});
      }

      cameraEnabledRef.current = true;
      setIsVideoEnabled(true);
      publishCallState({ camera: true });
    } catch (error) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      console.error('[toggleCamera]', error);
      const accessMessage = cameraAccessErrorMessage(error);
      toast.error(accessMessage || `The camera could not be connected to the call: ${error.message}`);
    } finally {
      cameraTogglePendingRef.current = false;
    }
  }

  const stopScreenShare = async () => {
    const stream = screenStreamRef.current;
    if (!stream) return;
    screenStreamRef.current = null;
    stream.getVideoTracks().forEach((track) => { track.onended = null; });
    if (screenAudioTrackRef.current) screenAudioTrackRef.current.onended = null;

    const unpublishResults = await Promise.all([
      unpublishLiveKitTrack('screen'),
      unpublishLiveKitTrack('screenAudio'),
    ].map((promise) => promise.catch((error) => {
      console.error('[ScreenShare] Could not unpublish a screen track:', error);
      return error;
    })));
    stream.getTracks().forEach((track) => track.stop());
    screenAudioTrackRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = cameraEnabledRef.current && localStreamRef.current
        ? localStreamRef.current
        : null;
    }
    setIsScreenSharing(false);
    publishCallState({ screen: false, screenAudio: false });
    if (unpublishResults.some((result) => result instanceof Error)) {
      toast.error('Could not stop screen sharing cleanly.');
    }
  };

  const startScreenShare = async (displaySurface) => {
    setIsScreenSharePickerOpen(false);
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: { ideal: displaySurface },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true,
        systemAudio: 'include',
      });
      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('Screen capture did not provide a video track.');
      screenTrack.contentHint = 'detail';
      screenStreamRef.current = stream;
      await publishLiveKitTrack(screenTrack, 'screen', Track.Source.ScreenShare, {
        screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
        degradationPreference: 'maintain-resolution',
      });

      const screenAudioTrack = stream.getAudioTracks()[0] || null;
      let screenAudioShared = false;
      if (screenAudioTrack) {
        screenAudioTrack.contentHint = 'music';
        try {
          await publishLiveKitTrack(screenAudioTrack, 'screenAudio', Track.Source.ScreenShareAudio);
          screenAudioTrackRef.current = screenAudioTrack;
          screenAudioShared = true;
          screenAudioTrack.onended = () => {
            unpublishLiveKitTrack('screenAudio').catch((error) => {
              console.error('[ScreenShare] Could not unpublish system audio:', error);
            });
            screenAudioTrackRef.current = null;
            publishCallState({ screenAudio: false });
          };
        } catch (error) {
          console.error('[ScreenShare] Could not publish system audio:', error);
          toast.warning('Screen video is shared, but its audio could not be connected.');
        }
      } else {
        toast.info('Screen audio is unavailable for the selected source.');
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = new MediaStream([screenTrack]);
        localVideoRef.current.play().catch(() => {});
      }
      setIsScreenSharing(true);
      publishCallState({ screen: true, screenAudio: screenAudioShared });
      screenTrack.onended = () => {
        stopScreenShare().catch((error) => console.error('[ScreenShare] Stop failed:', error));
      };
    } catch (error) {
      console.error('[toggleScreenShare]', error);
      if (screenStreamRef.current === stream) screenStreamRef.current = null;
      await Promise.all([
        unpublishLiveKitTrack('screen').catch((unpublishError) => {
          console.error('[ScreenShare] Could not remove the screen video publication:', unpublishError);
        }),
        unpublishLiveKitTrack('screenAudio').catch((unpublishError) => {
          console.error('[ScreenShare] Could not remove the screen audio publication:', unpublishError);
        }),
      ]);
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenAudioTrackRef.current = null;
      setIsScreenSharing(false);
      publishCallState({ screen: false, screenAudio: false });
      toast.error('Could not start screen sharing. Check display-capture permission and try again.');
    }
  };

  const toggleScreenShare = async () => {
    if (screenStreamRef.current) {
      await stopScreenShare();
      return;
    }
    if (callStatus !== 'connected') {
      toast.info('Wait until the call is connected before sharing your screen.');
      return;
    }
    setIsScreenSharePickerOpen(true);
  };

  // يعيد فتح المايك لو المسار الخام اتوقف لأي سبب (مثلاً بعد تبديل قديم)،
  // حتى لا نبني سلسلة إزالة ضوضاء من مصدر صامت فيصبح الصوت من طرف واحد.
  const ensureLiveRawMicStream = async () => {
    const current = rawMicStreamRef.current;
    if (current?.getAudioTracks().some((track) => track.readyState === 'live')) return current;

    const constraints = {
      echoCancellation: true,
      noiseSuppression: {
        ideal: isNoiseSuppressionEnabled && noiseLevelRef.current === 'voiceFocus',
      },
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000,
    };
    if (selectedMic && selectedMic !== 'default') constraints.deviceId = { exact: selectedMic };

    const fresh = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    // التخلّص من المايك القديم المتوقف حتى لا يفضل مفتوحاً في الخلفية
    current?.getTracks().forEach((track) => track.stop());
    rawMicStreamRef.current = fresh;
    return fresh;
  };

  const applyLiveNoiseSuppression = async (enabled, level) => {
    const roomId = activeCallRef.current?.roomId;
    const localStream = localStreamRef.current;
    if (!roomId || !localStream) return;

    // رقم الجيل يمنع تتالي التبديلات السريعة من إبقاء حالة قديمة هي الظاهرة
    const generation = denoiseGenerationRef.current + 1;
    denoiseGenerationRef.current = generation;

    try {
      let active = false;
      await applyVoiceFocusNoiseSuppression(
        rawMicStreamRef.current,
        enabled && level === 'voiceFocus',
      );
      if (denoiseGenerationRef.current !== generation) return;

      const engine = denoiseEngineRef.current;

      if (engine && !engine.destroyed) {
        // نفس الـ graph ونفس المسار المرسل: تبديل المستوى بيحصل بـ crossfade
        // جوه الصوت، فمفيش replaceTrack ومفيش انقطاع.
        if (enabled) await engine.setLevel(level);
        active = await engine.setEnabled(enabled);
        if (denoiseGenerationRef.current !== generation) return;

        if (enabled && !active) {
          await applyNativeNoiseFallback(rawMicStreamRef.current);
          toast.warning('AI noise suppression could not start; microphone noise reduction remains enabled.');
        }
      } else if (enabled) {
        // مفيش محرك شغال (فشل تشغيله وقت بداية المكالمة) — نبني واحد ونربطه
        const rawStream = await ensureLiveRawMicStream();
        if (denoiseGenerationRef.current !== generation) return;

        const created = getDenoiseEngine();
        const result = await created.start(rawStream, { enabled: true, level });
        if (denoiseGenerationRef.current !== generation) {
          destroyDenoiseEngine();
          return;
        }
        if (!result.track) throw new Error('Noise suppression did not produce an audio track.');

        result.track.enabled = !localCallStateRef.current.muted;
        await publishLiveKitTrack(result.track, 'microphone', Track.Source.Microphone);

        // مهم: لو المسار القديم هو نفسه مايك المصدر الخام، ممنوع نوقفه
        // وإلا المحرك الجديد هيقرأ من مسار ميت => صوت صامت من طرف واحد.
        const rawTrack = rawStream.getAudioTracks()[0];
        const oldTrack = localStream.getAudioTracks()[0];
        if (oldTrack && oldTrack !== result.track) localStream.removeTrack(oldTrack);
        if (!localStream.getAudioTracks().includes(result.track)) localStream.addTrack(result.track);
        if (oldTrack && oldTrack !== result.track && oldTrack !== rawTrack) oldTrack.stop();

        active = result.active;
        if (!active) {
          await applyNativeNoiseFallback(rawStream);
          toast.warning('AI noise suppression could not start; microphone noise reduction remains enabled.');
        }
      }

      noiseSuppressionActiveRef.current = active;
      setIsNoiseSuppressionActive(active);
      publishCallState({ noiseSuppressionActive: active });

      await callApi(token, `/${roomId}/noise`, {
        method: 'PATCH',
        body: { enabled: active },
      });

      const updatedParticipants = callParticipantsRef.current.map((participant) => (
        participant.user_id === user.id
          ? { ...participant, noise_suppression_enabled: active }
          : participant
      ));
      callParticipantsRef.current = updatedParticipants;
      setCallParticipants(updatedParticipants);
    } catch (error) {
      console.error('[NoiseSuppression] live switch failed:', error);
      toast.error('Could not change noise suppression for the live call.');
    }
  };

  const toggleNoiseSuppression = async () => {
    const next = !isNoiseSuppressionEnabled;
    setIsNoiseSuppressionEnabled(next);
    toast.info(next ? 'AI Noise Suppression enabled' : 'AI Noise Suppression disabled');
    await applyLiveNoiseSuppression(next, noiseLevelRef.current);
  };

  const changeNoiseLevel = async (level) => {
    if (!NOISE_LEVELS.includes(level) || level === noiseLevelRef.current) return;
    noiseLevelRef.current = level;
    setNoiseLevel(level);
    toast.info(`Noise suppression: ${NOISE_LEVEL_LABELS[level]}`);
    if (isNoiseSuppressionEnabled) await applyLiveNoiseSuppression(true, level);
  };

  // ─────────────────────────────────────────────────────
  // Context Value
  // ─────────────────────────────────────────────────────
  return (
    <VoiceContext.Provider value={{
      voiceReady,
      activeCall,
      callParticipants,
      remoteStreams,
      remoteCallStates,
      incomingCall,
      callStatus,
      callConnectedAt,
      isMuted,
      isDeafened,
      isVideoEnabled,
      isScreenSharing,
      isRemoteScreenSharing,
      isRemoteCamera,
      isNoiseSuppressionEnabled,
      isNoiseSuppressionActive,
      noiseLevel,
      toggleNoiseSuppression,
      changeNoiseLevel,
      microphones,
      speakers,
      selectedMic,
      selectedSpeaker,
      micVolume,
      speakerVolume,
      changeMicVolume,
      changeSpeakerVolume,
      speakingUsers,
      participantAudioSettings,
      streamAudioSettings,
      setParticipantVolume,
      setParticipantMuted,
      setStreamVolume,
      setStreamMuted,
      playNotificationSound,
      changeMicrophone,
      changeSpeaker,
      updateAudioDevices,
      localVideoRef,
      remoteVideoRef,
      remoteAudioRef,
      remoteAudioElementsRef,
      remoteScreenAudioElementsRef,
      remoteStreamRef,
      localStreamRef,
      screenStreamRef,
      startCall,
      inviteParticipants,
      answerCall,
      endCall,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      toggleScreenShare
    }}>
      {children}
      <MediaPermissionModal
        request={mediaPermissionRequest}
        onContinue={() => resolveMediaPermission(true)}
        onCancel={() => resolveMediaPermission(false)}
      />
      <ScreenSharePicker
        open={isScreenSharePickerOpen}
        onCancel={() => setIsScreenSharePickerOpen(false)}
        onSelect={startScreenShare}
      />
    </VoiceContext.Provider>
  );
};

export const useVoice = () => useContext(VoiceContext);
