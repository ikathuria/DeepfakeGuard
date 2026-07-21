import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Activity, 
  FileAudio, 
  Play, 
  Pause, 
  Upload, 
  Cpu, 
  Mic, 
  Settings, 
  Key, 
  HelpCircle, 
  AlertTriangle, 
  Sparkles, 
  RefreshCw, 
  X 
} from 'lucide-react';
import { MetricsCard } from './components/MetricsCard';
import { DetectionChart } from './components/DetectionChart';
import { AudioVisualizer } from './components/AudioVisualizer';
import { AnalysisResult, AnalysisStatus } from './types';
import { audioBufferToWav, blobToBase64 } from './utils/audioUtils';
import { synthesizeSample } from './utils/audioSynthesizer';
import { performForensicAudit, ForensicAuditReport } from './services/geminiService';
import { loadModel, classifyAudio, getModelStatus } from './services/inferenceService';

const CHUNK_DURATION = 2.0; // Seconds
const ANALYSIS_INTERVAL = 1200; // ms (delay between calls to simulate streaming/rate limit)

export default function App() {
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [modelLoaded, setModelLoaded] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [overallRisk, setOverallRisk] = useState<number>(0);

  // Advanced Input Options
  const [activeTab, setActiveTab] = useState<'presets' | 'mic' | 'upload'>('presets');
  
  // Microphone recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  // Gemini API Key & Audit state
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => localStorage.getItem('deepfakeguard_api_key') || '');
  const [auditReport, setAuditReport] = useState<ForensicAuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [tempApiKey, setTempApiKey] = useState<string>('');

  // Local/Remote Model Status
  const [modelStatusText, setModelStatusText] = useState<string>('Disconnected');

  // Web Audio Context & Node Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const analysisTimerRef = useRef<number | null>(null);
  const playbackIntervalRef = useRef<number | null>(null);

  // Mic recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  // Initialize AudioContext & local AnalyserNode
  useEffect(() => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyserNodeRef.current = analyser;

    // Load Model on Start (supporting fallback CDN)
    const initModel = async () => {
      try {
        await loadModel((data: any) => {
          if (data.status === 'progress') {
            setLoadingProgress(data.progress || 0);
          }
        });
        setModelLoaded(true);
        setModelStatusText(getModelStatus());
        console.log("Model Loaded");
      } catch (e) {
        console.error("Failed to load model", e);
        setStatus(AnalysisStatus.ERROR);
        setModelStatusText('Failed to Load Model');
      }
    };
    initModel();

    return () => {
      audioContext.close();
    };
  }, []);

  // Sync API Key from env if available
  useEffect(() => {
    // If an API key is injected via Vite env variables, load it automatically
    const envKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '');
    if (envKey && !geminiApiKey) {
      setGeminiApiKey(envKey);
      localStorage.setItem('deepfakeguard_api_key', envKey);
    }
  }, [geminiApiKey]);

  // Handle local file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopAnalysis();
    setAuditReport(null);
    setStatus(AnalysisStatus.LOADING_AUDIO);
    setCurrentFile(file);
    setResults([]);
    setCurrentTime(0);
    setOverallRisk(0);

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (audioContextRef.current) {
        const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        setAudioBuffer(decodedBuffer);
        setStatus(AnalysisStatus.IDLE);
      }
    } catch (e) {
      console.error("Error decoding audio", e);
      setStatus(AnalysisStatus.ERROR);
    }
  };

  // Synthesize human, cloned, or robotic audio samples dynamically
  const loadPresetSample = (type: 'authentic' | 'clone' | 'robot') => {
    if (!audioContextRef.current) return;
    
    stopAnalysis();
    setAuditReport(null);
    setResults([]);
    setCurrentTime(0);
    setOverallRisk(0);
    
    setStatus(AnalysisStatus.LOADING_AUDIO);
    try {
      const buffer = synthesizeSample(audioContextRef.current, type);
      setAudioBuffer(buffer);
      
      const mockNames = {
        authentic: 'human_interview_authentic.wav (Preset)',
        clone: 'synthetic_voice_clone_v2.wav (Preset)',
        robot: 'robotic_vocoder_tts_sample.wav (Preset)'
      };
      
      const mockFile = new File([], mockNames[type], { type: 'audio/wav' });
      setCurrentFile(mockFile);
      
      setStatus(AnalysisStatus.IDLE);
    } catch (e) {
      console.error("Failed to generate preset sample:", e);
      setStatus(AnalysisStatus.ERROR);
    }
  };

  // Start Mic Recording
  const startRecording = async () => {
    if (!audioContextRef.current || !analyserNodeRef.current) return;
    
    stopAnalysis();
    setAuditReport(null);
    setAudioBuffer(null);
    setCurrentFile(null);
    setResults([]);
    setCurrentTime(0);
    setOverallRisk(0);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      // Connect microphone stream to the visualizer analyser
      const micSource = audioContextRef.current.createMediaStreamSource(stream);
      micSource.connect(analyserNodeRef.current);
      // NOTE: Do not connect to speakers (destination) to prevent acoustic feedback.

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        try {
          micSource.disconnect();
        } catch (e) {}
        
        const audioBlob = new Blob(chunks, { type: 'audio/wav' });
        setStatus(AnalysisStatus.LOADING_AUDIO);
        
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          if (audioContextRef.current) {
            const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            setAudioBuffer(decodedBuffer);
            
            const mockFile = new File([], `mic_recording_${Date.now()}.wav`, { type: 'audio/wav' });
            setCurrentFile(mockFile);
            
            setStatus(AnalysisStatus.IDLE);
          }
        } catch (err) {
          console.error("Decoding mic audio failed:", err);
          setStatus(AnalysisStatus.ERROR);
        }
      };
      
      setIsRecording(true);
      setRecordingSeconds(0);
      mediaRecorder.start();
      
      // Increment timer and enforce a 10-second limit
      let elapsed = 0;
      recordingTimerRef.current = window.setInterval(() => {
        elapsed += 1;
        setRecordingSeconds(elapsed);
        if (elapsed >= 10) {
          stopRecording();
        }
      }, 1000);
      
    } catch (e) {
      console.error("Microphone access denied:", e);
      alert("Microphone capture access denied. Please verify recording device permissions.");
    }
  };

  // Stop Mic Recording
  const stopRecording = () => {
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
  };

  // Run Inference Pipeline over AudioBuffer
  const startAnalysis = useCallback(async () => {
    if (!audioBuffer || status === AnalysisStatus.ANALYZING) return;

    setStatus(AnalysisStatus.ANALYZING);
    setIsPlaying(true);
    setAuditReport(null);

    // 1. Audio Playback setup
    if (audioContextRef.current && analyserNodeRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      
      // Route through AnalyserNode to feed real-time visualizer canvas
      source.connect(analyserNodeRef.current);
      analyserNodeRef.current.connect(audioContextRef.current.destination);
      
      source.start(0, currentTime);
      sourceNodeRef.current = source;
      startTimeRef.current = audioContextRef.current.currentTime - currentTime;

      // Update progress timestamp
      const timer = window.setInterval(() => {
        if (audioContextRef.current) {
          const t = audioContextRef.current.currentTime - startTimeRef.current;
          if (t >= audioBuffer.duration) {
            stopAnalysis();
          } else {
            setCurrentTime(t);
          }
        }
      }, 100);

      playbackIntervalRef.current = timer;
    }

    // 2. Continuous Chunk Analysis Pipeline
    let cursor = 0;
    const processNextChunk = async () => {
      if (cursor >= audioBuffer.duration) {
        setStatus(AnalysisStatus.COMPLETED);
        setIsPlaying(false);
        return;
      }

      // Slice Buffer (Get raw float data channel 0)
      const startSample = Math.floor(cursor * audioBuffer.sampleRate);
      const endSample = Math.floor((cursor + CHUNK_DURATION) * audioBuffer.sampleRate);
      const channelData = audioBuffer.getChannelData(0).slice(startSample, endSample);

      try {
        const resultData = await classifyAudio(channelData, audioBuffer.sampleRate);

        const result: AnalysisResult = {
          timestamp: cursor,
          fakeProbability: Math.round(resultData.fakeProbability),
          confidence: resultData.fakeProbability > 80 ? 'High' : resultData.fakeProbability > 50 ? 'Medium' : 'High',
          reasoning: resultData.fakeProbability > 70 
            ? `Anomalous synthetic spectral artifacts (top class: ${resultData.details[0]?.label || 'N/A'})`
            : `Speech patterns match authentic keywords (top class: ${resultData.details[0]?.label || 'N/A'})`
        };

        setResults(prev => {
          const newResults = [...prev, result];
          const avg = newResults.reduce((acc, curr) => acc + curr.fakeProbability, 0) / newResults.length;
          setOverallRisk(Math.round(avg));
          return newResults;
        });
      } catch (err) {
        console.error("Local client-side inference failed", err);
      }

      cursor += CHUNK_DURATION;

      // Schedule next chunk analysis iteration
      if (status !== AnalysisStatus.ERROR) {
        analysisTimerRef.current = window.setTimeout(processNextChunk, ANALYSIS_INTERVAL);
      }
    };

    processNextChunk();
  }, [audioBuffer, status, currentTime]);

  // Stop playback / inference loop
  const stopAnalysis = () => {
    setIsPlaying(false);
    if (status === AnalysisStatus.ANALYZING) setStatus(AnalysisStatus.COMPLETED);

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch (e) {}
      sourceNodeRef.current = null;
    }

    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    if (analysisTimerRef.current) {
      clearTimeout(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      stopAnalysis();
    } else {
      startAnalysis();
    }
  };

  // Trigger Multimodal Gemini AI Forensic Audit
  const handleGeminiAudit = async () => {
    if (!audioBuffer) return;
    if (!geminiApiKey) {
      setShowSettings(true);
      setAuditError("Gemini API key is missing. Add your key in Settings.");
      return;
    }

    setAuditLoading(true);
    setAuditError(null);
    setAuditReport(null);

    try {
      // Isolate the highest risk segment to inspect
      let targetSegment = results[0];
      if (results.length > 0) {
        targetSegment = results.reduce((max, r) => r.fakeProbability > max.fakeProbability ? r : max, results[0]);
      }
      
      const startTime = targetSegment ? targetSegment.timestamp : 0;
      // Extract a 4.0 second window for auditing (provides sufficient contextual acoustics)
      const duration = Math.min(4.0, audioBuffer.duration - startTime);
      
      const wavBlob = audioBufferToWav(audioBuffer, startTime, duration);
      const base64Data = await blobToBase64(wavBlob);
      
      const report = await performForensicAudit(base64Data, geminiApiKey);
      setAuditReport(report);
    } catch (err: any) {
      console.error("Gemini Auditor failed:", err);
      setAuditError(err.message || "Auditor connection crashed. Please verify your API key.");
    } finally {
      setAuditLoading(false);
    }
  };

  const saveSettingsKey = (e: React.FormEvent) => {
    e.preventDefault();
    setGeminiApiKey(tempApiKey);
    localStorage.setItem('deepfakeguard_api_key', tempApiKey);
    setShowSettings(false);
    setAuditError(null);
  };

  // Reset when unmounting or changing tab
  useEffect(() => {
    return () => {
      stopAnalysis();
      stopRecording();
    };
  }, [currentFile, activeTab]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col grid-radar">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-900 bg-slate-950/80 backdrop-blur px-6 py-4 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-900/50 glow-indigo border border-indigo-400/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              DeepGuard <span className="text-indigo-400 text-xs px-1.5 py-0.5 rounded border border-indigo-500/30 bg-indigo-950/50">PRO</span>
            </h1>
            <p className="text-slate-400 text-xs font-mono uppercase tracking-widest">Acoustic Deepfake Detection & Forensic Suite</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {status === AnalysisStatus.ANALYZING && (
            <span className="flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full text-xs font-mono animate-pulse">
              <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></div>
              PIPELINE_ACTIVE
            </span>
          )}
          <div className="text-right">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Classifier Core</div>
            <div className="text-indigo-400 font-mono text-xs font-semibold flex items-center gap-1.5 justify-end">
              <Cpu className="w-3.5 h-3.5" />
              {modelLoaded ? modelStatusText : `Loading weights... ${Math.round(loadingProgress)}%`}
            </div>
          </div>
          <button 
            onClick={() => {
              setTempApiKey(geminiApiKey);
              setShowSettings(true);
            }}
            className="p-2 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Configure API Keys"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 max-w-7xl mx-auto w-full">
        {/* Left Column: Source & Core Pipeline Metrics */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Settings Drawer / Dialog */}
          {showSettings && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl relative">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="absolute top-4 right-4 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2 mb-4">
                  <Key className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-lg font-bold text-white">Forensic Audit Configuration</h3>
                </div>
                <p className="text-xs text-slate-400 mb-4 font-mono leading-relaxed">
                  The AI Forensic Auditor operates directly in your browser. Key is stored strictly in your local sandbox (`localStorage`) and calls Google's API endpoints directly.
                </p>
                <form onSubmit={saveSettingsKey} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono text-slate-400 mb-1">GEMINI API KEY</label>
                    <input 
                      type="password"
                      placeholder="AIzaSy..."
                      value={tempApiKey}
                      onChange={(e) => setTempApiKey(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-indigo-400 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div className="flex gap-3 justify-end text-xs font-mono">
                    <button 
                      type="button"
                      onClick={() => {
                        setGeminiApiKey('');
                        localStorage.removeItem('deepfakeguard_api_key');
                        setTempApiKey('');
                        setShowSettings(false);
                      }}
                      className="px-3 py-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                    >
                      Clear Key
                    </button>
                    <button 
                      type="submit"
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-medium transition-colors"
                    >
                      Save Settings
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Input Panel */}
          <div className="cyber-panel rounded-xl p-5 border border-slate-900 shadow-xl overflow-hidden scanner-container">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Source Stream Setup
            </h2>

            {/* Source Selection Tabs */}
            <div className="flex border-b border-slate-800/80 mb-4 text-xs font-mono">
              <button 
                onClick={() => setActiveTab('presets')}
                className={`flex-1 pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'presets' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                1. PRESETS
              </button>
              <button 
                onClick={() => setActiveTab('mic')}
                className={`flex-1 pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'mic' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                2. LIVE MIC
              </button>
              <button 
                onClick={() => setActiveTab('upload')}
                className={`flex-1 pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'upload' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                3. FILE INPUT
              </button>
            </div>

            {/* Tab Contents */}
            <div className="min-h-[140px] flex flex-col justify-center">
              
              {/* Preset Tab */}
              {activeTab === 'presets' && (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-400 font-mono mb-2">Simulate specific voice models via client Web Audio oscillators:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button 
                      onClick={() => loadPresetSample('authentic')}
                      className="px-2 py-3 bg-slate-900 border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-950/20 text-slate-300 hover:text-indigo-400 rounded-lg text-xs font-mono text-center transition-all flex flex-col items-center gap-1.5"
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      <span>Authentic Human</span>
                    </button>
                    <button 
                      onClick={() => loadPresetSample('clone')}
                      className="px-2 py-3 bg-slate-900 border border-slate-800 hover:border-rose-500/50 hover:bg-rose-950/20 text-slate-300 hover:text-rose-400 rounded-lg text-xs font-mono text-center transition-all flex flex-col items-center gap-1.5"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-500" />
                      <span>AI Voice Clone</span>
                    </button>
                    <button 
                      onClick={() => loadPresetSample('robot')}
                      className="px-2 py-3 bg-slate-900 border border-slate-800 hover:border-purple-500/50 hover:bg-purple-950/20 text-slate-300 hover:text-purple-400 rounded-lg text-xs font-mono text-center transition-all flex flex-col items-center gap-1.5"
                    >
                      <Cpu className="w-4 h-4 text-purple-500" />
                      <span>Robotic TTS</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Mic Tab */}
              {activeTab === 'mic' && (
                <div className="flex flex-col items-center justify-center space-y-3">
                  {!isRecording ? (
                    <button 
                      onClick={startRecording}
                      className="w-16 h-16 rounded-full bg-slate-900 hover:bg-rose-950/30 border-2 border-slate-800 hover:border-rose-500 flex items-center justify-center text-rose-500 hover:text-rose-400 transition-all shadow-lg shadow-rose-950/20 hover:scale-105"
                      title="Click to Record mic sample (Max 10s)"
                    >
                      <Mic className="w-6 h-6 animate-pulse" />
                    </button>
                  ) : (
                    <button 
                      onClick={stopRecording}
                      className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center text-white transition-all shadow-lg shadow-rose-900/50 hover:scale-105 animate-pulse"
                      title="Stop Recording"
                    >
                      <div className="w-5 h-5 bg-white rounded-sm"></div>
                    </button>
                  )}
                  <div className="text-center font-mono">
                    <p className="text-xs font-semibold text-slate-400">
                      {isRecording ? `Recording Audio... ${recordingSeconds}s / 10s` : 'Capture raw voice input'}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">Automatic stop and classification on trigger</p>
                  </div>
                </div>
              )}

              {/* Upload Tab */}
              {activeTab === 'upload' && (
                <div>
                  <label className="flex flex-col items-center justify-center w-full h-32 border border-slate-800 border-dashed rounded-lg cursor-pointer bg-slate-950/20 hover:bg-slate-900/40 hover:border-indigo-500/50 transition-all group relative">
                    <div className="flex flex-col items-center justify-center pt-4 pb-4 font-mono text-center">
                      <Upload className="w-7 h-7 mb-2 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                      <p className="text-xs text-slate-400"><span className="font-semibold text-indigo-400">Select standard WAV/MP3</span></p>
                      <p className="text-[10px] text-slate-600 mt-1">Single channel 16kHz audio preferred</p>
                    </div>
                    <input type="file" className="hidden" accept="audio/*" onChange={handleFileUpload} />
                  </label>
                </div>
              )}
            </div>

            {/* Currently Active Buffer Header */}
            {currentFile && (
              <div className="mt-4 bg-slate-950/50 border border-slate-900 rounded-lg p-3 flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileAudio className="w-6 h-6 text-indigo-400 flex-shrink-0" />
                  <div className="truncate">
                    <p className="text-white truncate font-medium">{currentFile.name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {audioBuffer ? `${audioBuffer.duration.toFixed(1)}s • ${audioBuffer.sampleRate}Hz • 16-bit` : 'Processing File...'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={togglePlayback}
              disabled={!audioBuffer || !modelLoaded || isRecording}
              className={`w-full py-3 px-4 rounded-lg font-mono text-xs font-semibold flex items-center justify-center gap-2 mt-4 border transition-all ${
                (!audioBuffer || !modelLoaded || isRecording)
                  ? 'bg-slate-950/30 text-slate-600 border-slate-900 cursor-not-allowed'
                  : isPlaying
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 shadow-lg shadow-rose-950/10'
                    : 'bg-indigo-600 text-white border-indigo-500/30 hover:bg-indigo-500 hover:border-indigo-400 shadow-lg shadow-indigo-900/20 glow-indigo'
              }`}
            >
              {isPlaying ? <><Pause className="w-4 h-4" /> Terminate Stream</> : <><Play className="w-4 h-4" /> Engage Classifier</>}
            </button>
          </div>

          {/* Dials & Gauges */}
          <div className="grid grid-cols-2 gap-4">
            
            {/* Risk dial panel */}
            <div className="cyber-panel rounded-xl p-4 flex flex-col items-center justify-center text-center relative overflow-hidden h-36">
              <div className="absolute top-3 left-3 text-[9px] font-mono text-slate-500 tracking-wider">RISK_RATIO</div>
              <div className="relative w-20 h-20 mt-2">
                <svg className="dial-svg w-full h-full" viewBox="0 0 100 100">
                  {/* Outer circle */}
                  <circle className="dial-track" cx="50" cy="50" r="40" strokeWidth="8" />
                  {/* Dynamic color outline */}
                  <circle 
                    className="dial-progress" 
                    cx="50" 
                    cy="50" 
                    r="40" 
                    strokeWidth="8"
                    stroke={overallRisk > 70 ? "#f43f5e" : overallRisk > 35 ? "#f59e0b" : "#10b981"}
                    strokeDasharray={2 * Math.PI * 40}
                    strokeDashoffset={2 * Math.PI * 40 * (1 - overallRisk / 100)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
                  <span className={`text-xl font-bold ${overallRisk > 70 ? 'text-rose-400' : overallRisk > 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {overallRisk}%
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono text-slate-400 mt-2 uppercase tracking-wide">
                {overallRisk > 70 ? 'Generative synthetic' : overallRisk > 35 ? 'Anomalous signs' : 'Secure Authenticity'}
              </span>
            </div>

            <MetricsCard
              title="Frames Logged"
              value={results.length.toString()}
              subtext={`Duration: ${currentTime.toFixed(1)}s`}
              colorClass="text-indigo-400 font-mono"
              icon={<Activity className="w-4 h-4 text-slate-500" />}
            />
          </div>

          {/* Real-time Logger Terminal */}
          <div className="cyber-panel rounded-xl flex-1 flex flex-col min-h-[180px] max-h-[300px] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/40 flex justify-between items-center font-mono">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Real-time Pipeline Logs</h3>
              <span className="text-[9px] text-slate-600">SAMPLE_RATE: 16000HZ</span>
            </div>
            <div className="overflow-y-auto flex-1 p-0 font-mono text-xs bg-slate-950/20">
              {results.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 italic text-[11px] p-4 text-center">
                  Feed active audio segment to start log stream...
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-slate-950 text-slate-500 font-semibold text-[9px] uppercase tracking-wider sticky top-0 border-b border-slate-900">
                    <tr>
                      <th className="px-4 py-2">Offset</th>
                      <th className="px-4 py-2">Prob</th>
                      <th className="px-4 py-2">Verdict Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60">
                    {[...results].reverse().map((r, i) => (
                      <tr key={i} className="hover:bg-slate-900/30 transition-colors">
                        <td className="px-4 py-1.5 text-slate-500">{r.timestamp.toFixed(1)}s</td>
                        <td className={`px-4 py-1.5 font-bold ${r.fakeProbability > 60 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {r.fakeProbability}%
                        </td>
                        <td className="px-4 py-1.5 text-slate-400 text-[10px] truncate max-w-[170px]" title={r.reasoning}>
                          {r.reasoning}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Spectrogram Visualizer, Chart & Gemini Forensic Auditor */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Web Audio Real-Time Spectrogram Container */}
          <div className="cyber-panel rounded-xl p-4 border border-slate-900 shadow-xl flex flex-col h-56 relative group">
            <div className="flex justify-between items-center mb-2 font-mono text-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Waveform / Fourier Spectrum</span>
              <span className="text-[9px] text-slate-600">FFT WINDOW: 256 BINS</span>
            </div>
            <div className="flex-1 min-h-0">
              <AudioVisualizer 
                analyser={analyserNodeRef.current} 
                isActive={isPlaying || isRecording} 
                isRecording={isRecording}
              />
            </div>
          </div>

          {/* Recharts chart */}
          <div className="cyber-panel rounded-xl p-4 border border-slate-900 shadow-xl h-60 relative">
            <div className="absolute top-4 left-4 z-10 bg-slate-950/80 backdrop-blur px-2.5 py-1 rounded border border-slate-800 font-mono">
              <span className="text-[10px] font-semibold text-indigo-400 tracking-wider">Live Synthetic Probability Track</span>
            </div>
            {results.length > 0 ? (
              <DetectionChart data={results} />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 font-mono">
                <Activity className="w-12 h-12 mb-2 opacity-20 text-indigo-500 animate-pulse" />
                <p className="text-xs">Awaiting data streaming...</p>
                <p className="text-[10px] text-slate-600 mt-1">Activate source controls to visualize probability curves</p>
              </div>
            )}
          </div>

          {/* Gemini Multimodal Forensic Auditor Panel */}
          <div className="cyber-panel rounded-xl p-5 border border-slate-900 shadow-xl flex flex-col flex-1 relative min-h-[300px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                  Gemini AI Multimodal Auditor
                </h2>
              </div>
              <button
                onClick={handleGeminiAudit}
                disabled={!audioBuffer || results.length === 0 || auditLoading}
                className={`px-3 py-1.5 rounded font-mono text-xs flex items-center gap-1.5 transition-all ${
                  (!audioBuffer || results.length === 0 || auditLoading)
                    ? 'bg-slate-950/30 text-slate-600 border border-slate-900 cursor-not-allowed'
                    : 'bg-violet-600/10 hover:bg-violet-600/20 text-violet-400 border border-violet-500/20 hover:border-violet-500/40 glow-rose'
                }`}
              >
                {auditLoading ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analyzing Acoustics...</>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5" /> Execute Audit Report</>
                )}
              </button>
            </div>

            {/* Auditor Results display */}
            <div className="flex-1 flex flex-col justify-center">
              {auditLoading && (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500 font-mono text-xs">
                  <div className="w-12 h-12 rounded-full border-t-2 border-r-2 border-violet-500 animate-spin mb-4"></div>
                  <p className="text-violet-400 animate-pulse uppercase tracking-widest font-bold">Scanning vocal dynamics...</p>
                  <p className="text-[10px] text-slate-600 mt-2">Feeding audio segment to Gemini 2.5 Flash for forensic parsing</p>
                </div>
              )}

              {auditError && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4 flex gap-3 text-rose-400 text-xs font-mono items-start">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-rose-300">Auditor Failed</h4>
                    <p className="text-slate-400 mt-1 leading-relaxed">{auditError}</p>
                    <button 
                      onClick={() => setShowSettings(true)}
                      className="mt-2 text-indigo-400 hover:text-indigo-300 font-semibold underline flex items-center gap-1"
                    >
                      Configure API Key <Key className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {!auditLoading && !auditError && !auditReport && (
                <div className="text-center py-10 text-slate-600 font-mono text-xs flex flex-col items-center justify-center">
                  <HelpCircle className="w-10 h-10 mb-2 opacity-10 text-slate-300" />
                  <p>Awaiting audit request.</p>
                  <p className="text-[10px] text-slate-700 mt-1">
                    Once the classifier completes a run, click "Execute Audit Report" above.
                  </p>
                  <p className="text-[10px] text-slate-700">
                    Gemini will inspect the high-risk audio chunks to construct a detailed report.
                  </p>
                </div>
              )}

              {!auditLoading && !auditError && auditReport && (
                <div className="space-y-4 font-mono text-xs animate-fade-in leading-relaxed">
                  
                  {/* Verdict badge and confidence bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/40 p-4 border border-slate-900 rounded-lg">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase tracking-widest block mb-1">Forensic Verdict</span>
                      <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                        auditReport.verdict === 'Authentic' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        auditReport.verdict === 'Suspicious' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        auditReport.verdict === 'Synthetic / Cloned' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                        'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                      }`}>
                        {auditReport.verdict}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase tracking-widest block mb-1">Confidence Score ({auditReport.confidenceScore}%)</span>
                      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${
                            auditReport.verdict === 'Authentic' ? 'bg-emerald-500' :
                            auditReport.verdict === 'Suspicious' ? 'bg-amber-500' :
                            auditReport.verdict === 'Synthetic / Cloned' ? 'bg-rose-500' :
                            'bg-purple-500'
                          }`}
                          style={{ width: `${auditReport.confidenceScore}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  {/* Diagnostic Tabs/Sections */}
                  <div className="space-y-3">
                    <div className="border border-slate-900 rounded-lg p-3 bg-slate-950/20">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">1. Prosody & Phrasing Assessment</h4>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{auditReport.prosodyAnalysis}</p>
                    </div>

                    <div className="border border-slate-900 rounded-lg p-3 bg-slate-950/20">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">2. Spectral & Vocoder Anomalies</h4>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{auditReport.anomalyAnalysis}</p>
                    </div>

                    <div className="border border-slate-900 rounded-lg p-3 bg-indigo-950/10 border-indigo-950/30">
                      <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">3. Technical Executive Breakdown</h4>
                      <p className="text-slate-200 text-[11px] leading-relaxed">{auditReport.forensicBreakdown}</p>
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}