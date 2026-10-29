import {
  RnnoiseWorkletNode,
  NoiseGateWorkletNode,
  loadRnnoise,
} from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import noiseGateWorkletPath from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export const DENOISE_SETTINGS = {
  highpassHz: 90,
  gateOpenDb: -52,
  gateCloseDb: -58,
  gateHoldMs: 120,
};

let rnnoiseBinaryPromise = null;

export async function getRnnoiseWasmBinary() {
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
}

const passthrough = (rawStream) => ({
  cleanStream: rawStream,
  audioContext: null,
  rnnoiseNode: null,
  isActive: false,
  cleanup: () => {},
});

export async function applyRnnoiseDenoise(rawStream, existingCtx = null) {
  if (rawStream.getAudioTracks().length === 0) return passthrough(rawStream);

  let audioContext;
  const nodes = [];
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!existingCtx && !AudioContextConstructor) {
      throw new Error('Web Audio API is not supported.');
    }

    audioContext = existingCtx || new AudioContextConstructor({
      sampleRate: 48000,
      latencyHint: 'interactive',
    });
    if (audioContext.state === 'suspended') await audioContext.resume();

    const wasmBinary = await getRnnoiseWasmBinary();
    await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
    await audioContext.audioWorklet.addModule(noiseGateWorkletPath);

    const sourceNode = audioContext.createMediaStreamSource(rawStream);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = DENOISE_SETTINGS.highpassHz;
    highpass.Q.value = 0.7;

    const rnnoiseNode = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1,
    });
    const gateNode = new NoiseGateWorkletNode(audioContext, {
      openThreshold: DENOISE_SETTINGS.gateOpenDb,
      closeThreshold: DENOISE_SETTINGS.gateCloseDb,
      holdMs: DENOISE_SETTINGS.gateHoldMs,
      maxChannels: 1,
    });
    const destinationNode = audioContext.createMediaStreamDestination();

    nodes.push(sourceNode, highpass, rnnoiseNode, gateNode, destinationNode);
    sourceNode.connect(highpass);
    highpass.connect(rnnoiseNode);
    rnnoiseNode.connect(gateNode);
    gateNode.connect(destinationNode);

    const cleanStream = destinationNode.stream;
    const track = cleanStream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') {
      throw new Error('Denoiser did not produce a live audio track.');
    }
    rawStream.getVideoTracks().forEach((videoTrack) => cleanStream.addTrack(videoTrack));

    console.log('[RNNoise] Neural Noise Suppression active 🎙️✨');

    const cleanup = () => {
      nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch (error) {
          console.warn('[Denoise] Could not disconnect audio node:', error);
        }
      });
      rnnoiseNode.destroy?.();
      if (!existingCtx && audioContext.state !== 'closed') {
        audioContext.close().catch((error) => {
          console.warn('[Denoise] Could not close audio context:', error);
        });
      }
    };

    return { cleanStream, audioContext, rnnoiseNode, isActive: true, cleanup };
  } catch (error) {
    console.error('[Denoise] init failed, using raw stream:', error);
    nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch (cleanupError) {
        console.warn('[Denoise] Could not disconnect an audio node:', cleanupError);
      }
    });
    if (!existingCtx && audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch((cleanupError) => {
        console.warn('[Denoise] Could not close audio context:', cleanupError);
      });
    }
    return passthrough(rawStream);
  }
}
