import React, { useRef, useEffect } from 'react';

interface WaveAnimationProps {
  isRecording: boolean;
  analyser: AnalyserNode | null;
  className?: string;
}

export const WaveAnimation: React.FC<WaveAnimationProps> = ({ isRecording, analyser, className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI screens
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);
    let phase = 0; // for idle wave animation

    const draw = () => {
      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      ctx.clearRect(0, 0, width, height);

      if (isRecording && analyser) {
        // Active visualizer from mic
        analyser.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 2;
        
        // Gradient stroke
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#6366f1'); // Indigo
        gradient.addColorStop(0.5, '#06b6d4'); // Cyan
        gradient.addColorStop(1, '#14b8a6'); // Teal
        ctx.strokeStyle = gradient;
        
        // Shadow glow effect
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(99, 102, 241, 0.5)';

        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
      } else if (isRecording) {
        // Active visualizer placeholder (fake active sine waves) when no analyser
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 2;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(0.5, '#06b6d4');
        gradient.addColorStop(1, '#14b8a6');
        ctx.strokeStyle = gradient;

        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const y = height / 2 + Math.sin(x * 0.04 + phase * 2.5) * 12 + Math.sin(x * 0.01 + phase) * 4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        phase += 0.08;
      } else {
        // Idle animation: Gentle floating cosmic sine waves
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5;

        // Wave 1 - Indigo (back, slower, thicker)
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const y = height / 2 + Math.sin(x * 0.015 + phase) * 8 + Math.cos(x * 0.005 + phase * 0.5) * 3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Wave 2 - Cyan (front, faster, thinner)
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const y = height / 2 + Math.sin(x * 0.02 - phase * 1.2) * 5 + Math.sin(x * 0.008 + phase) * 2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        phase += 0.04;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRecording, analyser]);

  return (
    <div className={`wave-container ${className ?? ''}`}>
      <canvas ref={canvasRef} className="wave-canvas" style={{ width: '100%', height: '100%' }} />
      {!isRecording && (
        <span
          className="font-mono"
          style={{
            position: 'absolute',
            fontSize: '0.7rem',
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
            letterSpacing: '0.05em',
            textTransform: 'uppercase'
          }}
        >
          Sẵn sàng thu âm
        </span>
      )}
    </div>
  );
};
