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
    }).catch((error) => {
      rnnoiseBinaryPromise = null;
      throw error;
    });
  }
  return rnnoiseBinaryPromise;
}

/**
 * تطبيق الـ RNNoise Neural Noise Suppression على MediaStream صوتي
 * @param {MediaStream} rawStream - مسار الصوت الأصلي من المايك
 * @param {AudioContext} [existingCtx] - AudioContext اختياري
 * @returns {Promise<{ cleanStream: MediaStream, audioContext: AudioContext, rnnoiseNode: RnnoiseWorkletNode, isActive: boolean, cleanup: () => void }>}
 */
export async function applyRnnoiseDenoise(rawStream, existingCtx = null) {
  const audioTracks = rawStream.getAudioTracks();
  if (audioTracks.length === 0) {
    return { cleanStream: rawStream, audioContext: null, rnnoiseNode: null, isActive: false, cleanup: () => {} };
  }

  let audioContext;
  let sourceNode;
  let rnnoiseNode;
  try {
    // 1. إنشاء أو استخدام AudioContext بتردد 48000Hz (المطلوب بواسطة RNNoise)
    audioContext = existingCtx || new (window.AudioContext || window.webkitAudioContext)({
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
    rnnoiseNode = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1,
    });

    // 4. ربط مسار الصوت: Source -> RNNoise -> Destination
    sourceNode = audioContext.createMediaStreamSource(rawStream);
    const destinationNode = audioContext.createMediaStreamDestination();

    sourceNode.connect(rnnoiseNode);
    rnnoiseNode.connect(destinationNode);

    // تجهيز الـ Stream المعالج مع نقل أي فيديو كان موجوداً مسبقاً
    const cleanStream = destinationNode.stream;
    const processedAudioTrack = cleanStream.getAudioTracks()[0];
    if (!processedAudioTrack || processedAudioTrack.readyState !== 'live') {
      throw new Error('RNNoise did not produce a live audio track.');
    }
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
      isActive: true,
      cleanup
    };
  } catch (err) {
    console.error('[RNNoise] Failed to initialize noise suppression, falling back to raw stream:', err);
    try {
      sourceNode?.disconnect();
      rnnoiseNode?.disconnect();
      rnnoiseNode?.destroy?.();
      if (!existingCtx && audioContext && audioContext.state !== 'closed') {
        await audioContext.close();
      }
    } catch (cleanupError) {
      console.warn('[RNNoise] Failed to clean up an incomplete denoiser:', cleanupError);
    }
    return {
      cleanStream: rawStream,
      audioContext: null,
      rnnoiseNode: null,
      isActive: false,
      cleanup: () => {}
    };
  }
}
