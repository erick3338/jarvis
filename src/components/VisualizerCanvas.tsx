import { useEffect, useRef, type RefObject } from 'react';
import type { AssistantState } from '../types/jarvis';

interface VisualizerCanvasProps {
  assistantState: AssistantState;
  inputAnalyserRef: RefObject<AnalyserNode | null>;
  outputAnalyserRef: RefObject<AnalyserNode | null>;
}

const STATE_LABEL: Record<AssistantState, string> = {
  inactivo: 'INACTIVO',
  escuchando: 'ESCUCHANDO',
  pensando: 'PENSANDO',
  hablando: 'HABLANDO',
};

export function VisualizerCanvas({
  assistantState,
  inputAnalyserRef,
  outputAnalyserRef,
}: VisualizerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<AssistantState>(assistantState);
  stateRef.current = assistantState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationFrameId = 0;
    let smoothedEnergy = 0;
    let phase = 0;
    const freqBuffer = new Uint8Array(128);
    const waveBuffer = new Uint8Array(128);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(240, Math.floor(rect.width * dpr));
      const height = Math.max(240, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);
      const baseRadius = minDim * 0.29;
      const currentState = stateRef.current;

      ctx.clearRect(0, 0, w, h);

      // Read active analyser depending on state
      let targetEnergy = 0;
      const activeAnalyser =
        currentState === 'escuchando'
          ? inputAnalyserRef.current
          : currentState === 'hablando'
            ? outputAnalyserRef.current
            : null;

      if (activeAnalyser) {
        activeAnalyser.getByteFrequencyData(freqBuffer);
        activeAnalyser.getByteTimeDomainData(waveBuffer);
        let sum = 0;
        for (let i = 0; i < 48; i++) {
          sum += freqBuffer[i];
        }
        targetEnergy = Math.min(1, sum / (48 * 140));
      } else if (currentState === 'pensando') {
        targetEnergy = 0.24;
      } else {
        targetEnergy = 0.04;
      }

      smoothedEnergy += (targetEnergy - smoothedEnergy) * (prefersReducedMotion ? 0.3 : 0.16);
      if (!prefersReducedMotion) {
        phase +=
          currentState === 'pensando'
            ? 0.042
            : currentState === 'hablando'
              ? 0.032
              : currentState === 'escuchando'
                ? 0.025
                : 0.008;
      }

      const isActive = currentState !== 'inactivo';
      const accentRgb = '34, 211, 238'; // #22D3EE cold cyan

      // 1. Outer precision reference ring & azimuth ticks (72 ticks, 5 deg steps)
      const outerRadius = baseRadius * 1.32;
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = isActive
        ? `rgba(${accentRgb}, 0.16)`
        : 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      for (let i = 0; i < 72; i++) {
        const angle = (i / 72) * Math.PI * 2 - Math.PI / 2;
        const isMajor = i % 6 === 0;
        const tickInner = outerRadius - (isMajor ? 7 * dpr : 3 * dpr);
        const tickOuter = outerRadius;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * tickInner, cy + Math.sin(angle) * tickInner);
        ctx.lineTo(cx + Math.cos(angle) * tickOuter, cy + Math.sin(angle) * tickOuter);
        ctx.strokeStyle = isMajor
          ? isActive
            ? `rgba(${accentRgb}, 0.45)`
            : 'rgba(255, 255, 255, 0.18)'
          : 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      }

      // 2. Thinking calibrated arc sweep
      if (currentState === 'pensando') {
        const arcLen = Math.PI * 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, phase, phase + arcLen);
        ctx.strokeStyle = `rgba(${accentRgb}, 0.85)`;
        ctx.lineWidth = 1.75 * dpr;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, phase + Math.PI, phase + Math.PI + arcLen * 0.6);
        ctx.strokeStyle = `rgba(${accentRgb}, 0.35)`;
        ctx.lineWidth = 1.25 * dpr;
        ctx.stroke();
      }

      // 3. Harmonic concentric waveform rings (3 fine filaments)
      const ringCount = 3;
      const points = 128;

      for (let rIdx = 0; rIdx < ringCount; rIdx++) {
        const ringScale = 0.84 + rIdx * 0.13;
        const radius = baseRadius * ringScale;
        const ampScale = (1 - rIdx * 0.22) * (10 + smoothedEnergy * 34) * dpr;

        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const t = (i / points) * Math.PI * 2;
          let waveSample = 0;

          if (activeAnalyser && !prefersReducedMotion) {
            const idx = i % 64;
            const centered = (waveBuffer[idx] - 128) / 128;
            waveSample = centered * 0.85;
          }

          const harmonic =
            Math.sin(t * (3 + rIdx) + phase * (rIdx % 2 === 0 ? 1 : -1.2)) * 0.45 +
            Math.cos(t * (5 - rIdx) - phase * 0.7) * 0.25;

          const displacement = (waveSample + harmonic * (0.25 + smoothedEnergy)) * ampScale;
          const r = radius + (prefersReducedMotion ? smoothedEnergy * 6 * dpr : displacement);
          const x = cx + Math.cos(t) * r;
          const y = cy + Math.sin(t) * r;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        if (isActive) {
          const alpha = rIdx === 0 ? 0.92 : rIdx === 1 ? 0.42 : 0.18;
          ctx.strokeStyle = `rgba(${accentRgb}, ${alpha})`;
          ctx.lineWidth = (rIdx === 0 ? 1.75 : 1) * dpr;
        } else {
          const alpha = rIdx === 0 ? 0.26 : rIdx === 1 ? 0.12 : 0.06;
          ctx.strokeStyle = `rgba(244, 244, 245, ${alpha})`;
          ctx.lineWidth = 1 * dpr;
        }
        ctx.stroke();
      }

      // 4. Inner crosshair reticle (subtle instrument center)
      const crossSize = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx - crossSize, cy);
      ctx.lineTo(cx + crossSize, cy);
      ctx.moveTo(cx, cy - crossSize);
      ctx.lineTo(cx, cy + crossSize);
      ctx.strokeStyle = isActive
        ? `rgba(${accentRgb}, 0.55)`
        : 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      observer.disconnect();
    };
  }, [inputAnalyserRef, outputAnalyserRef]);

  return (
    <div className="relative flex flex-col items-center justify-center w-full select-none">
      <div className="relative w-[240px] h-[240px] sm:w-[300px] sm:h-[300px] lg:w-[330px] lg:h-[330px] flex items-center justify-center">
        <canvas
          ref={canvasRef}
          data-testid="jarvis-visualizer"
          aria-label={`Visualizador de audio de JARVIS en estado ${STATE_LABEL[assistantState]}`}
          className="w-full h-full block"
        />
      </div>
      <div
        data-testid="assistant-state-readout"
        className="mt-1 flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] tabular-nums"
      >
        <span
          className={
            assistantState === 'inactivo' ? 'text-[#71717A]' : 'text-[#22D3EE]'
          }
        >
          {STATE_LABEL[assistantState]}
        </span>
      </div>
    </div>
  );
}
