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

  // ── Audio Devices State ────────────────────────────────
  const [microphones,     setMicrophones]    = useState([]);
  const [speakers,        setSpeakers]       = useState([]);
  const [selectedMic,     setSelectedMic]    = useState('default');
  const [selectedSpeaker, setSelectedSpeaker]= useState('default');
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] = useState(true);

  // ── Refs (لا تتغيرش بين renders) ──────────────────────
  const peerRef         = useRef(null);      // PeerJS instance
  const peerCallRef     = useRef(null);      // MediaConnection الحالية
  const pendingCallRef  = useRef(null);      // call PeerJS واردة منتظرة Accept
  const localStreamRef  = useRef(null);
  const rawMicStreamRef = useRef(null);      // Raw mic stream قبل الفلتر
  const denoiseCleanupRef = useRef(null);    // دالة تنظيف RNNoise
  const remoteStreamRef = useRef(null);
  const remoteDenoiseCleanupRef = useRef(null); // تنظيف فلتر الطرف المستقبل
  const screenStreamRef = useRef(null);
  const dbCallIdRef     = useRef(null);
  const activeCallRef   = useRef(null);      // mirror of activeCall state (للـ closures)
  const mediaChannelRef = useRef(null);
  const dataConnectionRef = useRef(null);

  // إعداد قناة البيانات المباشرة WebRTC P2P DataChannel
  const setupDataConnection = (conn) => {
    if (!conn) return;
    dataConnectionRef.current = conn;
    conn.on('data', (data) => {
      console.log('[PeerData received]', data);
      if (data?.type === 'screen') {
        setIsRemoteScreenSharing(!!data.enabled);
      } else if (data?.type === 'camera') {
        setIsRemoteCamera(!!data.enabled);
      }
    });
    conn.on('close', () => {
      if (dataConnectionRef.current === conn) {
        dataConnectionRef.current = null;
      }
    });
    conn.on('error', (err) => console.warn('[PeerData error]', err));
  };

  // إرسال إشارات الفيديو والشير سكرين فورياً للطرف الآخر
  const sendMediaSignal = (payload) => {
    const fullPayload = { ...payload, senderId: user?.id };
    // 1. إرسال فوري P2P عبر WebRTC DataChannel (أسرع وأضمن)
    if (dataConnectionRef.current && dataConnectionRef.current.open) {
      try {
        dataConnectionRef.current.send(fullPayload);
      } catch (err) {
        console.warn('[PeerData send error]', err);
      }
    }
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
    if (!activeCall?.friend?.id || !user?.id) {
      if (mediaChannelRef.current) {
        supabase.removeChannel(mediaChannelRef.current);
        mediaChannelRef.current = null;
      }
      setIsRemoteScreenSharing(false);
      setIsRemoteCamera(false);
      return;
    }

    // قناة موحدة ومؤكدة بين الطرفين مباشرة بناءً على User IDs
    const pairId = [user.id, activeCall.friend.id].sort().join('_');
    const ch = supabase.channel(`call-media-${pairId}`)
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
  }, [activeCall?.friend?.id, user?.id]);

  // DOM refs
  const remoteAudioRef = useRef(null);
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);

  // keep activeCallRef & callStatusRef in sync
  const callStatusRef = useRef(callStatus);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

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
    setSelectedMic(deviceId);
    toast.info('Microphone changed successfully');

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
        rawMicStreamRef.current = newRawStream;

        let finalAudioTrack;
        if (isNoiseSuppressionEnabled) {
          const { cleanStream, cleanup } = await applyRnnoiseDenoise(newRawStream);
          denoiseCleanupRef.current = cleanup;
          finalAudioTrack = cleanStream.getAudioTracks()[0] || newRawStream.getAudioTracks()[0];
        } else {
          finalAudioTrack = newRawStream.getAudioTracks()[0];
        }

        // إيقاف المسار القديم
        localStreamRef.current.getAudioTracks().forEach((t) => t.stop());
        localStreamRef.current.removeTrack(localStreamRef.current.getAudioTracks()[0]);
        localStreamRef.current.addTrack(finalAudioTrack);

        // احترام حالة الميوت الحالية
        finalAudioTrack.enabled = !isMuted;

        // استبدال في الـ WebRTC Sender
        const pc = peerCallRef.current?.peerConnection;
        if (pc) {
          const audioSender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
          if (audioSender) {
            audioSender.replaceTrack(finalAudioTrack);
          }
        }
      } catch (err) {
        console.error('[changeMicrophone] Error switching mic:', err);
      }
    }
  };

  // دالة تغيير السماعة
  const changeSpeaker = async (deviceId) => {
    setSelectedSpeaker(deviceId);
    toast.info('Audio output device changed successfully');

    if (remoteAudioRef.current && typeof remoteAudioRef.current.setSinkId === 'function') {
      try {
        await remoteAudioRef.current.setSinkId(deviceId === 'default' ? '' : deviceId);
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
      rawMicStreamRef.current = rawStream;

      // تطبيق الـ RNNoise Neural Denoising لإزالة الضوضاء العميقة
      let processedStream = rawStream;
      if (isNoiseSuppressionEnabled) {
        try {
          const { cleanStream, cleanup } = await applyRnnoiseDenoise(rawStream);
          denoiseCleanupRef.current = cleanup;
          processedStream = cleanStream;
        } catch (e) {
          console.warn('[RNNoise] Failed to apply denoiser on mic, using raw:', e);
        }
      }

      // إضافة مسار فيديو خامل مسبقاً لكي يكون Video Sender جاهزاً للشير سكرين
      const blankTrack = createBlankVideoTrack();
      if (blankTrack) {
        processedStream.addTrack(blankTrack);
      }
      return processedStream;
    } catch (e) {
      console.warn('[Media] mic unavailable, using synthetic stream');
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dst = ctx.createMediaStreamDestination();
      const blankTrack = createBlankVideoTrack();
      if (blankTrack) dst.stream.addTrack(blankTrack);
      return dst.stream;
    }
  };

  // ─────────────────────────────────────────────────────
  // Helper: Attach remote stream to <audio>/<video>
  // ─────────────────────────────────────────────────────
  const attachRemote = async (stream) => {
    console.log('[Remote] attaching stream, tracks:', stream.getTracks().length);
    remoteStreamRef.current = stream;

    // الصوت المستقبَل يتم تشغيله نقياً ومباشراً بدون فلترة مزدوجة
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(e => console.warn('[Audio] play blocked:', e));
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play().catch(e => console.warn('[Video] play blocked:', e));
    }
  };

  // ─────────────────────────────────────────────────────
  // Helper: Setup peerCall event listeners
  // ─────────────────────────────────────────────────────
  const setupCallListeners = (call) => {
    call.on('stream', async (remote) => {
      console.log('[PeerCall] got remote stream ✓');
      setCallStatus('connected'); // ← الاتصال تأكد فعلاً
      await attachRemote(remote);
    });
    call.on('close', () => {
      console.log('[PeerCall] closed');
      endCallCleanup(false);
    });
    call.on('error', (e) => console.error('[PeerCall] error:', e));
  };

  // ─────────────────────────────────────────────────────
  // 1. PeerJS Setup
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const myId = user.id.replace(/-/g, '');
    const p = new Peer(myId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peerRef.current = p;

    p.on('open', () => {
      console.log('[Peer] ready, id =', myId);
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
      pendingCallRef.current = call;
    });

    // اتصال بيانات P2P وارد للإشارات اللحظية
    p.on('connection', (conn) => {
      console.log('[Peer] incoming data connection from:', conn.peer);
      setupDataConnection(conn);
    });

    return () => {
      p.destroy();
      peerRef.current = null;
      setPeerReady(false);
    };
  }, [user?.id]);

  // ─────────────────────────────────────────────────────
  // 2. Watch Supabase calls table
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const checkForIncoming = async () => {
      // 1. فحص المكالمات الواردة
      if (!activeCallRef.current) {
        const { data } = await supabase
          .from('calls')
          .select('*')
          .eq('receiver_id', user.id)
          .eq('status', 'calling')
          .order('created_at', { ascending: false })
          .limit(1);

        if (data?.[0]) triggerIncoming(data[0]);
      }

      // 2. فحص ما إذا تم قبول المكالمة من الطرف الآخر (للمتصل)
      if (dbCallIdRef.current && callStatusRef.current === 'calling') {
        const { data: currentCall } = await supabase
          .from('calls')
          .select('status')
          .eq('id', dbCallIdRef.current)
          .single();

        if (currentCall?.status === 'accepted') {
          console.log('[VoiceContext] Callee accepted call via polling check');
          setCallStatus('connected');
        } else if (currentCall && ['ended', 'rejected'].includes(currentCall.status)) {
          endCallCleanup(false);
        }
      }
    };

    checkForIncoming();
    const poll = setInterval(checkForIncoming, 2000);

    const ch = supabase
      .channel(`calls-watch-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls', filter: `receiver_id=eq.${user.id}` },
        ({ new: rec }) => {
          if (rec?.status === 'calling' && !activeCallRef.current) triggerIncoming(rec);
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls' },
        ({ new: rec }) => {
          if (rec?.id === dbCallIdRef.current) {
            if (rec.status === 'accepted') {
              console.log('[VoiceContext] Callee accepted call via DB event');
              setCallStatus('connected');
            } else if (['ended', 'rejected'].includes(rec.status)) {
              endCallCleanup(false);
            }
          }
        }
      )
      .subscribe();

    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [user?.id]);

  const triggerIncoming = (rec) => {
    // منع التكرار
    if (dbCallIdRef.current === rec.id) return;
    dbCallIdRef.current = rec.id;
    setIncomingCall({
      callId:     rec.id,
      callerId:   rec.caller_id,
      callerName: rec.caller_name || 'Friend'
    });
  };

  // ─────────────────────────────────────────────────────
  // 3. Start Call (المتصل)
  // ─────────────────────────────────────────────────────
  const startCall = async (friend, isVideo = false) => {
    if (!friend?.id) return;
    if (!peerRef.current || !peerReady) {
      toast.warning('Connecting to voice server, please wait a moment...');
      return;
    }

    try {
      const stream = await acquireMediaStream();
      localStreamRef.current = stream;

      // سجّل في DB
      const { data: rec } = await supabase
        .from('calls')
        .insert([{
          caller_id:   user.id,
          receiver_id: friend.id,
          caller_name: user.display_name || user.username || 'User',
          status:      'calling'
        }])
        .select().single();

      if (rec) dbCallIdRef.current = rec.id;

      // اتصل بالطرف الثاني عبر PeerJS
      const targetId = friend.id.replace(/-/g, '');
      console.log('[startCall] calling peer:', targetId);
      const call = peerRef.current.call(targetId, stream);
      peerCallRef.current = call;
      setupCallListeners(call);

      try {
        const conn = peerRef.current.connect(targetId);
        setupDataConnection(conn);
      } catch (e) {
        console.warn('[startCall] data conn error:', e);
      }

      setIsMuted(false);
      setIsDeafened(false);
      setCallStatus('calling'); // بيرن — لحد ما الطرف التاني يرد ويوصل stream
      setActiveCall({ friend, isVideo, callId: rec?.id });
    } catch (err) {
      console.error('[startCall] error:', err);
    }
  };

  // ─────────────────────────────────────────────────────
  // 4. Answer Call (المستقبِل)
  // ─────────────────────────────────────────────────────
  const answerCall = async () => {
    const inc = incomingCall;
    if (!inc) return;

    try {
      const stream = await acquireMediaStream();
      localStreamRef.current = stream;

      const doAnswer = (call) => {
        peerCallRef.current = call;
        pendingCallRef.current = null;
        call.answer(stream);
        setupCallListeners(call);
        console.log('[answerCall] answered ✓');
      };

      if (pendingCallRef.current) {
        // PeerJS call وصلت مسبقاً
        doAnswer(pendingCallRef.current);
      } else {
        // PeerJS call لسه مجاش → استنّى حتى 8 ثواني
        console.log('[answerCall] waiting for PeerJS call...');
        let waited = 0;
        const wait = setInterval(() => {
          waited += 200;
          if (pendingCallRef.current) {
            clearInterval(wait);
            doAnswer(pendingCallRef.current);
          } else if (waited >= 8000) {
            clearInterval(wait);
            console.warn('[answerCall] timeout waiting for PeerJS call');
          }
        }, 200);
      }

      // حدّث DB
      await supabase.from('calls').update({ status: 'accepted' }).eq('id', inc.callId);

      try {
        const callerTargetId = inc.callerId.replace(/-/g, '');
        const conn = peerRef.current.connect(callerTargetId);
        setupDataConnection(conn);
      } catch (e) {
        console.warn('[answerCall] data conn error:', e);
      }

      setIsMuted(false);
      setIsDeafened(false);
      setCallStatus('connected'); // المستقبِل يبدأ connected مباشرة
      setActiveCall({
        friend: { id: inc.callerId, display_name: inc.callerName, username: inc.callerName },
        isVideo: false,
        callId: inc.callId
      });
      setIncomingCall(null);
    } catch (err) {
      console.error('[answerCall] error:', err);
    }
  };

  // ─────────────────────────────────────────────────────
  // 5. End Call — الدالة الرئيسية لإنهاء المكالمة
  // ─────────────────────────────────────────────────────
  const endCallCleanup = (updateDb = true) => {
    console.log('[endCall] cleaning up, updateDb =', updateDb);

    const recId = dbCallIdRef.current;

    // 1. تحديث قاعدة البيانات بأمان تام بدون أي أخطاء توقف الكود
    if (updateDb && recId) {
      try {
        supabase
          .from('calls')
          .update({ status: 'ended' })
          .eq('id', recId)
          .then(() => {
            console.log('[endCall] DB status updated to ended');
          }, (err) => {
            console.warn('[endCall] DB update error ignored:', err);
          });
      } catch (err) {
        console.warn('[endCall] Supabase call failed:', err);
      }
    }

    // 2. إيقاف جميع مسارات الصوت والشاشة فوراً
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

    // 3. إغلاق اتصال PeerJS بأمان
    try {
      if (peerCallRef.current) {
        peerCallRef.current.close();
      }
    } catch (e) {
      console.warn('[endCall] error closing peerCall:', e);
    }
    peerCallRef.current    = null;
    pendingCallRef.current = null;
    if (dataConnectionRef.current) {
      try { dataConnectionRef.current.close(); } catch {}
      dataConnectionRef.current = null;
    }

    // 4. تصفير عناصر الصوت والفيديو
    try {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
      }
    } catch (e) {}

    try {
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    } catch (e) {}

    remoteStreamRef.current = null;
    dbCallIdRef.current     = null;

    // 5. تصفير الـ state فوراً لغلق الشاشة
    stopDiscordRingtone();
    setActiveCall(null);
    setIncomingCall(null);
    setCallStatus('idle');
    setIsMuted(false);
    setIsDeafened(false);
    setIsVideoEnabled(false);
    setIsScreenSharing(false);
    setIsRemoteScreenSharing(false);
    setIsRemoteCamera(false);
  };

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
      const pc = peerCallRef.current?.peerConnection;
      if (pc) {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !next;
          }
        });
      }

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
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = next;
        remoteAudioRef.current.volume = next ? 0 : 1;
      }

      // 2. كتم مسارات الصوت الواردة نفسها لضمان عدم خروج أي صوت
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getAudioTracks().forEach(t => {
          t.enabled = !next;
        });
      }

      // 3. لو deafen -> اكتم المايك تلقائياً زي ديسكورد
      if (next) {
        setIsMuted(true);
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
        }
        const pc = peerCallRef.current?.peerConnection;
        if (pc) {
          pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
              sender.track.enabled = false;
            }
          });
        }
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

      const pc = peerCallRef.current?.peerConnection;
      if (pc && blankTrack) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video') || pc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'video')?.sender;
        if (videoSender) videoSender.replaceTrack(blankTrack);
      }

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
        const pc = peerCallRef.current?.peerConnection;
        if (pc) {
          const videoSender = pc.getSenders().find(s => s.track?.kind === 'video') || pc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'video')?.sender;
          if (videoSender) {
            videoSender.replaceTrack(vTrack);
          }
        }

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
      const pc = peerCallRef.current?.peerConnection;
      if (pc && blankTrack) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video') || pc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'video')?.sender;
        if (videoSender) {
          try {
            await videoSender.replaceTrack(blankTrack);
          } catch (e) {
            console.warn('[toggleScreenShare] replaceTrack error:', e);
          }
        }
      }

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
        const pc = peerCallRef.current?.peerConnection;
        if (pc) {
          const videoSender = pc.getSenders().find(s => s.track?.kind === 'video') || pc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'video')?.sender;
          if (videoSender) {
            console.log('[ScreenShare] replacing video track in sender ✓');
            await videoSender.replaceTrack(sTrack);
          } else {
            console.log('[ScreenShare] no video sender, adding track');
            pc.addTrack(sTrack, ss);
          }
        }

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
          const currentPc = peerCallRef.current?.peerConnection;
          if (currentPc && blankTrack) {
            const videoSender = currentPc.getSenders().find(s => s.track?.kind === 'video') || currentPc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'video')?.sender;
            if (videoSender) {
              try {
                await videoSender.replaceTrack(blankTrack);
              } catch (e) {
                console.warn('[ScreenShare onended] replaceTrack error:', e);
              }
            }
          }

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
    toast.info(nextVal ? 'Noise Suppression (RNNoise) Enabled' : 'Noise Suppression Disabled');

    if (activeCall && rawMicStreamRef.current && localStreamRef.current) {
      try {
        if (denoiseCleanupRef.current) {
          denoiseCleanupRef.current();
          denoiseCleanupRef.current = null;
        }

        let finalAudioTrack;
        if (nextVal) {
          const { cleanStream, cleanup } = await applyRnnoiseDenoise(rawMicStreamRef.current);
          denoiseCleanupRef.current = cleanup;
          finalAudioTrack = cleanStream.getAudioTracks()[0] || rawMicStreamRef.current.getAudioTracks()[0];
        } else {
          finalAudioTrack = rawMicStreamRef.current.getAudioTracks()[0];
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

          const pc = peerCallRef.current?.peerConnection;
          if (pc) {
            const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio') || pc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'audio')?.sender;
            if (audioSender) {
              await audioSender.replaceTrack(finalAudioTrack);
            }
          }
        }
      } catch (err) {
        console.warn('[toggleNoiseSuppression] live switch warning:', err);
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
      incomingCall,
      callStatus,
      isMuted,
      isDeafened,
      isVideoEnabled,
      isScreenSharing,
      isRemoteScreenSharing,
      isRemoteCamera,
      isNoiseSuppressionEnabled,
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
      remoteStreamRef,
      localStreamRef,
      screenStreamRef,
      startCall,
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
