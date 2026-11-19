import { useMemo, useState } from 'react';
import {
  Check,
  History,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { filterMemories } from '../utils/memoryLogic';
import type {
  ChatMessage,
  ConversationSession,
  MemoryCategory,
  MemoryItem,
} from '../types/jarvis';
import type { SidePanelTab } from './TopBar';

interface SideDrawerProps {
  activeTab: SidePanelTab;
  onClose: () => void;
  onSelectTab: (tab: Exclude<SidePanelTab, null>) => void;
  sessions: ConversationSession[];
  activeSessionId: string;
  messages: ChatMessage[];
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  memories: MemoryItem[];
  onEditMemory: (id: string, nextText: string, nextCategory: MemoryCategory) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onClearAllMemories: () => Promise<void>;
}

const CATEGORIES: Array<{ value: MemoryCategory | 'todas'; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'identidad', label: 'Identidad' },
  { value: 'preferencias', label: 'Gustos' },
  { value: 'proyectos', label: 'Proyectos' },
  { value: 'rutinas', label: 'Rutinas' },
  { value: 'personas', label: 'Personas' },
  { value: 'otros', label: 'Otros' },
];

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function SideDrawer({
  activeTab,
  onClose,
  onSelectTab,
  sessions,
  activeSessionId,
  messages,
  onSwitchSession,
  onDeleteSession,
  memories,
  onEditMemory,
  onDeleteMemory,
  onClearAllMemories,
}: SideDrawerProps) {
  const [showSessionsList, setShowSessionsList] = useState(false);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory | 'todas'>('todas');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryCategory>('otros');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const filteredMemories = useMemo(
    () => filterMemories(memories, memorySearch, memoryCategory),
    [memories, memorySearch, memoryCategory],
  );

  if (!activeTab) return null;

  const startEdit = (mem: MemoryItem) => {
    setEditingId(mem.id);
    setEditText(mem.text);
    setEditCategory(mem.category);
  };

  const saveEdit = async () => {
    if (!editingId || !editText.trim()) return;
    await onEditMemory(editingId, editText.trim(), editCategory);
    setEditingId(null);
  };

  return (
    <aside
      aria-label={activeTab === 'conversacion' ? 'Registro de conversación' : 'Panel de memoria'}
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] lg:static lg:w-[420px] shrink-0 border-l border-white/[0.08] bg-[#111113] flex flex-col h-full"
    >
      {/* Drawer Header */}
      <div className="h-14 shrink-0 px-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
        <div role="tablist" className="flex items-center gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'conversacion'}
            onClick={() => onSelectTab('conversacion')}
            className={`h-9 px-3 rounded text-xs font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer ${
              activeTab === 'conversacion'
                ? 'bg-[#1C1C21] text-[#F4F4F5]'
                : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
            }`}
          >
            Conversación
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'memoria'}
            onClick={() => onSelectTab('memoria')}
            className={`h-9 px-3 rounded text-xs font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer ${
              activeTab === 'memoria'
                ? 'bg-[#1C1C21] text-[#F4F4F5]'
                : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
            }`}
          >
            Memoria ({memories.length})
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel lateral"
          className="h-9 w-9 rounded-md border border-white/[0.08] hover:border-white/[0.16] flex items-center justify-center text-[#A1A1AA] hover:text-[#F4F4F5] transition-colors duration-150 cursor-pointer"
        >
          <X className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Tab 1: Terminal-style Conversation Log & History */}
      {activeTab === 'conversacion' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#0E0E10]">
            <button
              type="button"
              onClick={() => setShowSessionsList((v) => !v)}
              aria-expanded={showSessionsList}
              className="h-8 px-2.5 rounded border border-white/[0.08] hover:border-white/[0.16] text-xs text-[#D4D4D8] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-[#22D3EE]" strokeWidth={1.75} />
              <span>Sesiones ({sessions.length})</span>
            </button>
            <span className="font-mono text-[11px] text-[#71717A] tabular-nums">
              {messages.length} líneas
            </span>
          </div>

          {showSessionsList && (
            <div className="max-h-56 overflow-y-auto border-b border-white/[0.08] bg-[#0C0C0E] divide-y divide-white/[0.06]">
              {sessions.map((sess) => {
                const isCurrent = sess.id === activeSessionId;
                return (
                  <div
                    key={sess.id}
                    className={`px-4 py-2.5 flex items-center justify-between gap-2 ${
                      isCurrent ? 'bg-[#161619]' : 'hover:bg-[#141417]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchSession(sess.id);
                        setShowSessionsList(false);
                      }}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div
                        className={`text-xs truncate ${
                          isCurrent ? 'text-[#22D3EE] font-medium' : 'text-[#E4E4E7]'
                        }`}
                      >
                        {sess.title}
                      </div>
                      <div className="font-mono text-[11px] text-[#71717A] tabular-nums mt-0.5">
                        {formatShortDate(sess.updatedAt)}
                      </div>
                    </button>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteSession(sess.id)}
                        aria-label={`Borrar sesión ${sess.title}`}
                        className="h-8 w-8 rounded flex items-center justify-center text-[#71717A] hover:text-[#EF4444] transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Terminal log stream — strictly no chat bubbles */}
          <div
            data-testid="conversation-log"
            className="flex-1 overflow-y-auto px-4 py-4 font-mono text-xs leading-relaxed"
          >
            {messages.length === 0 ? (
              <div className="py-12 text-center text-[#71717A]">
                Sin intervenciones en esta sesión. Habla o escribe para iniciar el registro.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {messages.map((msg) => (
                  <div key={msg.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2 text-[11px] text-[#71717A] tabular-nums mb-1">
                      <span>{formatClock(msg.timestamp)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          msg.role === 'assistant'
                            ? 'text-[#22D3EE] font-semibold'
                            : 'text-[#E4E4E7] font-semibold'
                        }
                      >
                        {msg.role === 'assistant' ? 'JARVIS' : 'TÚ'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{msg.source}</span>
                    </div>
                    <p className="font-sans text-[13px] leading-relaxed text-[#E4E4E7] whitespace-pre-wrap break-words">
                      {msg.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Persistent Memory Inspector */}
      {activeTab === 'memoria' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Search & Category Filter */}
          <div className="p-4 border-b border-white/[0.08] flex flex-col gap-3 bg-[#0E0E10]">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={1.75}
              />
              <label htmlFor="memory-search" className="sr-only">
                Buscar en memoria
              </label>
              <input
                id="memory-search"
                type="search"
                value={memorySearch}
                onChange={(e) => setMemorySearch(e.target.value)}
                placeholder="Buscar recuerdos…"
                className="w-full h-9 pl-9 pr-3 rounded border border-white/[0.08] bg-[#161619] text-xs text-[#F4F4F5] placeholder:text-[#71717A] focus:border-[#22D3EE]/60 focus:outline-none"
              />
            </div>

            <div
              role="group"
              aria-label="Filtrar memorias por categoría"
              className="flex flex-wrap gap-1.5"
            >
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setMemoryCategory(cat.value)}
                  aria-pressed={memoryCategory === cat.value}
                  className={`h-8 px-2.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    memoryCategory === cat.value
                      ? 'bg-[#22D3EE]/15 text-[#22D3EE] border border-[#22D3EE]/40'
                      : 'bg-[#161619] text-[#A1A1AA] border border-white/[0.06] hover:text-[#F4F4F5]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Memory List */}
          <div
            data-testid="memory-list"
            className="flex-1 overflow-y-auto divide-y divide-white/[0.06]"
          >
            {filteredMemories.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-xs text-[#A1A1AA]">
                  {memories.length === 0
                    ? 'Aún no hay recuerdos guardados.'
                    : 'Ningún recuerdo coincide con el filtro.'}
                </p>
                <p className="font-mono text-[11px] text-[#71717A] mt-2">
                  Prueba decir: «Recuerda que tomo café sin azúcar».
                </p>
              </div>
            ) : (
              filteredMemories.map((mem) => {
                const isEditing = editingId === mem.id;
                return (
                  <div key={mem.id} className="px-4 py-3.5 hover:bg-[#151518] transition-colors">
                    {isEditing ? (
                      <div className="flex flex-col gap-2.5">
                        <label htmlFor={`edit-mem-${mem.id}`} className="sr-only">
                          Editar texto de memoria
                        </label>
                        <textarea
                          id={`edit-mem-${mem.id}`}
                          rows={2}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full p-2.5 rounded border border-[#22D3EE]/50 bg-[#0A0A0B] text-xs text-[#F4F4F5] focus:outline-none"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <select
                            aria-label="Categoría de memoria"
                            value={editCategory}
                            onChange={(e) =>
                              setEditCategory(e.target.value as MemoryCategory)
                            }
                            className="h-8 px-2 rounded border border-white/[0.1] bg-[#161619] text-xs text-[#E4E4E7]"
                          >
                            {CATEGORIES.filter((c) => c.value !== 'todas').map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="h-8 px-2.5 rounded border border-white/[0.08] text-xs text-[#A1A1AA] hover:text-[#F4F4F5] cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="h-8 px-2.5 rounded border border-[#22D3EE]/50 bg-[#22D3EE]/15 text-xs text-[#22D3EE] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" strokeWidth={1.75} />
                              <span>Guardar</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] leading-snug text-[#F4F4F5] break-words">
                            {mem.text}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#71717A] tabular-nums">
                            <span className="text-[#A1A1AA]">{mem.category}</span>
                            <span aria-hidden="true">·</span>
                            <span>creada {formatShortDate(mem.createdAt)}</span>
                            <span aria-hidden="true">·</span>
                            <span>uso {formatShortDate(mem.lastUsedAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(mem)}
                            aria-label={`Editar memoria: ${mem.text}`}
                            className="h-8 w-8 rounded flex items-center justify-center text-[#71717A] hover:text-[#F4F4F5] hover:bg-white/[0.05] cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteMemory(mem.id)}
                            aria-label={`Borrar memoria: ${mem.text}`}
                            className="h-8 w-8 rounded flex items-center justify-center text-[#71717A] hover:text-[#EF4444] hover:bg-white/[0.05] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer clear-all control */}
          {memories.length > 0 && (
            <div className="p-3 border-t border-white/[0.08] bg-[#0E0E10] flex items-center justify-between gap-2">
              {!confirmClearAll ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="w-full h-9 px-3 rounded border border-white/[0.08] hover:border-[#EF4444]/50 text-xs text-[#A1A1AA] hover:text-[#EF4444] transition-colors cursor-pointer"
                >
                  Borrar toda la memoria
                </button>
              ) : (
                <div className="w-full flex items-center justify-between gap-2">
                  <span className="text-xs text-[#EF4444]">¿Borrar todo?</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(false)}
                      className="h-8 px-2.5 rounded border border-white/[0.08] text-xs text-[#A1A1AA] cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onClearAllMemories();
                        setConfirmClearAll(false);
                      }}
                      className="h-8 px-2.5 rounded border border-[#EF4444]/60 bg-[#EF4444]/15 text-xs text-[#EF4444] cursor-pointer"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
