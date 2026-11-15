import {
  getLogger,
  LoggerNames,
  LogLevel,
  setLogLevel,
} from 'livekit-client';

let krispModulePromise;
let previousLiveKitLogLevels = null;

const liveKitLoggerNames = [...new Set(Object.values(LoggerNames))];

const suppressLiveKitLogs = () => {
  if (previousLiveKitLogLevels === null) {
    previousLiveKitLogLevels = liveKitLoggerNames.map((name) => [
      name,
      getLogger(name).getLevel(),
    ]);
  }
  setLogLevel(LogLevel.warn);
};

const restoreLiveKitLogs = () => {
  if (previousLiveKitLogLevels === null) return;
  previousLiveKitLogLevels.forEach(([name, level]) => {
    setLogLevel(level, name);
  });
  previousLiveKitLogLevels = null;
};

const loadKrispModule = () => {
  if (!krispModulePromise) {
    krispModulePromise = import('@livekit/krisp-noise-filter').catch((error) => {
      krispModulePromise = null;
      throw error;
    });
  }
  return krispModulePromise;
};

export const isKrispSupported = async () => {
  const module = await loadKrispModule();
  return module.isKrispNoiseFilterSupported();
};

const verifyKrispActivation = (track, processor) => {
  const active = processor.isEnabled();
  const processedTrack = processor.processedTrack;
  const processedTrackState = processedTrack?.readyState;
  const senderUsesProcessedTrack = track.sender?.track === processedTrack;
  const status = { active, processedTrackState, senderUsesProcessedTrack };
  console.info('[Krisp] Processor status:', status);

  if (!active || processedTrackState !== 'live' || !senderUsesProcessedTrack) {
    throw new Error('Krisp did not attach an enabled live audio processor to the LiveKit sender.');
  }
};

const softExpanderWorklet = `
class KrispSoftExpander extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gain = 1;
    this.attack = Math.exp(-1 / (sampleRate * 0.005));
    this.release = Math.exp(-1 / (sampleRate * 0.12));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    let energy = 0;
    let sampleCount = 0;
    for (const channel of input) {
      for (let i = 0; i < channel.length; i += 1) {
        energy += channel[i] * channel[i];
      }
      sampleCount += channel.length;
    }

    const rms = sampleCount ? Math.sqrt(energy / sampleCount) : 0;
    const target = rms >= 0.01 ? 1 : Math.max(0.18, rms / 0.01);
    const frameCount = output[0].length;
    for (let i = 0; i < frameCount; i += 1) {
      const smoothing = target > this.gain ? this.attack : this.release;
      this.gain += (target - this.gain) * (1 - smoothing);
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        const source = input[Math.min(channelIndex, input.length - 1)];
        output[channelIndex][i] = (source?.[i] || 0) * this.gain;
      }
    }
    return true;
  }
}

registerProcessor('krisp-soft-expander', KrispSoftExpander);
`;

class KrispTrackProcessor {
  constructor(processor, { postProcessing = true } = {}) {
    this.name = 'livekit-noise-filter';
    this.processor = processor;
    this.postProcessing = postProcessing;
    this.processedTrack = undefined;
    this.audioContext = null;
    this.source = null;
    this.highPass = null;
    this.expander = null;
    this.destination = null;
    this.inputTrack = null;
    this.onKrispEnable = null;
    this.onKrispDisable = null;
  }

  async init(options) {
    await this.processor.init(options);
    if (this.postProcessing) {
      await this.connectPostProcessing();
    } else {
      this.processedTrack = this.processor.processedTrack;
    }
    if (!this.processedTrack) {
      throw new Error('Krisp did not produce an audio track.');
    }
  }

  async restart(options) {
    await this.disposePostProcessing();
    await this.processor.restart(options);
    if (this.postProcessing) {
      await this.connectPostProcessing();
    } else {
      this.processedTrack = this.processor.processedTrack;
    }
    if (!this.processedTrack) {
      throw new Error('Krisp did not produce an audio track after restart.');
    }
  }

