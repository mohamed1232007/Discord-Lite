import {
  GtcrnWorkletNode,
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  loadGtcrn,
  loadRnnoise,
} from '@sapphi-red/web-noise-suppressor';
import gtcrnWorkletPath from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import noiseGateWorkletPath from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import gtcrnWasmPath from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

// مدة الـ crossfade عند تبديل مستوى/تشغيل إزالة الضوضاء.
// بدونها كان التبديل بيعمل نطة/انقطاع لحظي في الصوت.
const CROSSFADE_SECONDS = 0.14;
const WARMUP_MS = 200;
const DISPOSE_DELAY_MS = Math.round(CROSSFADE_SECONDS * 1000) + 90;

export const DENOISE_SETTINGS = {
  crossfadeMs: Math.round(CROSSFADE_SECONDS * 1000),
  levels: {
    standard: {
      stages: ['rnnoise'],
      highpassHz: 90,
      gateOpenDb: -52,
      gateCloseDb: -58,
    },
    strong: {
      stages: ['gtcrn'],
      highpassHz: 90,
      gateOpenDb: -52,
      gateCloseDb: -58,
    },
    // Maximum: أقوى موديل (GTCRN) + أقصى فلترة (بوابة ضوضاء أكثر صرامة).
    // ملاحظة مهمة: تشغيل موديلين ورا بعض (gtcrn ثم rnnoise) كان بيطلّع
    // صوت صامت تمامًا على أجهزة كثيرة، فبنستخدم موديل واحد موثوق بدل السلسلة.
    max: {
      stages: ['gtcrn'],
      highpassHz: 120,
      gateOpenDb: -40,
      gateCloseDb: -48,
    },
  },
};

const FALLBACK_LEVELS = {
  max: ['max', 'strong', 'standard'],
  strong: ['strong', 'standard'],
  standard: ['standard'],
};

let rnnoiseBinaryPromise = null;
let gtcrnBinaryPromise = null;

const getRnnoiseWasmBinary = () => {
  if (!rnnoiseBinaryPromise) {
    rnnoiseBinaryPromise = loadRnnoise({
      url: rnnoiseWasmPath,
      simdUrl: rnnoiseSimdWasmPath,
    }).catch((error) => {
      rnnoiseBinaryPromise = null;
      throw error;
    });
  }
  return rnnoiseBinaryPromise;
};

const getGtcrnWasmBinary = () => {
  if (!gtcrnBinaryPromise) {
    gtcrnBinaryPromise = loadGtcrn({ url: gtcrnWasmPath }).catch((error) => {
      gtcrnBinaryPromise = null;
      throw error;
    });
  }
  return gtcrnBinaryPromise;
};

export const preloadDenoiser = (level = 'standard') => (
  DENOISE_SETTINGS.levels[level]?.stages.includes('gtcrn')
    ? getGtcrnWasmBinary()
    : getRnnoiseWasmBinary()
);

// الـ ArrayBuffer الواحد ممكن يستهلكه أول Worklet، وتمريره تاني لنفس العقدة
// أو لعقدة جديدة كان بيخلّي الموديل يفشل بهدوء => صوت صامت.
// فبنمرّر نسخة جديدة لكل عقدة.
const copyBinary = (binary) => (
  binary && typeof binary.slice === 'function' ? binary.slice(0) : binary
);

const destroyAudioNode = (node) => {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // العقدة ممكن تكون متوصلة بالفعل
  }
  try {
    node.destroy?.();
  } catch (error) {
    console.warn('[Denoise] Could not destroy an audio node:', error);
  }
};

const forceMono = (node) => {
  try {
    node.channelCount = 1;
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'discrete';
  } catch (error) {
    console.warn('[Denoise] Could not force a mono channel layout:', error);
  }
};

const rampParam = (param, value, now, seconds) => {
  try {
    if (seconds <= 0) {
      param.cancelScheduledValues(now);
      param.value = value;
      return;
    }
    // cancelAndHoldAtTime بيثبّت القيمة الحالية بدل ما يرجّعها لصفر،
    // فلو في fade شغال بالفعل التبديل الجديد يكمّل من مكانه بدون نطة.
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(value, now + seconds);
  } catch (error) {
    console.warn('[Denoise] Could not ramp an audio parameter:', error);
    try {
      param.value = value;
    } catch {
      // تجاهل
    }
  }
};

/**
 * محرك إزالة الضوضاء.
 *
 * بيحتفظ بـ AudioContext واحد وبنفس الـ output track طول المكالمة، فتبديل
 * المستوى أو تشغيل/إيقاف الفلتر بيحصل جوه الـ graph نفسه مع crossfade —
 * من غير replaceTrack ومن غير أي انقطاع في الصوت المرسل للطرف التاني.
 */
