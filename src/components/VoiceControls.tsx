import { useState, type FormEvent } from 'react';
import { Mic, MicOff, Send, Square } from 'lucide-react';
import type { AssistantState, VoiceMode } from '../types/jarvis';

interface VoiceControlsProps {
  assistantState: AssistantState;
  voiceMode: VoiceMode;
  isMicActive: boolean;
  onSwitchVoiceMode: (mode: VoiceMode) => void;
  onToggleHandsFree: () => void;
  onStartPushToTalk: () => void;
  onReleasePushToTalk: () => void;
  onInterrupt: () => void;
  onSendText: (text: string) => void;
}

export function VoiceControls({
  assistantState,
  voiceMode,
  isMicActive,
  onSwitchVoiceMode,
  onToggleHandsFree,
  onStartPushToTalk,
  onReleasePushToTalk,
  onInterrupt,
  onSendText,
}: VoiceControlsProps) {
  const [textInput, setTextInput] = useState('');
  const [isHoldingButton, setIsHoldingButton] = useState(false);

  const canInterrupt =
    assistantState === 'hablando' || assistantState === 'pensando';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed) return;
    setTextInput('');
    onSendText(trimmed);
  };

  const handlePointerDown = () => {
    setIsHoldingButton(true);
    onStartPushToTalk();
  };

  const handlePointerEnd = () => {
    if (!isHoldingButton) return;
    setIsHoldingButton(false);
    onReleasePushToTalk();
  };

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-4">
      {/* Voice mode selector + primary voice action */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Modo de entrada de voz"
          className="grid grid-cols-2 sm:inline-flex items-center p-1 rounded-md border border-white/[0.08] bg-[#111113] shrink-0"
        >
          <button
            type="button"
            onClick={() => onSwitchVoiceMode('manos-libres')}
            aria-pressed={voiceMode === 'manos-libres'}
            className={`h-10 sm:h-9 px-3 rounded text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
              voiceMode === 'manos-libres'
                ? 'bg-[#1C1C21] text-[#F4F4F5]'
                : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
            }`}
          >
            Manos libres
          </button>
          <button
            type="button"
            onClick={() => onSwitchVoiceMode('pulsar')}
            aria-pressed={voiceMode === 'pulsar'}
            className={`h-10 sm:h-9 px-3 rounded text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
              voiceMode === 'pulsar'
                ? 'bg-[#1C1C21] text-[#F4F4F5]'
                : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
            }`}
          >
            Pulsar para hablar
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {voiceMode === 'manos-libres' ? (
            <button
              type="button"
              onClick={onToggleHandsFree}
              className={`flex-1 sm:flex-initial h-11 px-5 rounded-md border text-xs font-semibold tracking-wide transition-colors duration-150 inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                isMicActive
                  ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE] hover:bg-[#22D3EE]/20'
                  : 'border-white/[0.14] bg-[#161619] text-[#F4F4F5] hover:border-[#22D3EE]/60 hover:bg-[#1C1C21]'
              }`}
            >
              {isMicActive ? (
                <>
                  <MicOff className="w-4 h-4" strokeWidth={1.75} />
                  <span>Detener escucha</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 text-[#22D3EE]" strokeWidth={1.75} />
                  <span>Activar manos libres</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onPointerLeave={handlePointerEnd}
              className={`flex-1 sm:flex-initial h-11 px-5 rounded-md border text-xs font-semibold tracking-wide transition-colors duration-150 inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 select-none cursor-pointer ${
                isHoldingButton || assistantState === 'escuchando'
                  ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE]'
                  : 'border-white/[0.14] bg-[#161619] text-[#F4F4F5] hover:border-[#22D3EE]/60'
              }`}
            >
              <Mic className="w-4 h-4" strokeWidth={1.75} />
              <span>
                {isHoldingButton ? 'Soltar al terminar' : 'Mantener para hablar'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onInterrupt}
            disabled={!canInterrupt}
            aria-label="Callar respuesta (Escape)"
            className={`h-11 px-4 rounded-md border text-xs font-medium transition-colors duration-150 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
              canInterrupt
                ? 'border-white/[0.18] bg-[#161619] text-[#F4F4F5] hover:border-[#22D3EE]/60 cursor-pointer'
                : 'border-white/[0.06] bg-[#111113] text-[#52525B] cursor-not-allowed'
            }`}
          >
            <Square className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Callar</span>
          </button>
        </div>
      </div>

      {/* Backup text input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label htmlFor="jarvis-text-input" className="sr-only">
          Escribir mensaje para JARVIS
        </label>
        <input
          id="jarvis-text-input"
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="Escribe a JARVIS si no puedes hablar…"
          autoComplete="off"
          className="flex-1 h-11 px-3.5 rounded-md border border-white/[0.08] bg-[#111113] text-sm text-[#F4F4F5] placeholder:text-[#71717A] focus:border-[#22D3EE]/60 focus:outline-none transition-colors duration-150"
        />
        <button
          type="submit"
          disabled={!textInput.trim()}
          aria-label="Enviar mensaje"
          className="h-11 px-4 rounded-md border border-white/[0.12] bg-[#161619] text-xs font-medium text-[#F4F4F5] hover:border-[#22D3EE]/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5 text-[#22D3EE]" strokeWidth={1.75} />
          <span>Enviar</span>
        </button>
      </form>

      {/* Keyboard shortcut reference */}
      <div className="flex items-center justify-center gap-4 font-mono text-[11px] text-[#71717A]">
        <span>Espacio · mantener para hablar</span>
        <span aria-hidden="true">/</span>
        <span>Esc · callar</span>
      </div>
    </div>
  );
}
