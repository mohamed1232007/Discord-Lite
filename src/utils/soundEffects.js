// Sound effects using Web Audio API + HTMLAudio fallback
let audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// تنشيط الـ AudioContext تلقائياً عند أول تفاعل من المستخدم
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // ignore
    }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

// ─────────────────────────────────────────────────────────
// تشغيل صوت استلام الرسالة (Message Received / Notification Sound)
// ─────────────────────────────────────────────────────────
let notificationAudioEl = null;

export function playMessageReceivedSound(volume = 0.45) {
  // محاولة تشغيل ملف الصوت الأصلي notification.mp3
  try {
    if (typeof window !== 'undefined') {
      if (!notificationAudioEl) {
        notificationAudioEl = new Audio('/sounds/notification.mp3');
        notificationAudioEl.preload = 'auto';
      }
      notificationAudioEl.pause();
      notificationAudioEl.currentTime = 0;
      notificationAudioEl.volume = Math.min(1, Math.max(0, volume));
      const playPromise = notificationAudioEl.play();
      if (playPromise) {
        playPromise.catch(() => {
          // إذا منع المتصفح تشغيل الملف الصوتي، يتم توليد النغمة فوراً عبر Web Audio API
          synthesizeNotificationChime(volume);
        });
        return;
      }
    }
  } catch {
    // Fallback to synthesis
  }

  synthesizeNotificationChime(volume);
}

// توليد نغمة ديسكورد المميزة (Two-tone Chime: G5 784Hz -> C6 1046Hz) بدقة عالية
function synthesizeNotificationChime(volume = 0.4) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // النغمة الأولى (Tone 1 - G5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now);
    gain1.gain.setValueAtTime(volume * 0.8, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.13);

    // النغمة الثانية (Tone 2 - C6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.50, now + 0.08);
    gain2.gain.setValueAtTime(0.0001, now);
    gain2.gain.setValueAtTime(volume, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.36);
  } catch (err) {
    console.warn('[Sound] synthesizeNotificationChime failed:', err);
  }
}
