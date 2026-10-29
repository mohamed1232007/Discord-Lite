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

export const DENOISE_SETTINGS = {
  highpassHz: 90,
  gateOpenDb: -52,
  gateCloseDb: -58,
  gateHoldMs: 120,
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

const passthrough = (rawStream) => ({
  cleanStream: rawStream,
  audioContext: null,
  rnnoiseNode: null,
  isActive: false,
  cleanup: () => {},
});

async function buildChain(rawStream, existingCtx = null, level = 'standard') {
  if (rawStream.getAudioTracks().length === 0) return passthrough(rawStream);

  let audioContext;
  const nodes = [];
  const modelNodes = [];
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

    const sourceNode = audioContext.createMediaStreamSource(rawStream);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = DENOISE_SETTINGS.highpassHz;
    highpass.Q.value = 0.7;

    const destinationNode = audioContext.createMediaStreamDestination();

    const modelStages = level === 'standard'
      ? ['rnnoise']
      : level === 'strong'
        ? ['gtcrn']
        : ['gtcrn', 'rnnoise'];

    await audioContext.audioWorklet.addModule(noiseGateWorkletPath);
    const gateNode = new NoiseGateWorkletNode(audioContext, {
      openThreshold: DENOISE_SETTINGS.gateOpenDb,
      closeThreshold: DENOISE_SETTINGS.gateCloseDb,
      holdMs: DENOISE_SETTINGS.gateHoldMs,
      maxChannels: 1,
    });
    let previousNode = highpass;
    nodes.push(sourceNode, highpass, gateNode, destinationNode);

    for (const stage of modelStages) {
      if (stage === 'gtcrn') {
        const wasmBinary = await getGtcrnWasmBinary();
        await audioContext.audioWorklet.addModule(gtcrnWorkletPath);
        const node = new GtcrnWorkletNode(audioContext, { wasmBinary, maxChannels: 1 });
        modelNodes.push(node);
        nodes.push(node);
        previousNode.connect(node);
        previousNode = node;
      } else {
        const wasmBinary = await getRnnoiseWasmBinary();
        await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
        const node = new RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 1 });
        modelNodes.push(node);
        nodes.push(node);
        previousNode.connect(node);
        previousNode = node;
      }
    }

    sourceNode.connect(highpass);
    previousNode.connect(gateNode);
    gateNode.connect(destinationNode);

    const cleanStream = destinationNode.stream;
    const track = cleanStream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') {
      throw new Error('Denoiser did not produce a live audio track.');
    }
    rawStream.getVideoTracks().forEach((videoTrack) => cleanStream.addTrack(videoTrack));

    console.info(`[Denoise] ${level} noise suppression active.`);

    const cleanup = () => {
      nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch (error) {
          console.warn('[Denoise] Could not disconnect audio node:', error);
        }
      });
      modelNodes.forEach((node) => node.destroy());
      if (!existingCtx && audioContext.state !== 'closed') {
        audioContext.close().catch((error) => {
          console.warn('[Denoise] Could not close audio context:', error);
        });
      }
    };

    return {
      cleanStream,
      audioContext,
      rnnoiseNode: modelNodes.find((node) => node instanceof RnnoiseWorkletNode) || null,
      isActive: true,
      cleanup,
    };
  } catch (error) {
    console.error(`[Denoise] ${level} initialization failed:`, error);
    nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch (cleanupError) {
        console.warn('[Denoise] Could not disconnect an audio node:', cleanupError);
      }
    });
    modelNodes.forEach((node) => {
      try {
        node.destroy();
      } catch (cleanupError) {
        console.warn('[Denoise] Could not destroy a model node:', cleanupError);
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

export async function applyRnnoiseDenoise(rawStream, existingCtx = null, level = 'standard') {
  const result = await buildChain(rawStream, existingCtx, level);
  if (!result.isActive && level !== 'standard') {
    console.warn(`[Denoise] "${level}" failed, falling back to standard.`);
    return buildChain(rawStream, existingCtx, 'standard');
  }
  return result;
}
