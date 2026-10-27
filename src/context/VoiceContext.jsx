import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import Peer from 'peerjs';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { supabase } from '../services/supabaseClient';
import { applyRnnoiseDenoise } from '../services/denoiser';

const VoiceContext = createContext({});

export const VoiceProvider = ({ children }) => {
  const { user } = useAuth();
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
  const [peerReady,       setPeerReady]      = useState(false);
  const [callParticipants, setCallParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);

  // ── Audio Devices State ────────────────────────────────
  const [microphones,     setMicrophones]    = useState([]);
  const [speakers,        setSpeakers]       = useState([]);
  const [selectedMic,     setSelectedMic]    = useState('default');
  const [selectedSpeaker, setSelectedSpeaker]= useState('default');
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] = useState(true);
  const [isNoiseSuppressionActive, setIsNoiseSuppressionActive] = useState(false);

  // ── Refs (لا تتغيرش بين renders) ──────────────────────
  const peerRef         = useRef(null);      // PeerJS instance
  const peerIdRef       = useRef(null);
  const peerCallRef     = useRef(null);      // MediaConnection الحالية
  const peerCallsRef    = useRef(new Map());
  const pendingCallRef  = useRef(new Map()); // مكالمات PeerJS الواردة حسب المشارك
  const localStreamRef  = useRef(null);
  const rawMicStreamRef = useRef(null);      // Raw mic stream قبل الفلتر
  const denoiseCleanupRef = useRef(null);    // دالة تنظيف RNNoise
  const noiseSuppressionActiveRef = useRef(false);
  const remoteStreamRef = useRef(null);
  const remoteStreamsRef = useRef([]);
  const remoteDenoiseCleanupRef = useRef(null); // تنظيف فلتر الطرف المستقبل
  const remoteAudioElementsRef = useRef(new Map());
  const screenStreamRef = useRef(null);
  const dbCallIdRef     = useRef(null);
  const activeCallRef   = useRef(null);      // mirror of activeCall state (للـ closures)
  const mediaChannelRef = useRef(null);
  const dataConnectionRef = useRef(new Map());
  const incomingCallRef = useRef(incomingCall);
  const pendingIncomingRoomRef = useRef(null);
  const callParticipantsRef = useRef(callParticipants);
  const localMembershipActiveRef = useRef(false);
  const endCallCleanupRef = useRef(null);

  // إعداد قناة البيانات المباشرة WebRTC P2P DataChannel
  const setupDataConnection = (conn) => {
    if (!conn) return;
    dataConnectionRef.current.set(conn.peer, conn);
    conn.on('data', (data) => {
      console.log('[PeerData received]', data);
      if (data?.type === 'screen') {
        setIsRemoteScreenSharing(!!data.enabled);
      } else if (data?.type === 'camera') {
        setIsRemoteCamera(!!data.enabled);
      }
    });
    conn.on('close', () => {
      if (dataConnectionRef.current.get(conn.peer) === conn) {
        dataConnectionRef.current.delete(conn.peer);
      }
    });
    conn.on('error', (err) => console.warn('[PeerData error]', err));
  };

  // إرسال إشارات الفيديو والشير سكرين فورياً للطرف الآخر
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

  // مراقبة قناة إشارات الميديا للمكالمة الحالية (شير سكرين وكاميرا)
  useEffect(() => {
    if (!activeCall?.roomId || !user?.id) {
      if (mediaChannelRef.current) {
        supabase.removeChannel(mediaChannelRef.current);
        mediaChannelRef.current = null;
      }
      setIsRemoteScreenSharing(false);
      setIsRemoteCamera(false);
      return;
    }

    const ch = supabase.channel(`call-media-${activeCall.roomId}`)
      .on('broadcast', { event: 'media_state' }, ({ payload }) => {
        console.log('[MediaSignal received]', payload);
        if (payload?.senderId && payload.senderId !== user.id) {
          if (payload.type === 'screen') {
            setIsRemoteScreenSharing(!!payload.enabled);
          } else if (payload.type === 'camera') {
            setIsRemoteCamera(!!payload.enabled);
          }
        }
      })
      .subscribe((status) => {
        console.log('[call-media status]:', status);
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
  const replacePeerTrack = async (kind, track) => {
    await Promise.all(getPeerCalls().map(async (call) => {
      const pc = call.peerConnection;
      if (!pc) return;
      const sender = pc.getSenders().find((item) => item.track?.kind === kind)
        || pc.getTransceivers?.().find((item) => item.receiver?.track?.kind === kind)?.sender;
      if (sender) await sender.replaceTrack(track);
    }));
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

      if (mics.length > 0 && selectedMic === 'default' && mics[0].deviceId) {
        setSelectedMic(mics[0].deviceId);
      }
      if (spks.length > 0 && selectedSpeaker === 'default' && spks[0].deviceId) {
        setSelectedSpeaker(spks[0].deviceId);
      }
    } catch (err) {
      console.warn('[Devices] Failed to enumerate audio devices:', err);
    }
  };

  useEffect(() => {
    updateAudioDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', updateAudioDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', updateAudioDevices);
    };
  }, []);

  // دالة تغيير المايك
  const changeMicrophone = async (deviceId) => {
    // لو في مكالمة شغالة، نستبدل مسار الصوت فوراً مع تطبيق الـ RNNoise
    if (activeCall && localStreamRef.current) {
      try {
        if (denoiseCleanupRef.current) {
          denoiseCleanupRef.current();
          denoiseCleanupRef.current = null;
        }

        const newRawStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
        rawMicStreamRef.current = newRawStream;

        let finalAudioTrack;
        if (isNoiseSuppressionEnabled) {
          const { cleanStream, cleanup, isActive } = await applyRnnoiseDenoise(newRawStream);
          denoiseCleanupRef.current = cleanup;
          finalAudioTrack = cleanStream.getAudioTracks()[0] || newRawStream.getAudioTracks()[0];
          noiseSuppressionActiveRef.current = isActive;
          setIsNoiseSuppressionActive(isActive);
          if (!isActive) {
            toast.warning('AI noise suppression could not start on the selected microphone.');
          }
        } else {
          finalAudioTrack = newRawStream.getAudioTracks()[0];
          noiseSuppressionActiveRef.current = false;
          setIsNoiseSuppressionActive(false);
        }

        // إيقاف المسار القديم
        localStreamRef.current.getAudioTracks().forEach((t) => t.stop());
        localStreamRef.current.removeTrack(localStreamRef.current.getAudioTracks()[0]);
        localStreamRef.current.addTrack(finalAudioTrack);

        // احترام حالة الميوت الحالية
        finalAudioTrack.enabled = !isMuted;

        // استبدال في الـ WebRTC Sender
        await replacePeerTrack('audio', finalAudioTrack);
        if (activeCall.roomId) {
          const { error } = await supabase
            .from('call_participants')
            .update({ noise_suppression_enabled: noiseSuppressionActiveRef.current })
            .eq('room_id', activeCall.roomId)
            .eq('user_id', user.id);
          if (error) console.error('[changeMicrophone] Failed to update noise status:', error);
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
      } catch (e) {}
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
  const acquireMediaStream = async () => {
    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (selectedMic && selectedMic !== 'default') {
        audioConstraints.deviceId = { exact: selectedMic };
      }

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });
      if (rawStream.getAudioTracks().length === 0) {
        rawStream.getTracks().forEach((track) => track.stop());
        const error = new Error('The selected microphone did not provide an audio track.');
        error.name = 'NotFoundError';
        throw error;
      }
      rawMicStreamRef.current = rawStream;

      // تطبيق الـ RNNoise Neural Denoising لإزالة الضوضاء العميقة
      let processedStream = rawStream;
      if (isNoiseSuppressionEnabled) {
        try {
          const { cleanStream, cleanup, isActive } = await applyRnnoiseDenoise(rawStream);
          denoiseCleanupRef.current = cleanup;
          processedStream = cleanStream;
          noiseSuppressionActiveRef.current = isActive;
          setIsNoiseSuppressionActive(isActive);
          if (!isActive) {
            toast.warning('AI noise suppression is unavailable; microphone noise reduction remains enabled.');
          }
        } catch (e) {
          console.warn('[RNNoise] Failed to apply denoiser on mic, using raw:', e);
          noiseSuppressionActiveRef.current = false;
          setIsNoiseSuppressionActive(false);
          toast.warning('AI noise suppression is unavailable; microphone noise reduction remains enabled.');
        }
      } else {
        noiseSuppressionActiveRef.current = false;
        setIsNoiseSuppressionActive(false);
      }

      // إضافة مسار فيديو خامل مسبقاً لكي يكون Video Sender جاهزاً للشير سكرين
      const blankTrack = createBlankVideoTrack();
      if (blankTrack) {
        processedStream.addTrack(blankTrack);
      }
      console.log('[acquireMediaStream] final stream tracks:', processedStream.getTracks().map(t => `${t.kind}(enabled=${t.enabled},readyState=${t.readyState})`));
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
    console.log('[Remote] attaching stream, tracks:', stream.getTracks().length);
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
    .find((participant) => (
      participant.peer_id === peerId
      || participant.user_id.replace(/-/g, '') === peerId
    ))?.user_id;

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
    const remotePeerId = participant.peer_id || participantId.replace(/-/g, '');
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
      console.log('[PeerCall] got remote stream ✓, tracks:', remote.getTracks().map(t => `${t.kind}(enabled=${t.enabled})`));
      if (remote.getAudioTracks().length === 0) {
        console.error('[PeerCall] Remote participant provided no audio track:', participantId);
        toast.error('A call participant has no active microphone audio.');
        return;
      }
      setCallStatus('connected');

      try {
        const pc = call.peerConnection;
        if (pc) {
          console.log('[PeerCall] transceivers:', pc.getTransceivers().map((transceiver) => (
            `${transceiver.receiver?.track?.kind}:${transceiver.direction}/${transceiver.currentDirection}`
          )));
        }
      } catch (e) {
        console.warn('[PeerCall] transceiver direction warning:', e);
      }

      await attachRemote(remote, participantId);
    });
    call.on('close', () => {
      console.log('[PeerCall] closed for participant:', participantId);
      if (peerCallsRef.current.get(participantId) === call) {
        peerCallsRef.current.delete(participantId);
      }
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
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.relay.metered.ca:80' },
          {
            urls: 'turn:global.relay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:global.relay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:global.relay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ]
      }
    });

    peerRef.current = p;
    peerIdRef.current = myPeerId;

    p.on('open', () => {
      console.log('[Peer] ready');
      setPeerReady(true);
    });

    p.on('error', (err) => {
      console.error('[Peer] error:', err.type, err.message);
    });

    p.on('disconnected', () => {
      console.warn('[Peer] disconnected — reconnecting...');
      try { p.reconnect(); } catch {}
    });

    // مكالمة واردة من PeerJS — نحفظها فقط، الرد يحصل في answerCall
    p.on('call', (call) => {
      console.log('[Peer] incoming PeerJS call from:', call.peer);
      const participantId = getPeerUserId(call.peer);
      pendingCallRef.current.set(call.peer, call);
      if (localMembershipActiveRef.current && participantId) answerPeerCall(call, participantId);
    });

    // اتصال بيانات P2P وارد للإشارات اللحظية
    p.on('connection', (conn) => {
      console.log('[Peer] incoming data connection from:', conn.peer);
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
  }, [user?.id]);

  const refreshCallParticipants = async (roomId) => {
    const { data: rows, error } = await supabase
      .from('call_participants')
      .select('user_id, status, invited_by, noise_suppression_enabled, peer_id')
      .eq('room_id', roomId);
    if (error) {
      console.error('[Call] Failed to load participants:', error);
      toast.error('Could not load the call participants.');
      return [];
    }

    const userIds = rows.map((row) => row.user_id);
    const { data: profiles, error: profileError } = userIds.length
      ? await supabase.from('users').select('id, username, display_name, avatar_url').in('id', userIds)
      : { data: [], error: null };
    if (profileError) {
      console.error('[Call] Failed to load participant profiles:', profileError);
      toast.error('Could not load the call participants.');
      return [];
    }

    const participants = rows.map((row) => ({
      ...row,
      user: profiles.find((profile) => profile.id === row.user_id) || { id: row.user_id },
    }));
    callParticipantsRef.current = participants;
    setCallParticipants(participants);
    if (participants.some((participant) => (
      participant.user_id !== user?.id && participant.status === 'active'
    ))) {
      setCallStatus('connected');
    }
    setActiveCall((previous) => previous?.roomId === roomId
      ? {
          ...previous,
          participants,
          friend: participants.find((participant) => participant.user_id !== user?.id)?.user || previous.friend,
        }
      : previous);
    syncPeerCalls(participants);

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

  const triggerIncoming = async (participant) => {
    if (activeCallRef.current || incomingCallRef.current || pendingIncomingRoomRef.current) return;
    pendingIncomingRoomRef.current = participant.room_id;

    try {
      const { data: room, error: roomError } = await supabase
        .from('call_rooms')
        .select('id, created_by, status')
        .eq('id', participant.room_id)
        .eq('status', 'active')
        .maybeSingle();
      if (roomError) throw roomError;
      if (!room) {
        const { error } = await supabase
          .from('call_participants')
          .update({ status: 'left' })
          .eq('room_id', participant.room_id)
          .eq('user_id', user.id)
          .eq('status', 'invited');
        if (error) console.error('[Call] Failed to clear expired invitation:', error);
        return;
      }

      const { data: caller, error: callerError } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url')
        .eq('id', participant.invited_by || room.created_by)
        .maybeSingle();
      if (callerError) throw callerError;

      const incoming = {
        callId: room.id,
        roomId: room.id,
        callerId: caller?.id || room.created_by,
        callerName: caller?.display_name || caller?.username || 'Friend',
        caller,
      };
      incomingCallRef.current = incoming;
      dbCallIdRef.current = room.id;
      setIncomingCall(incoming);
    } catch (error) {
      console.error('[Call] Failed to prepare incoming call:', error);
    } finally {
      pendingIncomingRoomRef.current = null;
    }
  };

  // ─────────────────────────────────────────────────────
  // 2. Watch incoming room invitations
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const checkForIncoming = async () => {
      if (activeCallRef.current || incomingCallRef.current) return;
      const { data, error } = await supabase
        .from('call_participants')
        .select('room_id, invited_by')
        .eq('user_id', user.id)
        .eq('status', 'invited')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) {
        console.error('[Call] Failed to check incoming calls:', error);
        return;
      }
      if (data?.[0]) await triggerIncoming(data[0]);
    };

    checkForIncoming();
    const poll = setInterval(checkForIncoming, 2500);
    const ch = supabase
      .channel(`call-invitations-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_participants',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.new?.status === 'invited') triggerIncoming(payload.new);
      })
      .subscribe();

    return () => {
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  // ─────────────────────────────────────────────────────
  // 3. Synchronize room members and media state
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    const roomId = activeCall?.roomId;
    if (!roomId || !user?.id) return;

    const refreshTimer = window.setTimeout(() => refreshCallParticipants(roomId), 0);
    const ch = supabase
      .channel(`call-room-${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'call_participants',
        filter: `room_id=eq.${roomId}`,
      }, () => refreshCallParticipants(roomId))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_rooms',
        filter: `id=eq.${roomId}`,
      }, ({ new: room }) => {
        if (room?.status === 'ended') endCallCleanupRef.current?.(false);
      })
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(ch);
    };
  }, [activeCall?.roomId, user?.id]);

  useEffect(() => {
    const roomId = incomingCall?.roomId;
    if (!roomId) return undefined;
    const ch = supabase
      .channel(`incoming-call-room-${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_rooms',
        filter: `id=eq.${roomId}`,
      }, ({ new: room }) => {
        if (room?.status === 'ended') endCallCleanupRef.current?.(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [incomingCall?.roomId]);

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

    try {
      const stream = await acquireMediaStream();
      localStreamRef.current = stream;

      const { data: room, error: roomError } = await supabase
        .from('call_rooms')
        .insert([{ created_by: user.id }])
        .select('id')
        .single();
      if (roomError || !room) throw roomError || new Error('The call room was not created.');

      const { error: participantError } = await supabase
        .from('call_participants')
        .insert([
          {
            room_id: room.id,
            user_id: user.id,
            peer_id: peerIdRef.current,
            invited_by: user.id,
            status: 'active',
            noise_suppression_enabled: noiseSuppressionActiveRef.current === true,
            joined_at: new Date().toISOString(),
          },
          {
            room_id: room.id,
            user_id: friend.id,
            invited_by: user.id,
            status: 'invited',
          },
        ]);
      if (participantError) {
          const { error: endRoomError } = await supabase
            .from('call_rooms')
            .update({ status: 'ended' })
            .eq('id', room.id);
          if (endRoomError) console.error('[startCall] Failed to close incomplete room:', endRoomError);
          throw participantError;
        }

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
    let acceptedMembership = false;

    try {
      const { data: room, error: roomError } = await supabase
        .from('call_rooms')
        .select('id, status')
        .eq('id', inc.roomId)
        .maybeSingle();
      if (roomError) throw roomError;
      if (room?.status !== 'active') {
        toast.warning('This call has already ended.');
        endCallCleanup(false);
        return;
      }

      const stream = await acquireMediaStream();
      localStreamRef.current = stream;
      const { data: membership, error } = await supabase
        .from('call_participants')
        .update({
          status: 'active',
          peer_id: peerIdRef.current,
          noise_suppression_enabled: noiseSuppressionActiveRef.current,
          joined_at: new Date().toISOString(),
        })
        .eq('room_id', inc.roomId)
        .eq('user_id', user.id)
        .eq('status', 'invited')
        .select('user_id')
        .maybeSingle();
      if (error) throw error;
      if (!membership) throw new Error('This call invitation is no longer active.');
      acceptedMembership = true;

      dbCallIdRef.current = inc.roomId;
      localMembershipActiveRef.current = true;
      const participants = await refreshCallParticipants(inc.roomId);
      if (participants.length === 0) throw new Error('Could not load members of the call.');
      setIsMuted(false);
      setIsDeafened(false);
      setCallStatus('connected');
      const callState = {
        roomId: inc.roomId,
        callId: inc.roomId,
        friend: inc.caller,
        isVideo: false,
        participants,
      };
      activeCallRef.current = callState;
      setActiveCall(callState);
      incomingCallRef.current = null;
      setIncomingCall(null);
      syncPeerCalls(participants);
    } catch (err) {
      console.error('[answerCall] error:', err);
      localMembershipActiveRef.current = false;
      toast.error(callErrorMessage(err, 'Could not join the call'));
      if (acceptedMembership) {
        try {
          const { error } = await supabase
            .from('call_participants')
            .update({ status: 'left' })
            .eq('room_id', inc.roomId)
            .eq('user_id', user.id);
          if (error) console.error('[answerCall] Failed to roll back membership:', error);
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

    const { error } = await supabase
      .from('call_participants')
      .upsert(newFriends.map((friend) => ({
        room_id: roomId,
        user_id: friend.id,
        invited_by: user.id,
        status: 'invited',
        noise_suppression_enabled: false,
        created_at: new Date().toISOString(),
      })), { onConflict: 'room_id,user_id' });
    if (error) {
      console.error('[Call] Failed to invite participants:', error);
      toast.error('Could not invite those friends.');
      return;
    }

    await refreshCallParticipants(roomId);
    toast.success(`Invited ${newFriends.length} friend${newFriends.length === 1 ? '' : 's'}.`);
  };

  // ─────────────────────────────────────────────────────
  // 5. End Call — الدالة الرئيسية لإنهاء المكالمة
  // ─────────────────────────────────────────────────────
  const endCallCleanup = (updateDb = true) => {
    const roomId = dbCallIdRef.current;
    const wasIncoming = !!incomingCallRef.current && !activeCallRef.current;
    console.log('[endCall] leaving room:', roomId);

    if (updateDb && roomId && user?.id) {
      (async () => {
        const status = wasIncoming ? 'declined' : 'left';
        const { error: leaveError } = await supabase
          .from('call_participants')
          .update({ status })
          .eq('room_id', roomId)
          .eq('user_id', user.id)
          .in('status', ['active', 'invited']);
        if (leaveError) {
          console.error('[endCall] Failed to update participant status:', leaveError);
          toast.error('Could not update your call status.');
          return;
        }

        if (!wasIncoming) {
          const { data: roomParticipants, error: membersError } = await supabase
            .from('call_participants')
            .select('user_id, status')
            .eq('room_id', roomId);
          if (membersError) {
            console.error('[endCall] Failed to check active participants:', membersError);
            return;
          }
          const activeMembers = roomParticipants.filter((participant) => participant.status === 'active');
          if (roomParticipants.length <= 2 || activeMembers.length === 0) {
            const { error: roomError } = await supabase
              .from('call_rooms')
              .update({ status: 'ended' })
              .eq('id', roomId);
            if (roomError) console.error('[endCall] Failed to end empty room:', roomError);
          }
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
        localStreamRef.current.getTracks().forEach(t => {
          t.stop();
          console.log('[endCall] stopped local track:', t.kind);
        });
      }
    } catch (e) {
      console.warn('[endCall] error stopping local tracks:', e);
    }

    try {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => {
          t.stop();
          console.log('[endCall] stopped screen track:', t.kind);
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

    try {
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    } catch (e) {}

    remoteStreamRef.current = null;
    remoteStreamsRef.current = [];
    dbCallIdRef.current = null;
    localMembershipActiveRef.current = false;
    activeCallRef.current = null;
    incomingCallRef.current = null;
    pendingIncomingRoomRef.current = null;
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
    setIsMuted(prev => {
      const next = !prev;

      // 1. كتم/تشغيل مسارات الصوت المحلية
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => {
          t.enabled = !next;
        });
      }

      // 2. كتم/تشغيل في الـ WebRTC Senders مباشرة لضمان عدم وصول أي صوت للطرف الآخر
      getPeerCalls().forEach((call) => {
        const pc = call.peerConnection;
        if (pc) pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !next;
          }
        });
      });

      console.log('[toggleMute] muted =', next);
      return next;
    });
  };

  // ─────────────────────────────────────────────────────
  // 7. Toggle Deafen (كتم سماع صوت الطرف الآخر تماماً)
  // ─────────────────────────────────────────────────────
  const toggleDeafen = () => {
    setIsDeafened(prev => {
      const next = !prev;

      // 1. كتم عنصر الصوت
      remoteAudioElementsRef.current.forEach((element) => {
        element.muted = next;
        element.volume = next ? 0 : 1;
      });

      // 2. كتم مسارات الصوت الواردة نفسها لضمان عدم خروج أي صوت
      remoteStreamsRef.current.forEach(({ stream }) => {
        stream.getAudioTracks().forEach(t => {
          t.enabled = !next;
        });
      });

      // 3. لو deafen -> اكتم المايك تلقائياً زي ديسكورد
      if (next) {
        setIsMuted(true);
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
        }
        getPeerCalls().forEach((call) => {
          const pc = call.peerConnection;
          if (pc) pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
              sender.track.enabled = false;
            }
          });
        });
      }

      console.log('[toggleDeafen] deafened =', next);
      return next;
    });
  };

  // ─────────────────────────────────────────────────────
  // 8. Toggle Camera
  // ─────────────────────────────────────────────────────
  const toggleCamera = async () => {
    if (isVideoEnabled) {
      // إيقاف الكاميرا والعودة للمسار الخامل
      localStreamRef.current?.getVideoTracks().forEach(t => t.stop());
      const blankTrack = createBlankVideoTrack();
      if (blankTrack && localStreamRef.current) {
        localStreamRef.current.addTrack(blankTrack);
      }

      if (blankTrack) await replacePeerTrack('video', blankTrack);

      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setIsVideoEnabled(false);
      sendMediaSignal({ type: 'camera', enabled: false });
    } else {
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: true });
        const vTrack = vs.getVideoTracks()[0];

        // استبدال في الـ local stream
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current.removeTrack(t));
          localStreamRef.current.addTrack(vTrack);
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = vs;
          localVideoRef.current.play().catch(() => {});
        }

        // استبدال في WebRTC sender فورياً ليظهر عند الطرف الآخر
        await replacePeerTrack('video', vTrack);

        setIsVideoEnabled(true);
        sendMediaSignal({ type: 'camera', enabled: true });
      } catch (e) {
        console.error('[toggleCamera]', e);
        toast.error('Could not access camera. Please check browser permissions.');
      }
    }
  };

  // ─────────────────────────────────────────────────────
  // 9. Toggle Screen Share (شغال فورياً عند الطرفين 100%)
  // ─────────────────────────────────────────────────────
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // أوقف المشاركة بأمان — الترتيب مهم جداً لمنع قفل الكول!

      // 1. أولاً: استبدال المسار في الـ PeerConnection بمسار خامل *قبل* إيقاف مسار الشاشة
      //    لأن إيقاف المسار وهو لسه في الـ sender ممكن يسبب ICE failure ويقفل الكول
      const blankTrack = createBlankVideoTrack();
      if (blankTrack) await replacePeerTrack('video', blankTrack);

      // 2. ثانياً: إزالة الـ onended handler لمنع التضارب مع الكود ده
      if (screenStreamRef.current) {
        screenStreamRef.current.getVideoTracks().forEach(t => { t.onended = null; });
      }

      // 3. ثالثاً: إيقاف مسارات الشاشة بأمان (بعد ما المسار الخامل أخد مكانه)
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;

      // 4. تحديث الـ localStream
      if (localStreamRef.current && blankTrack) {
        localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current.removeTrack(t));
        localStreamRef.current.addTrack(blankTrack);
      }

      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setIsScreenSharing(false);
      sendMediaSignal({ type: 'screen', enabled: false });
    } else {
      try {
        const ss = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        screenStreamRef.current = ss;
        const sTrack = ss.getVideoTracks()[0];

        // 1. استبدال المسار فورياً في الـ WebRTC Video Sender ليظهر عند الطرف الآخر فوراً!
        await replacePeerTrack('video', sTrack);

        // 2. ربط الـ stream محلياً فوراً ليظهر عندك أنت أيضاً
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = ss;
          localVideoRef.current.play().catch(() => {});
        }

        setIsScreenSharing(true);
        sendMediaSignal({ type: 'screen', enabled: true });

        setTimeout(() => {
          if (localVideoRef.current && screenStreamRef.current) {
            localVideoRef.current.srcObject = screenStreamRef.current;
            localVideoRef.current.play().catch(() => {});
          }
        }, 100);

        // لما المستخدم يقفل شير من متصفح كروم/ويندوز نفسه (مش من زرارنا)
        sTrack.onended = async () => {
          // 1. أولاً: استبدال المسار في الـ sender بمسار خامل *قبل* أي حاجة تانية
          const blankTrack = createBlankVideoTrack();
          if (blankTrack) await replacePeerTrack('video', blankTrack);

          // 2. تنظيف الحالة
          screenStreamRef.current = null;
          if (localVideoRef.current) localVideoRef.current.srcObject = null;

          // 3. تحديث الـ localStream
          if (localStreamRef.current && blankTrack) {
            localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current.removeTrack(t));
            localStreamRef.current.addTrack(blankTrack);
          }

          setIsScreenSharing(false);
          sendMediaSignal({ type: 'screen', enabled: false });
        };
      } catch (err) {
        console.error('[toggleScreenShare]', err);
      }
    }
  };

  // دالة تشغيل / إيقاف خاصية عزل الضوضاء بالذكاء الاصطناعي (RNNoise)
  const toggleNoiseSuppression = async () => {
    const nextVal = !isNoiseSuppressionEnabled;
    setIsNoiseSuppressionEnabled(nextVal);
    toast.info(nextVal ? 'AI Noise Suppression enabled' : 'AI Noise Suppression disabled');

    if (activeCall && rawMicStreamRef.current && localStreamRef.current) {
      try {
        if (denoiseCleanupRef.current) {
          denoiseCleanupRef.current();
          denoiseCleanupRef.current = null;
        }

        let finalAudioTrack;
        if (nextVal) {
          const { cleanStream, cleanup, isActive } = await applyRnnoiseDenoise(rawMicStreamRef.current);
          denoiseCleanupRef.current = cleanup;
          finalAudioTrack = cleanStream.getAudioTracks()[0] || rawMicStreamRef.current.getAudioTracks()[0];
          noiseSuppressionActiveRef.current = isActive;
          setIsNoiseSuppressionActive(isActive);
          if (!isActive) {
            toast.warning('AI noise suppression could not start; microphone noise reduction remains enabled.');
          }
        } else {
          finalAudioTrack = rawMicStreamRef.current.getAudioTracks()[0];
          noiseSuppressionActiveRef.current = false;
          setIsNoiseSuppressionActive(false);
        }

        if (finalAudioTrack) {
          finalAudioTrack.enabled = !isMuted;
          const oldTrack = localStreamRef.current.getAudioTracks()[0];
          if (oldTrack && oldTrack !== finalAudioTrack) {
            localStreamRef.current.removeTrack(oldTrack);
          }
          if (!localStreamRef.current.getAudioTracks().includes(finalAudioTrack)) {
            localStreamRef.current.addTrack(finalAudioTrack);
          }

          await replacePeerTrack('audio', finalAudioTrack);

          const { error } = await supabase
            .from('call_participants')
            .update({ noise_suppression_enabled: noiseSuppressionActiveRef.current })
            .eq('room_id', activeCall.roomId)
            .eq('user_id', user.id);
          if (error) {
            console.error('[toggleNoiseSuppression] Failed to update status:', error);
            toast.error('Could not update noise-suppression status for the call.');
          }
          const updatedParticipants = callParticipantsRef.current.map((participant) => (
            participant.user_id === user.id
              ? { ...participant, noise_suppression_enabled: noiseSuppressionActiveRef.current }
              : participant
          ));
          callParticipantsRef.current = updatedParticipants;
          setCallParticipants(updatedParticipants);
        }
      } catch (err) {
        console.error('[toggleNoiseSuppression] live switch failed:', err);
        toast.error('Could not change noise suppression for the live call.');
      }
    }
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
      toggleNoiseSuppression,
      microphones,
      speakers,
      selectedMic,
      selectedSpeaker,
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