  async onPublish(room) {
    await this.processor.onPublish?.(room);
  }

  setEnabled(enabled) {
    return this.processor.setEnabled(enabled);
  }

  isEnabled() {
    return this.processor.isEnabled();
  }

  async connectPostProcessing() {
    const inputTrack = this.processor.processedTrack;
    if (!inputTrack || inputTrack.readyState !== 'live') {
      throw new Error('Krisp did not provide a live track for post-processing.');
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor || typeof AudioWorkletNode === 'undefined') {
      throw new Error('Krisp post-processing is not supported in this WebView.');
    }

    const sampleRate = inputTrack.getSettings?.().sampleRate;
    let context;
    try {
      context = new AudioContextConstructor({
        latencyHint: 'interactive',
        ...(sampleRate ? { sampleRate } : {}),
      });
    } catch (error) {
      if (!sampleRate) throw error;
      console.warn('[Krisp] Could not match the post-processing sample rate; using the default.', error);
      context = new AudioContextConstructor({ latencyHint: 'interactive' });
    }
    this.audioContext = context;

    if (context.state === 'suspended') await context.resume();

    const moduleUrl = URL.createObjectURL(
      new Blob([softExpanderWorklet], { type: 'application/javascript' }),
    );
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }

    const channels = Math.max(1, Math.min(2, inputTrack.getSettings?.().channelCount || 1));
    const source = context.createMediaStreamSource(new MediaStream([inputTrack]));
    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 85;
    highPass.Q.value = 0.707;
    const expander = new AudioWorkletNode(context, 'krisp-soft-expander', {
      channelCount: channels,
      channelCountMode: 'explicit',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
    });
    expander.addEventListener('processorerror', (error) => {
      console.error('[Krisp] Soft expander AudioWorklet failed:', error);
    });
    const destination = context.createMediaStreamDestination();

    source.connect(highPass);
    highPass.connect(expander);
    expander.connect(destination);

    this.source = source;
    this.highPass = highPass;
    this.expander = expander;
    this.destination = destination;
    this.processedTrack = destination.stream.getAudioTracks()[0];
    this.inputTrack = inputTrack;
    this.onKrispEnable = () => {
      this.processedTrack?.dispatchEvent(new Event('enable-lk-krisp-noise-filter'));
    };
    this.onKrispDisable = () => {
      this.processedTrack?.dispatchEvent(new Event('disable-lk-krisp-noise-filter'));
    };
    inputTrack.addEventListener('enable-lk-krisp-noise-filter', this.onKrispEnable);
    inputTrack.addEventListener('disable-lk-krisp-noise-filter', this.onKrispDisable);
  }

  async disposePostProcessing() {
    if (this.inputTrack && this.onKrispEnable) {
      this.inputTrack.removeEventListener('enable-lk-krisp-noise-filter', this.onKrispEnable);
    }
    if (this.inputTrack && this.onKrispDisable) {
      this.inputTrack.removeEventListener('disable-lk-krisp-noise-filter', this.onKrispDisable);
    }

    const nodes = [this.source, this.highPass, this.expander, this.destination];
    nodes.forEach((node) => {
      if (!node) return;
      try {
        node.disconnect();
      } catch (error) {
        console.warn('[Krisp] Could not disconnect a post-processing audio node:', error);
      }
    });

    this.destination?.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.warn('[Krisp] Could not stop a post-processing audio track:', error);
      }
    });

    const context = this.audioContext;
    this.source = null;
    this.highPass = null;
    this.expander = null;
    this.destination = null;
    this.inputTrack = null;
    this.onKrispEnable = null;
    this.onKrispDisable = null;
    this.audioContext = null;
    this.processedTrack = undefined;

    if (context && context.state !== 'closed') {
      try {
        await context.close();
      } catch (error) {
        console.warn('[Krisp] Could not close the post-processing AudioContext:', error);
      }
    }
  }

  async destroy() {
    await this.disposePostProcessing();
    await this.processor.destroy();
    this.processedTrack = undefined;
  }
}

