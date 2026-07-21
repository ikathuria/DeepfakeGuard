import { pipeline, Pipeline, env } from '@xenova/transformers';

const TASK = 'audio-classification';
const MODEL_NAME = 'Xenova/wav2vec2-base-superb-ks';

let classifier: Pipeline | null = null;
export let modelSourceStatus = 'Disconnected';

export const getModelStatus = () => modelSourceStatus;

export const loadModel = async (progressCallback?: (data: any) => void) => {
  if (classifier) {
    modelSourceStatus = modelSourceStatus || 'Loaded';
    return classifier;
  }

  // Strategy 1: Attempt to load from the local public path (optimized offline mode)
  try {
    console.log('Attempting local ONNX model load...');
    modelSourceStatus = 'Initializing Local ONNX...';
    
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    // Crucial for GitHub pages: base path is /DeepfakeGuard/
    env.localModelPath = '/DeepfakeGuard/models/'; 

    classifier = await pipeline(TASK, MODEL_NAME, {
      progress_callback: progressCallback,
    });
    
    modelSourceStatus = 'ONNX Local (Offline)';
    console.log('Success: Local model loaded successfully.');
    return classifier;
  } catch (localErr) {
    console.warn('Local model load failed. Switching to Hugging Face Cloud Fallback...', localErr);
    
    // Strategy 2: Fallback to remote CDN (Hugging Face Hub) with browser caching
    try {
      modelSourceStatus = 'HF CDN Fallback...';
      
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;

      classifier = await pipeline(TASK, MODEL_NAME, {
        progress_callback: progressCallback,
      });
      
      modelSourceStatus = 'Hugging Face CDN (Cloud)';
      console.log('Success: Remote Hugging Face model loaded successfully.');
      return classifier;
    } catch (remoteErr) {
      modelSourceStatus = 'Inference Offline';
      console.error('Fatal: All model loading attempts failed.', remoteErr);
      throw remoteErr;
    }
  }
};

export const classifyAudio = async (audioData: Float32Array, sampling_rate: number) => {
  if (!classifier) {
    throw new Error('Model not loaded');
  }

  // Pre-trained classifier runs at 16000Hz.
  const result = await classifier(audioData, {
    topk: 5,
  });

  // Result is an array of { label: string, score: number }
  // We extract a "Fake Probability" proxy for this portfolio demo.
  // We use the inverse confidence of the primary spoken keyword as the fake score.
  // If the speech is clear and standard keywords are detected with high confidence, it's Authentic.
  // If the keyword class scores are low or noisy, we classify it as suspicious.
  const topScore = result[0]?.score || 0;
  const fakeProb = 1 - topScore; // Simple heuristic

  return {
    fakeProbability: Math.min(Math.max(fakeProb, 0), 1) * 100, // 0-100%
    details: result
  };
};

