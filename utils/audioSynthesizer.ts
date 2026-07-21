/**
 * Synthesizes simulated audio signals directly in the browser.
 * This provides interactive audio samples for testing the detection pipeline
 * without requiring any external file uploads or backend APIs.
 */

export const synthesizeSample = (
  ctx: AudioContext,
  type: 'authentic' | 'clone' | 'robot'
): AudioBuffer => {
  const sampleRate = 16000; // Match standard 16kHz for ML models
  const duration = 6; // 6 seconds sample
  const numSamples = sampleRate * duration;
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  if (type === 'robot') {
    // 1. Robotic TTS: Flat pitch carrier, square waves, and metallic formants
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      
      // Flat pitch carrier at exactly 110Hz (no pitch drift/inflection)
      const baseWave = Math.sin(2 * Math.PI * 110 * t) > 0 ? 0.08 : -0.08;
      
      // Heavy modulation to mimic robotic buzz/vocoder structure
      const amplitudeMod = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t); // 4Hz gating
      
      // Metallic harmonic resonances
      const resonant1 = Math.sin(2 * Math.PI * 800 * t) * 0.04;
      const resonant2 = Math.sin(2 * Math.PI * 1500 * t) * 0.02;
      
      data[i] = (baseWave + resonant1 + resonant2) * amplitudeMod;
    }
  } else if (type === 'clone') {
    // 2. Generative Voice Clone (Deepfake): Natural pitch trajectory but with neural vocoder artifacts
    // In deepfakes, there are often sub-perceptual high-frequency glitches, phase mismatches, and micro-jitter
    let phase = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      
      // Pitch trajectory: looks natural (intonation rises and falls)
      const wordEnvelope = Math.max(0, Math.sin(2 * Math.PI * 0.45 * t) * 0.7 + 0.3);
      const intonation = Math.sin(2 * Math.PI * 1.2 * t) * 15;
      const baseFreq = 135 + intonation;
      
      // Pitch micro-jitter: extremely rapid frequency fluctuations
      // Generative audio models often exhibit slight jitter or phase drift
      const microJitter = Math.sin(2 * Math.PI * 95 * t) * 4 * (Math.random() > 0.9 ? 1.5 : 0.5);
      const instantFreq = baseFreq + microJitter;
      
      phase += (2 * Math.PI * instantFreq) / sampleRate;
      let val = Math.sin(phase) * 0.1;
      
      // Add a metallic harmonic notch (neural vocoder signature)
      const spectralGlitch = Math.sin(phase * 3.7) * 0.035;
      
      // Add high-frequency phase noise/frictional hiss
      const noise = (Math.random() - 0.5) * 0.012;
      
      data[i] = (val + spectralGlitch + noise) * wordEnvelope;
    }
  } else {
    // 3. Authentic Human Speech: Organic pitch drift, rich vocal chord harmonics, natural breath
    let phase = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      
      // Natural breath and phrasing envelopes (organic word boundaries)
      const phraseEnvelope = Math.max(0, Math.sin(2 * Math.PI * 0.25 * t) * 0.7 + 0.3);
      const fineEnvelope = 0.8 + 0.2 * Math.sin(2 * Math.PI * 6 * t); // Tremolo/inflection
      const totalEnvelope = phraseEnvelope * fineEnvelope;
      
      // Organic pitch drift (human intonation changes smoothly, never flat or jittery)
      const dynamicIntonation = Math.sin(2 * Math.PI * 0.8 * t) * 20 + Math.cos(2 * Math.PI * 0.3 * t) * 10;
      const baseFreq = 155 + dynamicIntonation;
      
      phase += (2 * Math.PI * baseFreq) / sampleRate;
      
      // Human voice is rich in natural harmonics (fundamental + integer multiples)
      let val = Math.sin(phase) * 0.12;          // Fundamental (F0)
      val += Math.sin(phase * 2) * 0.05;         // 1st harmonic (F1)
      val += Math.sin(phase * 3) * 0.02;         // 2nd harmonic (F2)
      val += Math.sin(phase * 4) * 0.01;         // 3rd harmonic (F3)
      
      // Natural respiration noise (breathing, soft consonants)
      const breathingNoise = (Math.random() - 0.5) * 0.003 * (1 - totalEnvelope);
      
      data[i] = val * totalEnvelope + breathingNoise;
    }
  }

  return buffer;
};
