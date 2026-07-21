import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  isRecording?: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  analyser,
  isActive,
  isRecording = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set high-DPI scaling
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Render loop
    const render = () => {
      if (!canvas || !ctx) return;
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;

      // Clear with dark-slate background
      ctx.fillStyle = '#090d16'; // Deep space blue/black
      ctx.fillRect(0, 0, width, height);

      // Draw background grid lines (cyberpunk grid)
      ctx.strokeStyle = '#1e293b55'; // Slate-800 with low opacity
      ctx.lineWidth = 1;
      
      const gridSize = 30;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      if (analyser && isActive) {
        const bufferLength = analyser.frequencyBinCount;
        const timeData = new Uint8Array(bufferLength);
        const freqData = new Uint8Array(bufferLength);

        analyser.getByteTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);

        // 1. Draw Frequency Bars (rising from bottom)
        const barWidth = (width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = (freqData[i] / 255) * height * 0.8;

          // Gradient color: indigo to violet/pink
          const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
          grad.addColorStop(0, '#4f46e533'); // Indigo-600 low opacity
          grad.addColorStop(0.5, '#6366f199'); // Indigo-500 medium opacity
          grad.addColorStop(1, isRecording ? '#ec4899cc' : '#8b5cf6cc'); // Pink (if recording) else Purple-500

          ctx.fillStyle = grad;
          ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);

          x += barWidth;
        }

        // 2. Draw Oscilloscope Line (center)
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isRecording ? '#f43f5e' : '#06b6d4'; // Rose-500 (recording) else Cyan-500
        
        // Add glow effect to oscilloscope line
        ctx.shadowBlur = 8;
        ctx.shadowColor = isRecording ? '#f43f5e' : '#06b6d4';

        const sliceWidth = width / bufferLength;
        let ox = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = timeData[i] / 128.0;
          const oy = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(ox, oy);
          } else {
            ctx.lineTo(ox, oy);
          }

          ox += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
        
        // Reset shadow
        ctx.shadowBlur = 0;

      } else {
        // Draw idle state (flat green/blue line in center)
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#334155'; // Slate-700
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SIGNAL IDLE // STANDBY', width / 2, height / 2 - 10);
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isActive, isRecording]);

  return (
    <div className="w-full h-full relative overflow-hidden rounded-lg border border-slate-800/80 bg-[#090d16] shadow-inner">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {isActive && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-950/70 border border-slate-800 text-[10px] font-mono text-slate-400">
          <span className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-cyan-500 animate-pulse'}`}></span>
          {isRecording ? 'MIC_IN' : 'AUDIO_FLOW'}
        </div>
      )}
    </div>
  );
};