const installKrispProcessor = async (track, module, options, postProcessing = true) => {
  const processor = new KrispTrackProcessor(module.KrispNoiseFilter(options), { postProcessing });
  try {
    const sourceTrack = track.mediaStreamTrack;
    const settings = sourceTrack?.getSettings?.();
    console.info('[Krisp] Installing processor on published LiveKit microphone track.', {
      useBVC: options.useBVC === true,
      postProcessing,
      sourceReadyState: sourceTrack?.readyState,
      sourceSampleRate: settings?.sampleRate,
      sourceChannelCount: settings?.channelCount,
    });
    await track.setProcessor(processor);
    if (track.getProcessor() !== processor) {
      throw new Error('LiveKit did not retain the Krisp processor on the microphone track.');
    }
    await processor.setEnabled(true);
    verifyKrispActivation(track, processor);
    return processor;
  } catch (error) {
    if (track.getProcessor() === processor) {
      await track.stopProcessor().catch((disposeError) => {
        console.warn('[Krisp] Could not dispose the failed noise filter:', disposeError);
      });
    } else {
      await processor.destroy().catch((disposeError) => {
        console.warn('[Krisp] Could not dispose the uninstalled noise filter:', disposeError);
      });
    }
    throw error;
  }
};

export const enableKrisp = async (track) => {
  if (!track || typeof track.setProcessor !== 'function') {
    throw new Error('Krisp requires a published LiveKit local audio track.');
  }

  suppressLiveKitLogs();
  try {
    const module = await loadKrispModule();
    if (!module.isKrispNoiseFilterSupported()) {
      throw new Error('Krisp noise filtering is not supported in this WebView.');
    }

    const processor = track.getProcessor();
    if (processor?.name === 'livekit-noise-filter') {
      await processor.setEnabled(true);
      verifyKrispActivation(track, processor);
      console.info('[Krisp] Existing LiveKit processor is active.');
      return processor;
    }
    if (processor) {
      throw new Error(`Cannot enable Krisp while "${processor.name}" is processing the microphone.`);
    }

    const attempts = [
      {
        label: 'BVC Krisp with post-processing',
        options: { debugLogs: false, useBVC: true },
        postProcessing: true,
      },
      {
        label: 'standard Krisp with post-processing',
        options: { debugLogs: false },
        postProcessing: true,
      },
      {
        label: 'standard Krisp without optional post-processing',
        options: { debugLogs: false },
        postProcessing: false,
      },
    ];
    const failures = [];

    for (const attempt of attempts) {
      try {
        const processor = await installKrispProcessor(
          track,
          module,
          attempt.options,
          attempt.postProcessing,
        );
        console.info(`[Krisp] ${attempt.label} is active.`);
        return processor;
      } catch (error) {
        failures.push({ label: attempt.label, error });
        if (attempt !== attempts[attempts.length - 1]) {
          console.warn(`[Krisp] ${attempt.label} failed; trying the next fallback.`, error);
        }
      }
    }

    const combinedError = new Error(
      `Krisp initialization failed: ${failures.map(({ label, error }) => (
        `${label}: ${error?.message || error}`
      )).join('; ')}`,
    );
    combinedError.status = failures.find(({ error }) => error?.status)?.error?.status;
    throw combinedError;
  } catch (error) {
    restoreLiveKitLogs();
    throw error;
  }
};

export const disableKrisp = async (track) => {
  const processor = track?.getProcessor?.();
  if (processor?.name !== 'livekit-noise-filter') {
    restoreLiveKitLogs();
    return false;
  }

  try {
    try {
      await processor.setEnabled(false);
    } catch (error) {
      console.warn('[Krisp] Could not disable the filter cleanly; stopping its processor:', error);
    }
    await track.stopProcessor();
    return true;
  } finally {
    restoreLiveKitLogs();
  }
};
