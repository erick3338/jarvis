import { Database, MessageSquare, Plus } from 'lucide-react';
import type { AssistantState } from '../types/jarvis';

export type SidePanelTab = 'conversacion' | 'memoria' | null;

interface TopBarProps {
  assistantState: AssistantState;
  activeTab: SidePanelTab;
  memoryCount: number;
  messageCount: number;
  onSelectTab: (tab: Exclude<SidePanelTab, null>) => void;
  onNewSession: () => void;
}

const STATE_TEXT: Record<AssistantState, string> = {
  inactivo: 'En espera',
  escuchando: 'Escuchando',
  pensando: 'Procesando',
  hablando: 'Hablando',
};

export function TopBar({
  assistantState,
  activeTab,
  memoryCount,
  messageCount,
  onSelectTab,
  onNewSession,
}: TopBarProps) {
  const isActive = assistantState !== 'inactivo';

  return (
    <header className="h-14 shrink-0 border-b border-white/[0.08] bg-[#0A0A0B] px-3.5 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
      {/* Zone 1: Brand wordmark + quiet explicit status text */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <span className="text-sm sm:text-base font-semibold tracking-[0.12em] text-[#F4F4F5] whitespace-nowrap shrink-0">
          JARVIS
        </span>
        <span className="hidden sm:inline text-[#71717A]" aria-hidden="true">
          ·
        </span>
        <span
          className={`hidden sm:inline font-mono text-xs whitespace-nowrap shrink-0 ${
            isActive ? 'text-[#22D3EE]' : 'text-[#71717A]'
          }`}
        >
          {STATE_TEXT[assistantState]}
        </span>
      </div>

      {/* Zone 2 & 3: Functional workspace actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={onNewSession}
          aria-label="Iniciar nueva conversación"
          className="h-11 sm:h-10 w-11 sm:w-auto sm:px-3 rounded-md border border-white/[0.08] bg-[#111113] hover:bg-[#161619] hover:border-white/[0.16] text-xs font-medium text-[#D4D4D8] hover:text-[#F4F4F5] transition-colors duration-150 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#A1A1AA]" strokeWidth={1.75} />
          <span className="hidden sm:inline">Nueva sesión</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('conversacion')}
          aria-pressed={activeTab === 'conversacion'}
          aria-label={`Conversación (${messageCount} mensajes)`}
          className={`h-11 sm:h-10 px-2.5 sm:px-3 rounded-md border text-xs font-medium transition-colors duration-150 inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'conversacion'
              ? 'border-[#22D3EE]/50 bg-[#22D3EE]/10 text-[#F4F4F5]'
              : 'border-white/[0.08] bg-[#111113] text-[#A1A1AA] hover:text-[#F4F4F5] hover:border-white/[0.16]'
          }`}
        >
          <MessageSquare
            className={`w-3.5 h-3.5 ${
              activeTab === 'conversacion' ? 'text-[#22D3EE]' : 'text-[#71717A]'
            }`}
            strokeWidth={1.75}
          />
          <span className="sm:hidden">Log</span>
          <span className="hidden sm:inline">Conversación</span>
          <span className="font-mono text-[11px] tabular-nums text-[#71717A]">
            {messageCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('memoria')}
          aria-pressed={activeTab === 'memoria'}
          aria-label={`Memoria (${memoryCount} recuerdos)`}
          className={`h-11 sm:h-10 px-2.5 sm:px-3 rounded-md border text-xs font-medium transition-colors duration-150 inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'memoria'
              ? 'border-[#22D3EE]/50 bg-[#22D3EE]/10 text-[#F4F4F5]'
              : 'border-white/[0.08] bg-[#111113] text-[#A1A1AA] hover:text-[#F4F4F5] hover:border-white/[0.16]'
          }`}
        >
          <Database
            className={`w-3.5 h-3.5 ${
              activeTab === 'memoria' ? 'text-[#22D3EE]' : 'text-[#71717A]'
            }`}
            strokeWidth={1.75}
          />
          <span>Memoria</span>
          <span
            data-testid="memory-count"
            className="font-mono text-[11px] tabular-nums text-[#71717A]"
          >
            {memoryCount}
          </span>
        </button>
      </div>
    </header>
  );
}
