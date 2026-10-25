import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let rnnoiseBinaryPromise = null;

// تحميل مسبق للـ WASM Binary مرة واحدة فقط
export async function getRnnoiseWasmBinary() {
  if (!rnnoiseBinaryPromise) {
    rnnoiseBinaryPromise = loadRnnoise({
      url: rnnoiseWasmPath,
      simdUrl: rnnoiseSimdWasmPath,
    });
  }
  return rnnoiseBinaryPromise;
}

/**
 * تطبيق الـ RNNoise Neural Noise Suppression على MediaStream صوتي
 * @param {MediaStream} rawStream - مسار الصوت الأصلي من المايك
 * @param {AudioContext} [existingCtx] - AudioContext اختياري
 * @returns {Promise<{ cleanStream: MediaStream, audioContext: AudioContext, rnnoiseNode: RnnoiseWorkletNode, cleanup: () => void }>}
 */
export async function applyRnnoiseDenoise(rawStream, existingCtx = null) {
  const audioTracks = rawStream.getAudioTracks();
  if (audioTracks.length === 0) {
    return { cleanStream: rawStream, audioContext: null, rnnoiseNode: null, cleanup: () => {} };
  }

  try {
    // 1. إنشاء أو استخدام AudioContext بتردد 48000Hz (المطلوب بواسطة RNNoise)
    const audioContext = existingCtx || new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: 'interactive'
    });

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // 2. تحميل الـ WASM و الـ Worklet Processor
    const wasmBinary = await getRnnoiseWasmBinary();
    await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);

    // 3. إنشاء عقدة الـ RNNoise Worklet
    const rnnoiseNode = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1,
    });

    // 4. ربط مسار الصوت: Source -> RNNoise -> Destination
    const sourceNode = audioContext.createMediaStreamSource(rawStream);
    const destinationNode = audioContext.createMediaStreamDestination();

    sourceNode.connect(rnnoiseNode);
    rnnoiseNode.connect(destinationNode);

    // تجهيز الـ Stream المعالج مع نقل أي فيديو كان موجوداً مسبقاً
    const cleanStream = destinationNode.stream;
    rawStream.getVideoTracks().forEach((vTrack) => {
      cleanStream.addTrack(vTrack);
    });

    console.log('[RNNoise] Neural Noise Suppression active 🎙️✨');

    const cleanup = () => {
      try {
        sourceNode.disconnect();
        rnnoiseNode.disconnect();
        if (typeof rnnoiseNode.destroy === 'function') {
          rnnoiseNode.destroy();
        }
        if (!existingCtx && audioContext.state !== 'closed') {
          audioContext.close();
        }
      } catch (err) {
        console.warn('[RNNoise] cleanup warning:', err);
      }
    };

    return {
      cleanStream,
      audioContext,
      rnnoiseNode,
      cleanup
    };
  } catch (err) {
    console.error('[RNNoise] Failed to initialize noise suppression, falling back to raw stream:', err);
    return {
      cleanStream: rawStream,
      audioContext: null,
      rnnoiseNode: null,
      cleanup: () => {}
    };
  }
}