export class DenoiseEngine {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.mixBus = null;
    this.destination = null;
    this.dryGain = null;
    this.chain = null;
    this.level = 'standard';
    this.enabled = false;
    this.destroyed = false;
    this.loadedModules = new Set();
    this.disposeTimers = new Set();
    this.queue = Promise.resolve();
  }

  // بنسلسل عمليات التبديل عشان الضغط السريع على المستويات ما ينتجش
  // أكتر من سلسلة صوتية شغالة في نفس الوقت.
  _runExclusive(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  get outputTrack() {
    return this.destination?.stream.getAudioTracks()[0] || null;
  }

  get isActive() {
    return !!(this.enabled && this.chain);
  }

  async _ensureGraph() {
    if (this.destroyed) throw new Error('The denoise engine has been destroyed.');
    if (this.ctx) return;

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error('Web Audio API is not supported.');
    }

    let ctx;
    try {
      ctx = new AudioContextConstructor({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch (error) {
      console.warn('[Denoise] 48kHz audio context is unavailable, using the default rate:', error);
      ctx = new AudioContextConstructor({ latencyHint: 'interactive' });
    }

    const mixBus = ctx.createGain();
    const destination = ctx.createMediaStreamDestination();
    mixBus.connect(destination);

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1;
    dryGain.connect(mixBus);

    this.ctx = ctx;
    this.mixBus = mixBus;
    this.destination = destination;
    this.dryGain = dryGain;

    await this._ensureModule(noiseGateWorkletPath);

    if (ctx.state === 'suspended') {
      await ctx.resume().catch((error) => {
        console.warn('[Denoise] Could not resume the audio context:', error);
      });
    }

    if (typeof ctx.addEventListener === 'function') {
      ctx.addEventListener('statechange', () => {
        if (this.ctx === ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      });
    }
  }

  async _ensureModule(url) {
    if (this.loadedModules.has(url)) return;
    await this.ctx.audioWorklet.addModule(url);
    this.loadedModules.add(url);
  }

  async _createModelNode(stage) {
    const ctx = this.ctx;

    if (stage === 'gtcrn') {
      if (ctx.sampleRate !== 48000 && ctx.sampleRate !== 16000) {
        throw new Error(`GTCRN does not support a ${ctx.sampleRate}Hz audio context.`);
      }
      const wasmBinary = copyBinary(await getGtcrnWasmBinary());
      await this._ensureModule(gtcrnWorkletPath);
      const node = new GtcrnWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
      forceMono(node);
      return node;
    }

    // RNNoise بيشتغل بمعدل 48kHz بس (الإطار 480 عينة). على أي معدل تاني
    // الموديل بيطلّع صوت مشوّه/صامت، فالأفضل نفشل ونرجع للفلتر الأصلي.
    if (ctx.sampleRate !== 48000) {
      throw new Error(`RNNoise requires a 48000Hz audio context (got ${ctx.sampleRate}Hz).`);
    }
    const wasmBinary = copyBinary(await getRnnoiseWasmBinary());
    await this._ensureModule(rnnoiseWorkletPath);
    const node = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    forceMono(node);
    return node;
  }

  async _buildChain(level) {
    const config = DENOISE_SETTINGS.levels[level];
    if (!config) throw new Error(`Unknown noise suppression level: ${level}`);

    const ctx = this.ctx;
    const created = [];

    try {
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = config.highpassHz;
      highpass.Q.value = 0.7;
      created.push(highpass);

      let tail = highpass;
      for (const stage of config.stages) {
        const node = await this._createModelNode(stage);
        created.push(node);
        tail.connect(node);
        tail = node;
      }

      const gate = new NoiseGateWorkletNode(ctx, {
        openThreshold: config.gateOpenDb,
        closeThreshold: config.gateCloseDb,
        holdMs: 120,
        maxChannels: 1,
      });
      created.push(gate);
      tail.connect(gate);

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gate.connect(gain);
      gain.connect(this.mixBus);

      return { level, head: highpass, gain, nodes: created };
    } catch (error) {
      created.forEach(destroyAudioNode);
      throw error;
    }
  }

  _disposeChain(chain) {
    if (!chain) return;
    if (this.source) {
      try {
        this.source.disconnect(chain.head);
      } catch {
        // العقدة ممكن تكون متوصلة بالفعل
      }
    }
    chain.nodes.forEach(destroyAudioNode);
    try {
      chain.gain.disconnect();
    } catch {
      // تجاهل
    }
  }

  _scheduleDispose(chain) {
    const timer = setTimeout(() => {
      this.disposeTimers.delete(timer);
      if (this.destroyed || this.chain === chain) return;
      this._disposeChain(chain);
    }, DISPOSE_DELAY_MS);
    this.disposeTimers.add(timer);
  }

  async _applyLevel(level, { instant = false } = {}) {
    const target = DENOISE_SETTINGS.levels[level] ? level : 'standard';
    if (this.chain && this.chain.level === target) return target;

    const attempts = FALLBACK_LEVELS[target] || [target];
    let next = null;
    for (const candidate of attempts) {
      try {
        next = await this._buildChain(candidate);
        break;
      } catch (error) {
        console.warn(`[Denoise] "${candidate}" could not start:`, error);
      }
    }
    if (!next) return this.chain?.level || null;
    if (this.destroyed || !this.ctx) {
      this._disposeChain(next);
      return null;
    }

    if (this.source) this.source.connect(next.head);

    const previous = this.chain;

    // ننتظر شوية قبل الـ crossfade عشان موديل الضوضاء الجديد يملأ الـ buffers
    // بتاعته (وبالتالي مايحصلش هبوط في الصوت في نص التبديل).
    // الـ dry/السلسلة القديمة بيفضلوا مسموعين طول الانتظار، فمفيش صمت.
    if (!instant && this.enabled) {
      await new Promise((resolve) => { setTimeout(resolve, WARMUP_MS); });
      if (this.destroyed || !this.ctx) {
        this._disposeChain(next);
        return null;
      }
    }

    const now = this.ctx.currentTime;
    const fade = instant ? 0 : CROSSFADE_SECONDS;
    this.chain = next;
    this.level = next.level;

    if (instant) {
      next.gain.gain.value = this.enabled ? 1 : 0;
    } else if (this.enabled) {
      rampParam(next.gain.gain, 1, now, fade);
    }

    if (previous) {
      rampParam(previous.gain.gain, 0, now, fade);
      this._scheduleDispose(previous);
    }

    console.info(`[Denoise] ${next.level} noise suppression active.`);
    return next.level;
  }

  // عام: بيتسلسل مع تبديل المستوى عشان مايتغيّرش المصدر في نص الـ crossfade
  // (لو حصل ده، السلسلة الجديدة تفضل من غير صوت => صمت).
  async setSource(rawStream) {
    return this._runExclusive(() => this._setSource(rawStream));
  }

  async _setSource(rawStream) {
    if (this.destroyed) throw new Error('The denoise engine has been destroyed.');
    if (!rawStream?.getAudioTracks().length) {
      throw new Error('The microphone stream has no audio track.');
    }

    await this._ensureGraph();

    const source = this.ctx.createMediaStreamSource(rawStream);
    source.connect(this.dryGain);
    if (this.chain) source.connect(this.chain.head);

    const previous = this.source;
    this.source = source;
    if (previous) {
      try {
        previous.disconnect();
      } catch {
        // تجاهل
      }
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    return source;
  }

  async start(rawStream, { enabled = true, level = 'standard' } = {}) {
    if (this.destroyed) throw new Error('The denoise engine has been destroyed.');

    this.enabled = !!enabled;
    this.level = DENOISE_SETTINGS.levels[level] ? level : 'standard';

    return this._runExclusive(async () => {
      if (this.destroyed) throw new Error('The denoise engine has been destroyed.');

      await this._ensureGraph();
      await this._setSource(rawStream);

      if (this.enabled) {
        await this._applyLevel(this.level, { instant: true });
      }

      if (this.enabled && this.chain) {
        this.chain.gain.gain.value = 1;
        this.dryGain.gain.value = 0;
      } else {
        this.dryGain.gain.value = 1;
      }

      return {
        track: this.outputTrack,
        active: this.isActive,
        level: this.chain?.level || null,
      };
    });
  }

  async setLevel(level) {
    this.level = DENOISE_SETTINGS.levels[level] ? level : 'standard';
    return this._runExclusive(async () => {
      if (!this.ctx || !this.enabled) return this.chain?.level || null;
      return this._applyLevel(this.level);
    });
  }

  async setEnabled(enabled) {
    const next = !!enabled;
    return this._runExclusive(async () => {
      this.enabled = next;
      if (!this.ctx) return false;

      if (next) {
        if (!this.chain) await this._applyLevel(this.level);

        // لو مفيش سلسلة معالجة شغالة، نسيب الصوت الخام مسموع
        // بدل ما نقفل الـ dry ونطلّع صمت.
        if (!this.chain) {
          rampParam(this.dryGain.gain, 1, this.ctx.currentTime, CROSSFADE_SECONDS);
          return false;
        }

        const now = this.ctx.currentTime;
        rampParam(this.chain.gain.gain, 1, now, CROSSFADE_SECONDS);
        rampParam(this.dryGain.gain, 0, now, CROSSFADE_SECONDS);
        return true;
      }

      const now = this.ctx.currentTime;
      rampParam(this.dryGain.gain, 1, now, CROSSFADE_SECONDS);
      if (this.chain) {
        const chain = this.chain;
        this.chain = null;
        rampParam(chain.gain.gain, 0, now, CROSSFADE_SECONDS);
        this._scheduleDispose(chain);
      }
      return false;
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.disposeTimers.forEach((timer) => clearTimeout(timer));
    this.disposeTimers.clear();

    const chain = this.chain;
    this.chain = null;
    this._disposeChain(chain);

    try {
      this.source?.disconnect();
    } catch {
      // تجاهل
    }
    try {
      this.dryGain?.disconnect();
    } catch {
      // تجاهل
    }
    try {
      this.mixBus?.disconnect();
    } catch {
      // تجاهل
    }

    const destination = this.destination;
    this.destination = null;
    if (destination) {
      destination.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // تجاهل
        }
      });
      try {
        destination.disconnect();
      } catch {
        // تجاهل
      }
    }

    const ctx = this.ctx;
    this.ctx = null;
    this.source = null;
    this.dryGain = null;
    this.mixBus = null;

    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch((error) => {
        console.warn('[Denoise] Could not close the audio context:', error);
      });
    }
  }
}
