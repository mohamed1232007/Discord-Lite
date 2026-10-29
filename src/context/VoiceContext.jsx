import { createContext, useContext, useEffect, useState, useRef } from 'react';
import Peer from 'peerjs';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { supabase } from '../services/supabaseClient';
import { applyRnnoiseDenoise } from '../services/denoiser';
import { callApi } from '../services/callApi';
import { useCallRoomSync } from '../hooks/useCallRoomSync';

const VoiceContext = createContext({});
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL;
// عناوين TURN مخصّصة (مفصولة بفواصل). لو فاضية نستخدم مزوّد relay.metered.ca الافتراضي.
const TURN_URLS = (import.meta.env.VITE_TURN_URL || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const DEFAULT_TURN_URLS = [
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:443',
  'turn:global.relay.metered.ca:443?transport=tcp',
];
const SELECTED_MIC_STORAGE_KEY = 'dis_lite_selected_mic';
const SELECTED_SPEAKER_STORAGE_KEY = 'dis_lite_selected_speaker';
const PARTICIPANT_AUDIO_STORAGE_KEY = 'dis_lite_participant_audio';
const NOISE_LEVEL_STORAGE_KEY = 'dis_lite_noise_level';
const NOISE_LEVELS = ['standard', 'strong', 'max'];
const NOISE_LEVEL_LABELS = { standard: 'Standard', strong: 'Strong', max: 'Maximum' };

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
              ? Math.min(1, Math.max(0, settings.volume))
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

const getSavedAudioDevice = (storageKey) => {
  try {
    return window.localStorage.getItem(storageKey) || 'default';
  } catch (error) {
    console.warn('[Audio] Could not restore saved device selection:', error);
    return 'default';
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
    await track.applyConstraints({ noiseSuppression: true, autoGainControl: true });
  } catch (error) {
    console.warn('[Audio] Could not enable native noise suppression fallback:', error);
  }
};

export const VoiceProvider = ({ children }) => {
  const { user, token, onlineUsers } = useAuth();
  const toast = useToast();

  // ── State ──────────────────────────────────────────────
  const [activeCall,      setActiveCall]     = useState(null);
  const [incomingCall,    setIncomingCall]   = useState(null);
  const [callStatus,      setCallStatus]     = useState('idle'); // 'idle' | 'calling' | 'ringing' | 'connected'
  const [isMuted,         setIsMuted]        = useState(false);
  const [isDeafened,      setIsDeafened]     = useState(false);
  const [isVideoEnabled,  setIsVideoEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing]= useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [isRemoteCamera,        setIsRemoteCamera]        = useState(false);
  const [remoteCallStates, setRemoteCallStates] = useState({});
  const [peerReady,       setPeerReady]      = useState(false);
  const [callParticipants, setCallParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const remoteCallStatesRef = useRef({});

  // ── Audio Devices State ────────────────────────────────
  const [microphones,     setMicrophones]    = useState([]);
  const [speakers,        setSpeakers]       = useState([]);
  const [selectedMic,     setSelectedMic]    = useState(() => getSavedAudioDevice(SELECTED_MIC_STORAGE_KEY));
  const [selectedSpeaker, setSelectedSpeaker]= useState(() => getSavedAudioDevice(SELECTED_SPEAKER_STORAGE_KEY));
  const [participantAudioSettings, setParticipantAudioSettings] = useState(getSavedParticipantAudio);
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] = useState(true);
  const [isNoiseSuppressionActive, setIsNoiseSuppressionActive] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState(getSavedNoiseLevel);

  // ── Refs (لا تتغيرش بين renders) ──────────────────────
  const peerRef         = useRef(null);      // PeerJS instance
  const peerIdRef       = useRef(null);
  const cameraEnabledRef = useRef(false);
  const cameraTogglePendingRef = useRef(false);
  const pendingVideoCallRef = useRef(false);
  const mutedBeforeDeafenRef = useRef(false);
  const peerCallRef     = useRef(null);      // MediaConnection الحالية
  const peerCallsRef    = useRef(new Map());
  const pendingCallRef  = useRef(new Map()); // مكالمات PeerJS الواردة حسب المشارك
  const localStreamRef  = useRef(null);
  const rawMicStreamRef = useRef(null);      // Raw mic stream قبل الفلتر
  const denoiseCleanupRef = useRef(null);    // دالة تنظيف RNNoise
  const denoiseGenerationRef = useRef(0);
  const noiseSuppressionActiveRef = useRef(false);
  const remoteStreamRef = useRef(null);
  const remoteStreamsRef = useRef([]);
  const remoteDenoiseCleanupRef = useRef(null); // تنظيف فلتر الطرف المستقبل
  const remoteAudioElementsRef = useRef(new Map());
  const screenStreamRef = useRef(null);
  const dbCallIdRef     = useRef(null);
  const activeCallRef   = useRef(null);      // mirror of activeCall state (للـ closures)
  const mediaChannelRef = useRef(null);
  const localCallStateRef = useRef({
    muted: false,
    deafened: false,
    camera: false,
    screen: false,
    videoCall: false,
    noiseSuppressionActive: false,
  });
  const dataConnectionRef = useRef(new Map());
  const incomingCallRef = useRef(incomingCall);
  const pendingIncomingRoomRef = useRef(null);
  const callParticipantsRef = useRef(callParticipants);
  const localMembershipActiveRef = useRef(false);
  const endCallCleanupRef = useRef(null);
  const onlineUsersRef = useRef(onlineUsers);
  const offlineTimersRef = useRef(new Map());
  const turnWarningShownRef = useRef(false);
  const OFFLINE_GRACE_MS = 10_000;
  const noiseLevelRef = useRef(noiseLevel);

  useEffect(() => {
    onlineUsersRef.current = onlineUsers;
  }, [onlineUsers]);

  useEffect(() => {
    noiseLevelRef.current = noiseLevel;
    try {
      window.localStorage.setItem(NOISE_LEVEL_STORAGE_KEY, noiseLevel);
    } catch (error) {
      console.error('[Audio] Could not save noise suppression level:', error);
    }
  }, [noiseLevel]);

  const warnIfTurnIsUnavailable = () => {
    if (TURN_USERNAME && TURN_CREDENTIAL) return;
    if (!turnWarningShownRef.current) {
      toast.warning('TURN is not configured. Calls may fail on restrictive networks.');
      turnWarningShownRef.current = true;
    }
  };

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
        noiseSuppressionActive: !!payload.noiseSuppressionActive,
        synced: true,
      };
      updateRemoteCallState(payload.senderId, state);
      if (payload.videoCall && activeCallRef.current) {
        activeCallRef.current = { ...activeCallRef.current, isVideo: true };
        setActiveCall(activeCallRef.current);
        if (!cameraEnabledRef.current) toggleCamera();
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
        if (!cameraEnabledRef.current) toggleCamera();
      }
    }
  };

  // إعداد قناة البيانات المباشرة WebRTC P2P DataChannel
  const setupDataConnection = (conn) => {
    if (!conn) return;
    dataConnectionRef.current.set(conn.peer, conn);
    conn.on('open', () => {
      conn.send({
        type: 'call_state',
        ...localCallStateRef.current,
        senderId: user?.id,
      });
    });
    conn.on('data', (data) => {
      applyRemoteCallState(data);
    });
    conn.on('close', () => {
      if (dataConnectionRef.current.get(conn.peer) === conn) {
        dataConnectionRef.current.delete(conn.peer);
      }
    });
    conn.on('error', (err) => console.warn('[PeerData error]', err));
  };

  // إرسال حالة الميديا فورياً للطرف الآخر
  const sendMediaSignal = (payload) => {
    const fullPayload = { ...payload, senderId: user?.id };
    // 1. إرسال فوري P2P عبر WebRTC DataChannel (أسرع وأضمن)
    dataConnectionRef.current.forEach((connection) => {
      if (!connection.open) return;
      try {
        connection.send(fullPayload);
      } catch (err) {
        console.warn('[PeerData send error]', err);
      }
    });
    // 2. إرسال عبر Supabase Realtime broadcast
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

  const getPeerCalls = () => Array.from(peerCallsRef.current.values());
  const replacePeerTrack = async (kind, track, quality = null) => {
    await Promise.all(getPeerCalls().map(async (call) => {
      const pc = call.peerConnection;
      if (!pc) return;
      const sender = pc.getSenders().find((item) => item.track?.kind === kind)
        || pc.getTransceivers?.().find((item) => item.receiver?.track?.kind === kind)?.sender;
      if (!sender) return;
      await sender.replaceTrack(track);
      if (quality && sender.getParameters && sender.setParameters) {
        const parameters = sender.getParameters();
        if (parameters.encodings?.length) {
          parameters.encodings = parameters.encodings.map((encoding) => ({
            ...encoding,
            maxBitrate: quality.maxBitrate,
            ...(quality.maxFramerate ? { maxFramerate: quality.maxFramerate } : {}),
            ...(kind === 'audio' ? { priority: 'high' } : {}),
          }));
          if (kind === 'video') {
            parameters.degradationPreference = quality.degradationPreference;
          }
          try {
            await sender.setParameters(parameters);
          } catch (error) {
            console.warn(`[Media] Could not apply preferred ${kind} encoding:`, error);
          }
        }
      }
    }));
  };
  const replaceLocalVideoTrack = async (nextTrack, quality = null) => {
    const stream = localStreamRef.current;
    const oldTracks = stream?.getVideoTracks() || [];

    await replacePeerTrack('video', nextTrack, quality);

    if (stream) {
      oldTracks.forEach((track) => stream.removeTrack(track));
      stream.addTrack(nextTrack);
    }
    oldTracks.forEach((track) => {
      if (track !== nextTrack) track.stop();
    });
  };
  const restoreVideoAfterScreenShare = async () => {
    const cameraTrack = cameraEnabledRef.current
      ? localStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live')
      : null;
    if (cameraTrack) {
      await replacePeerTrack('video', cameraTrack, {
        maxBitrate: 1_200_000,
        maxFramerate: 30,
        degradationPreference: 'maintain-framerate',
      });
      return;
    }

    const blankTrack = createBlankVideoTrack();
    if (!blankTrack) throw new Error('Could not create a fallback video track.');
    await replaceLocalVideoTrack(blankTrack);
  };
  const configurePeerAudio = async (call) => {
    const audioSender = call.peerConnection?.getSenders()
      .find((sender) => sender.track?.kind === 'audio');
    if (!audioSender?.getParameters || !audioSender?.setParameters) return;

    const parameters = audioSender.getParameters();
    if (!parameters.encodings?.length) return;
    parameters.encodings = parameters.encodings.map((encoding) => ({
      ...encoding,
      maxBitrate: 64_000,
      priority: 'high',
    }));
    try {
      await audioSender.setParameters(parameters);
    } catch (error) {
      console.warn('[Audio] Could not apply preferred audio encoding:', error);
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

  const setParticipantVolume = (participantId, volume) => {
    if (!participantId || !Number.isFinite(volume)) return;
    const nextVolume = Math.min(1, Math.max(0, volume));
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

  // دالة تغيير المايك
  const changeMicrophone = async (deviceId) => {
    // لو في مكالمة شغالة، نستبدل مسار الصوت فوراً مع تطبيق الـ RNNoise.
    // مهم: نبني كل شيء جديد قبل أن نلمس السلسلة الشغالة، وإلا ينقطع الصوت
    // للمشاركين طول مدة فتح المايك/تحميل موديلات إزالة الضوضاء.
    if (activeCall && localStreamRef.current) {
      const generation = denoiseGenerationRef.current + 1;
      denoiseGenerationRef.current = generation;

      try {
        const newRawStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
          },
        });

        let finalAudioTrack;
        let nextCleanup = null;
        let nextActive = false;

        if (isNoiseSuppressionEnabled) {
          const result = await applyRnnoiseDenoise(newRawStream, null, noiseLevelRef.current);
          // تغيير أحدث بدأ أثناء تجهيز هذا المايك — نتخلّص من النتيجة بدل استخدامها
          if (denoiseGenerationRef.current !== generation) {
            result.cleanup();
            newRawStream.getTracks().forEach((track) => track.stop());
            return;
          }
          nextCleanup = result.cleanup;
          finalAudioTrack = result.cleanStream.getAudioTracks()[0] || newRawStream.getAudioTracks()[0];
          nextActive = result.isActive;
          if (!nextActive) {
            await applyNativeNoiseFallback(newRawStream);
            toast.warning('AI noise suppression could not start on the selected microphone.');
          }
        } else {
          finalAudioTrack = newRawStream.getAudioTracks()[0];
        }

        if (!finalAudioTrack) {
          newRawStream.getTracks().forEach((track) => track.stop());
          throw new Error('The selected microphone did not provide an audio track.');
        }

        // احترام حالة الميوت الحالية
        finalAudioTrack.enabled = !localCallStateRef.current.muted;

        // 1) استبدال في الـ WebRTC Sender أولاً حتى يستمر الصوت بدون انقطاع
        await replacePeerTrack('audio', finalAudioTrack);

        // 2) الآن نبدّل داخل localStream ونغلق السلسلة القديمة
        const previousRawStream = rawMicStreamRef.current;
        const previousCleanup = denoiseCleanupRef.current;
        rawMicStreamRef.current = newRawStream;
        denoiseCleanupRef.current = nextCleanup;

        const oldTrack = localStreamRef.current.getAudioTracks()[0];
        if (oldTrack && oldTrack !== finalAudioTrack) localStreamRef.current.removeTrack(oldTrack);
        if (!localStreamRef.current.getAudioTracks().includes(finalAudioTrack)) {
          localStreamRef.current.addTrack(finalAudioTrack);
        }
        previousCleanup?.();
        if (oldTrack && oldTrack !== finalAudioTrack) oldTrack.stop();
        previousRawStream?.getTracks().forEach((track) => track.stop());

        noiseSuppressionActiveRef.current = nextActive;
        setIsNoiseSuppressionActive(nextActive);
        publishCallState({ noiseSuppressionActive: nextActive });

        if (activeCall.roomId) {
          await callApi(token, `/${activeCall.roomId}/noise`, {
            method: 'PATCH',
            body: { enabled: nextActive },
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

  // ─────────────────────────────────────────────────────
  // Helper: Discord Ringtone Synthesizer (نغمة رنين ديسكورد الرسمية)
  // ─────────────────────────────────────────────────────
  const ringtoneTimerRef = useRef(null);
  const ringtoneAudioCtx = useRef(null);

  const startDiscordRingtone = () => {
    stopDiscordRingtone();

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      ringtoneAudioCtx.current = ctx;

      // نوتات رنين ديسكورد الكلاسيكي: (D5, F#5, A5, D6, B5, D6, F#6)
      const playChimeSequence = () => {
        if (!ringtoneAudioCtx.current || ringtoneAudioCtx.current.state === 'closed') return;
        const now = ringtoneAudioCtx.current.currentTime;

        const notes = [
          { freq: 587.33, time: 0.00, dur: 0.12 }, // D5
          { freq: 739.99, time: 0.12, dur: 0.12 }, // F#5
          { freq: 880.00, time: 0.24, dur: 0.12 }, // A5
          { freq: 1174.66, time: 0.36, dur: 0.25 }, // D6
          { freq: 987.77, time: 0.70, dur: 0.14 }, // B5
          { freq: 1174.66, time: 0.85, dur: 0.14 }, // D6
          { freq: 1479.98, time: 1.00, dur: 0.35 }, // F#6
        ];

        notes.forEach(({ freq, time, dur }) => {
          const osc = ringtoneAudioCtx.current.createOscillator();
          const gain = ringtoneAudioCtx.current.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + time);

          // Bell envelope (هجوم سريع واضمحلال ناعم مثل ماريمبا ديسكورد)
          gain.gain.setValueAtTime(0, now + time);
          gain.gain.linearRampToValueAtTime(0.25, now + time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

          osc.connect(gain);
          gain.connect(ringtoneAudioCtx.current.destination);

          osc.start(now + time);
          osc.stop(now + time + dur + 0.05);
        });
      };

      // تشغيل النغمة أول مرة ثم تكرارها كل 2.4 ثانية تماماً مثل ديسكورد
      playChimeSequence();
      ringtoneTimerRef.current = setInterval(playChimeSequence, 2400);
    } catch (err) {
      console.warn('[Ringtone] AudioContext error:', err);
    }
  };

  const stopDiscordRingtone = () => {
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    if (ringtoneAudioCtx.current) {
      try {
        ringtoneAudioCtx.current.close();
      } catch {
        // إغلاق AudioContext قد يفشل لو كان مغلقاً بالفعل — لا حاجة لأي إجراء
      }
      ringtoneAudioCtx.current = null;
    }
  };

  // مراقبة حالات المكالمة لتشغيل وإيقاف الرنين تلقائياً
  useEffect(() => {
    // 1. لو في مكالمة واردة (Incoming Call Ringing)
    if (incomingCall) {
      startDiscordRingtone();
    }
    // 2. لو المتصل في وضع الاتصال والطرف التاني لسه ماردش (Outgoing Ringing)
    else if (activeCall && callStatus === 'calling') {
      startDiscordRingtone();
    }
    // 3. أول ما المكالمة تتقبل (Connected) أو تنتهي (Idle) -> إيقاف الرنين فوراً
    else {
      stopDiscordRingtone();
    }

    return () => stopDiscordRingtone();
    // دوال الرنين تعتمد على refs فقط، وإضافتها للاعتماديات تعيد تشغيل النغمة بلا داعٍ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall, activeCall, callStatus]);

  // ─────────────────────────────────────────────────────
  // Helper: Create Blank Video Track (لضمان وجود مسار فيديو جاهز للشير سكرين فوراً)
  // ─────────────────────────────────────────────────────
  const createBlankVideoTrack = (width = 640, height = 360) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
      }
      const stream = canvas.captureStream(5);
      const track = stream.getVideoTracks()[0];
      if (track) track.enabled = false; // خامل حتى يتم استبداله بالشاشة أو الكاميرا
      return track;
    } catch (e) {
      console.warn('[Media] Canvas capture not supported:', e);
      return null;
    }
  };

  // ─────────────────────────────────────────────────────
  // Helper: Acquire microphone & initial media stream (with RNNoise Neural Denoise)
  // ─────────────────────────────────────────────────────
  const acquireMediaStream = async ({ includeVideo = false } = {}) => {
    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: false,
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

      let processedStream = rawStream;
      if (isNoiseSuppressionEnabled) {
        try {
          const { cleanStream, cleanup, isActive } = await applyRnnoiseDenoise(
            rawStream,
            null,
            noiseLevelRef.current,
          );
          denoiseCleanupRef.current = cleanup;
          processedStream = cleanStream;
          noiseSuppressionActiveRef.current = isActive;
          setIsNoiseSuppressionActive(isActive);
          if (!isActive) {
            await applyNativeNoiseFallback(rawStream);
            toast.warning('AI noise suppression is unavailable; microphone noise reduction remains enabled.');
          }
        } catch (error) {
          console.warn('[NoiseSuppression] Could not process microphone before the call:', error);
          noiseSuppressionActiveRef.current = false;
          setIsNoiseSuppressionActive(false);
          await applyNativeNoiseFallback(rawStream);
          toast.warning('AI noise suppression is unavailable; microphone noise reduction remains enabled.');
        }
      } else {
        noiseSuppressionActiveRef.current = false;
        setIsNoiseSuppressionActive(false);
      }

      const cameraTrack = rawStream.getVideoTracks()[0];
      if (cameraTrack && !processedStream.getVideoTracks().some((track) => track.id === cameraTrack.id)) {
        processedStream.addTrack(cameraTrack);
      }

      // إضافة مسار فيديو خامل مسبقاً لكي يكون Video Sender جاهزاً للشير سكرين
      const blankTrack = processedStream.getVideoTracks().length ? null : createBlankVideoTrack();
      if (blankTrack) {
        processedStream.addTrack(blankTrack);
      }
      return processedStream;
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

  const callErrorMessage = (error, fallback) => {
    const microphoneMessage = microphoneErrorMessage(error);
    if (microphoneMessage) return microphoneMessage;
    if (typeof error?.message === 'string' && error.message.trim()) {
      return `${fallback}: ${error.message}`;
    }
    return fallback;
  };

  // ─────────────────────────────────────────────────────
  // Helper: Attach remote stream to <audio>/<video>
  // ─────────────────────────────────────────────────────
  const attachRemote = async (stream, participantId) => {
    if (!remoteStreamsRef.current.some((entry) => entry.userId === participantId)) {
      const nextStreams = [...remoteStreamsRef.current, { userId: participantId, stream }];
      remoteStreamsRef.current = nextStreams;
      setRemoteStreams(nextStreams);
    }
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch((e) => console.warn('[Video] play blocked:', e));
      }
    }
    const audioElement = remoteAudioElementsRef.current.get(participantId);
    if (audioElement) {
      audioElement.srcObject = stream;
      audioElement.muted = false;
      audioElement.play().catch((e) => console.warn('[Audio] play blocked:', e));
    }
  };

  // ─────────────────────────────────────────────────────
  // Helper: Setup peerCall event listeners
  // ─────────────────────────────────────────────────────
  const getPeerUserId = (peerId) => callParticipantsRef.current
    .find((participant) => participant.peer_id === peerId)?.user_id;

  const answerPeerCall = (call, participantId) => {
    if (!call || !participantId || !localStreamRef.current || peerCallsRef.current.has(participantId)) return;
    if (!localStreamRef.current.getAudioTracks().some((track) => track.readyState === 'live')) {
      toast.error('Your microphone track is unavailable.');
      return;
    }
    try {
      call.answer(localStreamRef.current);
      peerCallsRef.current.set(participantId, call);
      pendingCallRef.current.delete(call.peer);
      if (!peerCallRef.current) peerCallRef.current = call;
      setupCallListeners(call, participantId);
    } catch (error) {
      console.error('[PeerCall] Failed to answer participant:', participantId, error);
      toast.error('Could not connect to a call participant.');
      call.close();
    }
  };

  const startPeerCall = (participant) => {
    const participantId = participant.user_id;
    const remotePeerId = participant.peer_id;
    if (!remotePeerId) {
      console.error('[PeerCall] Missing registered peer ID for participant:', participantId);
      return;
    }
    if (!peerRef.current || !localStreamRef.current || peerCallsRef.current.has(participantId)) return;
    if (user?.id >= participantId) return;
    if (!localStreamRef.current.getAudioTracks().some((track) => track.readyState === 'live')) {
      toast.error('Your microphone track is unavailable.');
      return;
    }

    try {
      const call = peerRef.current.call(remotePeerId, localStreamRef.current);
      if (!call) {
        console.error('[PeerCall] Failed to create call for participant:', participantId);
        toast.error('Could not connect to a call participant.');
        return;
      }
      peerCallsRef.current.set(participantId, call);
      if (!peerCallRef.current) peerCallRef.current = call;
      setupCallListeners(call, participantId);
      try {
        const connection = peerRef.current.connect(remotePeerId);
        setupDataConnection(connection);
      } catch (error) {
        console.warn('[PeerCall] Data connection failed:', error);
      }
    } catch (error) {
      console.error('[PeerCall] Failed to create participant connection:', participantId, error);
      toast.error('Could not connect to a call participant.');
    }
  };

  const syncPeerCalls = (participants) => {
    const activeParticipants = participants.filter((participant) => participant.status === 'active');
    activeParticipants.forEach((participant) => {
      if (participant.user_id !== user?.id) startPeerCall(participant);
    });
    pendingCallRef.current.forEach((call, peerId) => {
      const participantId = getPeerUserId(peerId);
      if (!participantId) return;
      if (activeParticipants.some((participant) => participant.user_id === participantId)) {
        answerPeerCall(call, participantId);
      } else {
        pendingCallRef.current.delete(peerId);
        call.close();
      }
    });
  };

  const setupCallListeners = (call, participantId) => {
    call.on('stream', async (remote) => {
      if (remote.getAudioTracks().length === 0) {
        console.error('[PeerCall] Remote participant provided no audio track:', participantId);
        toast.error('A call participant has no active microphone audio.');
        return;
      }
      setCallStatus('connected');
      await configurePeerAudio(call);

      await attachRemote(remote, participantId);
    });
    call.on('close', () => {
      if (peerCallsRef.current.get(participantId) === call) {
        peerCallsRef.current.delete(participantId);
      }
      const nextRemoteCallStates = { ...remoteCallStatesRef.current };
      delete nextRemoteCallStates[participantId];
      remoteCallStatesRef.current = nextRemoteCallStates;
      setRemoteCallStates(nextRemoteCallStates);
      setIsRemoteScreenSharing(Object.values(nextRemoteCallStates).some((state) => state.screen));
      setIsRemoteCamera(Object.values(nextRemoteCallStates).some((state) => state.camera));
      if (peerCallRef.current === call) {
        peerCallRef.current = peerCallsRef.current.values().next().value || null;
      }
      dataConnectionRef.current.get(call.peer)?.close();
      const disconnectedStream = remoteStreamsRef.current.find((entry) => entry.userId === participantId)?.stream;
      const remainingStreams = remoteStreamsRef.current.filter((entry) => entry.userId !== participantId);
      remoteStreamsRef.current = remainingStreams;
      setRemoteStreams(remainingStreams);
      if (remoteStreamRef.current === disconnectedStream) {
        remoteStreamRef.current = remainingStreams[0]?.stream || null;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
          remoteVideoRef.current.play().catch((e) => console.warn('[Video] play blocked:', e));
        }
      }
    });
    call.on('error', (error) => {
      console.error('[PeerCall] error:', participantId, error);
      const participantName = callParticipantsRef.current.find(
        (participant) => participant.user_id === participantId
      )?.user?.display_name || 'A participant';
      toast.error(`${participantName} could not connect to the voice call.`);
    });
  };

  // ─────────────────────────────────────────────────────
  // 1. PeerJS Setup
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const myPeerId = crypto.randomUUID().replace(/-/g, '');
    const p = new Peer(myPeerId, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.relay.metered.ca:80' },
          ...(TURN_USERNAME && TURN_CREDENTIAL
            ? (TURN_URLS.length ? TURN_URLS : DEFAULT_TURN_URLS).map((urls) => ({
                urls,
                username: TURN_USERNAME,
                credential: TURN_CREDENTIAL,
              }))
            : []),
        ]
      }
    });

    peerRef.current = p;
    peerIdRef.current = myPeerId;

    p.on('open', () => {
      setPeerReady(true);
    });

    p.on('error', (err) => {
      console.error('[Peer] error:', err.type, err.message);
    });

    p.on('disconnected', () => {
      console.warn('[Peer] disconnected — reconnecting...');
      try {
        p.reconnect();
      } catch (error) {
        console.error('[Peer] reconnect failed:', error);
      }
    });

    // مكالمة واردة من PeerJS — نحفظها فقط، الرد يحصل في answerCall
    p.on('call', (call) => {
      const participantId = getPeerUserId(call.peer);
      pendingCallRef.current.set(call.peer, call);
      if (localMembershipActiveRef.current && participantId) answerPeerCall(call, participantId);
    });

    // اتصال بيانات P2P وارد للإشارات اللحظية
    p.on('connection', (conn) => {
      setupDataConnection(conn);
    });

    return () => {
      p.destroy();
      if (peerRef.current === p) {
        peerRef.current = null;
        peerIdRef.current = null;
      }
      setPeerReady(false);
    };
    // هذا الـ effect مخصص لإنشاء الـ Peer مرة واحدة لكل مستخدم؛ الدوال المستخدمة
    // داخله تُعرَّف في نفس المكوّن ولا يمكن إضافتها دون إعادة إنشاء الاتصال كل render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const refreshCallParticipants = async (roomId, roomData = null) => {
    let participants;
    try {
      ({ participants } = roomData || await callApi(token, `/${roomId}`));
    } catch (error) {
      console.error('[Call] Failed to load participants:', error);
      toast.error('Could not load the call participants.');
      return [];
    }

    const participantsChanged = JSON.stringify(callParticipantsRef.current) !== JSON.stringify(participants);
    callParticipantsRef.current = participants;
    if (participantsChanged) setCallParticipants(participants);
    if (participants.some((participant) => (
      participant.user_id !== user?.id && participant.status === 'active'
    ))) {
      setCallStatus('connected');
    }
    if (participantsChanged) {
      setActiveCall((previous) => previous?.roomId === roomId
        ? {
          ...previous,
          participants,
          friend: participants.find((participant) => participant.user_id !== user?.id)?.user || previous.friend,
        }
        : previous);
      syncPeerCalls(participants);
    }

    participants
      .filter((participant) => participant.status !== 'active')
      .forEach((participant) => {
        const call = peerCallsRef.current.get(participant.user_id);
        if (call) {
          peerCallsRef.current.delete(participant.user_id);
          if (peerCallRef.current === call) {
            peerCallRef.current = peerCallsRef.current.values().next().value || null;
          }
          call.close();
          dataConnectionRef.current.get(call.peer)?.close();
        }
      });
    return participants;
  };

  const triggerIncoming = async (invitation) => {
    if (activeCallRef.current || incomingCallRef.current || pendingIncomingRoomRef.current) return;
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
    if (!peerRef.current || !peerReady) {
      toast.warning('Connecting to voice server, please wait a moment...');
      return;
    }

    warnIfTurnIsUnavailable();
    try {
      const stream = await acquireMediaStream({ includeVideo: isVideo });
      localStreamRef.current = stream;

      const { room } = await callApi(token, '', {
        method: 'POST',
        body: {
          targetUserId: friend.id,
          peerId: peerIdRef.current,
          noiseSuppressionEnabled: noiseSuppressionActiveRef.current === true,
        },
      });

      dbCallIdRef.current = room.id;
      localMembershipActiveRef.current = true;
      const participants = [
        { user_id: user.id, peer_id: peerIdRef.current, status: 'active', noise_suppression_enabled: noiseSuppressionActiveRef.current === true, user },
        { user_id: friend.id, status: 'invited', noise_suppression_enabled: true, user: friend },
      ];
      callParticipantsRef.current = participants;
      setCallParticipants(participants);
      const callState = { roomId: room.id, callId: room.id, friend, isVideo, participants };
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
    } catch (err) {
      console.error('[startCall] error:', err);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
      rawMicStreamRef.current = null;
      denoiseCleanupRef.current?.();
      denoiseCleanupRef.current = null;
      toast.error(callErrorMessage(err, 'Could not start the call'));
    }
  };

  // ─────────────────────────────────────────────────────
  // 5. Answer an incoming room invitation
  // ─────────────────────────────────────────────────────
  const answerCall = async () => {
    const inc = incomingCallRef.current;
    if (!inc) return;
    warnIfTurnIsUnavailable();
    let acceptedMembership = false;

    try {
      const { room } = await callApi(token, `/${inc.roomId}`);
      if (room?.status !== 'active') {
        toast.warning('This call has already ended.');
        endCallCleanup(false);
        return;
      }

      const stream = await acquireMediaStream();
      localStreamRef.current = stream;
      await callApi(token, `/${inc.roomId}/answer`, {
        method: 'POST',
        body: {
          peerId: peerIdRef.current,
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
      setCallStatus('connected');
      const callState = {
        roomId: inc.roomId,
        callId: inc.roomId,
        friend: inc.caller,
        isVideo: pendingVideoCallRef.current,
        participants,
      };
      localCallStateRef.current = {
        muted: false,
        deafened: false,
        camera: false,
        screen: false,
        videoCall: pendingVideoCallRef.current,
        noiseSuppressionActive: noiseSuppressionActiveRef.current,
      };
      activeCallRef.current = callState;
      setActiveCall(callState);
      incomingCallRef.current = null;
      setIncomingCall(null);
      syncPeerCalls(participants);
      if (pendingVideoCallRef.current && !cameraEnabledRef.current) {
        pendingVideoCallRef.current = false;
        await toggleCamera();
      }
    } catch (err) {
      console.error('[answerCall] error:', err);
      localMembershipActiveRef.current = false;
      toast.error(callErrorMessage(err, 'Could not join the call'));
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
      denoiseCleanupRef.current?.();
      denoiseCleanupRef.current = null;
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
  const endCallCleanup = (updateDb = true) => {
    denoiseGenerationRef.current += 1;
    const roomId = dbCallIdRef.current;
    const wasIncoming = !!incomingCallRef.current && !activeCallRef.current;
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
      if (denoiseCleanupRef.current) {
        denoiseCleanupRef.current();
        denoiseCleanupRef.current = null;
      }
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

    peerCallsRef.current.forEach((call) => {
      try { call.close(); } catch (e) { console.warn('[endCall] PeerJS close warning:', e); }
    });
    peerCallsRef.current.clear();
    peerCallRef.current = null;
    pendingCallRef.current.forEach((call) => {
      try { call.close(); } catch (e) { console.warn('[endCall] pending call close warning:', e); }
    });
    pendingCallRef.current.clear();
    dataConnectionRef.current.forEach((connection) => {
      try { connection.close(); } catch (e) { console.warn('[endCall] data connection close warning:', e); }
    });
    dataConnectionRef.current.clear();

    remoteAudioElementsRef.current.forEach((element) => {
      element.pause();
      element.srcObject = null;
    });
    remoteAudioElementsRef.current.clear();
    remoteAudioRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    remoteStreamRef.current = null;
    remoteStreamsRef.current = [];
    dbCallIdRef.current = null;
    localMembershipActiveRef.current = false;
    activeCallRef.current = null;
    incomingCallRef.current = null;
    pendingIncomingRoomRef.current = null;
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
    stopDiscordRingtone();
    setActiveCall(null);
    setIncomingCall(null);
    setCallParticipants([]);
    callParticipantsRef.current = [];
    setRemoteStreams([]);
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
  // 6. Toggle Mute (كتم المايك محلياً وفي شبكة الـ WebRTC فوراً)
  // ─────────────────────────────────────────────────────
  const toggleMute = () => {
    if (isDeafened && isMuted) {
      toast.info('Undeafen before unmuting your microphone.');
      return;
    }

    const next = !isMuted;
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    publishCallState({ muted: next });
  };

  // ─────────────────────────────────────────────────────
  // 7. Toggle Deafen (كتم سماع صوت الطرف الآخر تماماً)
  // ─────────────────────────────────────────────────────
  const toggleDeafen = () => {
    const next = !isDeafened;
    setIsDeafened(next);
    remoteAudioElementsRef.current.forEach((element) => {
      element.muted = next;
      element.volume = next ? 0 : 1;
    });

    let muted = isMuted;
    if (next) {
      mutedBeforeDeafenRef.current = isMuted;
      muted = true;
    } else {
      muted = mutedBeforeDeafenRef.current;
    }

    setIsMuted(muted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
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
    let acquiredTrack = null;
    try {
      if (cameraEnabledRef.current) {
        const blankTrack = createBlankVideoTrack();
        if (!blankTrack) throw new Error('Could not create an inactive video track.');
        await replaceLocalVideoTrack(blankTrack);

        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        cameraEnabledRef.current = false;
        setIsVideoEnabled(false);
        publishCallState({ camera: false });
        return;
      }

      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      acquiredTrack = cameraStream.getVideoTracks()[0];
      if (!acquiredTrack) throw new Error('Camera did not provide a video track.');
      acquiredTrack.contentHint = 'motion';

      await replaceLocalVideoTrack(acquiredTrack, {
        maxBitrate: 1_200_000,
        maxFramerate: 30,
        degradationPreference: 'maintain-framerate',
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = cameraStream;
        localVideoRef.current.play().catch(() => {});
      }

      cameraEnabledRef.current = true;
      setIsVideoEnabled(true);
      publishCallState({ camera: true });
    } catch (error) {
      acquiredTrack?.stop();
      console.error('[toggleCamera]', error);
      toast.error('Could not access camera. Please check browser permissions.');
    } finally {
      cameraTogglePendingRef.current = false;
    }
  }

  // ─────────────────────────────────────────────────────
  // 9. Toggle Screen Share (شغال فورياً عند الطرفين 100%)
  // ─────────────────────────────────────────────────────
  const toggleScreenShare = async () => {
    if (!screenStreamRef.current && callStatus !== 'connected') {
      toast.info('Wait until the call is connected before sharing your screen.');
      return;
    }

    if (screenStreamRef.current) {
      // أوقف المشاركة بأمان — الترتيب مهم جداً لمنع قفل الكول!
      try {
        await restoreVideoAfterScreenShare();
      } catch (error) {
        console.error('[ScreenShare] Could not restore the video sender:', error);
        toast.error('Could not stop screen sharing safely. Please try again.');
        return;
      }

      // 2. ثانياً: إزالة الـ onended handler لمنع التضارب مع الكود ده
      if (screenStreamRef.current) {
        screenStreamRef.current.getVideoTracks().forEach(t => { t.onended = null; });
      }

      // 3. ثالثاً: إيقاف مسارات الشاشة بأمان (بعد ما المسار الخامل أخد مكانه)
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;

      // 4. تحديث الـ localStream
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setIsScreenSharing(false);
      publishCallState({ screen: false });
    } else {
      try {
        const ss = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60 },
          },
          audio: false,
        });
        const sTrack = ss.getVideoTracks()[0];
        if (!sTrack) {
          ss.getTracks().forEach((track) => track.stop());
          throw new Error('Screen capture did not provide a video track.');
        }
        screenStreamRef.current = ss;
        sTrack.contentHint = 'detail';
        try {
          await sTrack.applyConstraints({
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 60, max: 60 },
          });
        } catch (error) {
          console.warn('[ScreenShare] Browser could not apply preferred capture constraints:', error);
        }
        console.info('[ScreenShare] Captured display settings:', sTrack.getSettings());

        // 1. استبدال المسار فورياً في الـ WebRTC Video Sender ليظهر عند الطرف الآخر فوراً!
        await replacePeerTrack('video', sTrack, {
          maxBitrate: 2_000_000,
          maxFramerate: 60,
          degradationPreference: 'maintain-resolution',
        });

        // 2. ربط الـ stream محلياً فوراً ليظهر عندك أنت أيضاً
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = ss;
          localVideoRef.current.play().catch(() => {});
        }

        setIsScreenSharing(true);
        publishCallState({ screen: true });

        setTimeout(() => {
          if (localVideoRef.current && screenStreamRef.current) {
            localVideoRef.current.srcObject = screenStreamRef.current;
            localVideoRef.current.play().catch(() => {});
          }
        }, 100);

        // لما المستخدم يقفل شير من متصفح كروم/ويندوز نفسه (مش من زرارنا)
        sTrack.onended = async () => {
          let restoreError = null;
          try {
            await restoreVideoAfterScreenShare();
          } catch (error) {
            console.error('[ScreenShare] Could not restore the video sender:', error);
            restoreError = error;
          }

          // 2. تنظيف الحالة
          screenStreamRef.current?.getTracks().forEach((track) => {
            if (track.kind === 'video') track.onended = null;
            track.stop();
          });
          screenStreamRef.current = null;
          if (localVideoRef.current) localVideoRef.current.srcObject = null;

          setIsScreenSharing(false);
          publishCallState({ screen: false });
          if (restoreError) toast.error('Could not restore the camera after screen sharing stopped.');
        };
      } catch (err) {
        console.error('[toggleScreenShare]', err);
        try {
          await restoreVideoAfterScreenShare();
        } catch (restoreError) {
          console.error('[ScreenShare] Could not restore video after share failure:', restoreError);
        }
        screenStreamRef.current?.getTracks().forEach((track) => {
          if (track.kind === 'video') track.onended = null;
          track.stop();
        });
        screenStreamRef.current = null;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = cameraEnabledRef.current ? localStreamRef.current : null;
        }
        setIsScreenSharing(false);
        publishCallState({ screen: false });
        toast.error('Could not start screen sharing. Check display-capture permission and try again.');
      }
    }
  };

  const applyLiveNoiseSuppression = async (enabled, level) => {
    const roomId = activeCallRef.current?.roomId;
    const rawStream = rawMicStreamRef.current;
    const localStream = localStreamRef.current;
    if (!roomId || !rawStream || !localStream) return;

    // رقم الجيل يمنع تتالي التبديلات السريعة من إبقاء مسار قديم/مغلق مربوطاً بالمكالمة
    const generation = denoiseGenerationRef.current + 1;
    denoiseGenerationRef.current = generation;

    try {
      // 1) نجهّز السلسلة الجديدة بالكامل قبل أي لمس للسلسلة الشغالة
      let finalAudioTrack;
      let nextCleanup = null;
      let nextActive = false;

      if (enabled) {
        const result = await applyRnnoiseDenoise(rawStream, null, level);
        if (denoiseGenerationRef.current !== generation) {
          // تغيير أحدث بدأ أثناء التجهيز — نغلق هذه السلسلة ونتجاهلها
          result.cleanup();
          return;
        }
        nextCleanup = result.cleanup;
        finalAudioTrack = result.cleanStream.getAudioTracks()[0] || rawStream.getAudioTracks()[0];
        nextActive = result.isActive;
        if (!nextActive) {
          await applyNativeNoiseFallback(rawStream);
          toast.warning('AI noise suppression could not start; microphone noise reduction remains enabled.');
        }
      } else {
        finalAudioTrack = rawStream.getAudioTracks()[0];
      }

      if (!finalAudioTrack) return;

      finalAudioTrack.enabled = !localCallStateRef.current.muted;

      // 2) نبدّل المسار عند الأقران أولاً (replaceTrack) قبل إنهاء القديم
      await replacePeerTrack('audio', finalAudioTrack);

      // 3) بعد نجاح التبديل نستبدل داخل localStream ونغلق السلسلة القديمة
      const previousCleanup = denoiseCleanupRef.current;
      denoiseCleanupRef.current = nextCleanup;

      const oldTrack = localStream.getAudioTracks()[0];
      if (oldTrack && oldTrack !== finalAudioTrack) localStream.removeTrack(oldTrack);
      if (!localStream.getAudioTracks().includes(finalAudioTrack)) {
        localStream.addTrack(finalAudioTrack);
      }
      previousCleanup?.();
      if (oldTrack && oldTrack !== finalAudioTrack) oldTrack.stop();

      noiseSuppressionActiveRef.current = nextActive;
      setIsNoiseSuppressionActive(nextActive);
      publishCallState({ noiseSuppressionActive: nextActive });

      await callApi(token, `/${roomId}/noise`, {
        method: 'PATCH',
        body: { enabled: nextActive },
      });

      const updatedParticipants = callParticipantsRef.current.map((participant) => (
        participant.user_id === user.id
          ? { ...participant, noise_suppression_enabled: nextActive }
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
      peerReady,
      activeCall,
      callParticipants,
      remoteStreams,
      remoteCallStates,
      incomingCall,
      callStatus,
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
      participantAudioSettings,
      setParticipantVolume,
      setParticipantMuted,
      changeMicrophone,
      changeSpeaker,
      updateAudioDevices,
      localVideoRef,
      remoteVideoRef,
      remoteAudioRef,
      remoteAudioElementsRef,
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
    </VoiceContext.Provider>
  );
};

export const useVoice = () => useContext(VoiceContext);
