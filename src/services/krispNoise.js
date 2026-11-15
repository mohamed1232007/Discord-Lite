let krispModulePromise;

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

export const enableKrisp = async (track) => {
  if (!track || typeof track.setProcessor !== 'function') {
    throw new Error('Krisp requires a published LiveKit local audio track.');
  }

  const module = await loadKrispModule();
  if (!module.isKrispNoiseFilterSupported()) {
    throw new Error('Krisp noise filtering is not supported in this WebView.');
  }

  let processor = track.getProcessor();
  if (processor?.name === 'livekit-noise-filter') {
    await processor.setEnabled(true);
    return processor;
  }
  if (processor) {
    throw new Error(`Cannot enable Krisp while "${processor.name}" is processing the microphone.`);
  }

  processor = module.KrispNoiseFilter();
  try {
    await track.setProcessor(processor);
    await processor.setEnabled(true);
    return processor;
  } catch (error) {
    if (track.getProcessor()?.name === 'livekit-noise-filter') {
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

export const disableKrisp = async (track) => {
  const processor = track?.getProcessor?.();
  if (processor?.name !== 'livekit-noise-filter') return false;

  try {
    await processor.setEnabled(false);
  } catch (error) {
    console.warn('[Krisp] Could not disable the filter cleanly; stopping its processor:', error);
  }
  await track.stopProcessor();
  return true;
};
