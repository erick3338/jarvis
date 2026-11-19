/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import {
  clearAllMemories as dbClearAllMemories,
  deleteConversationById,
  deleteMemoryById,
  getAllConversations,
  getAllMemories,
  getMessagesByConversation,
  putConversation,
  putMemory,
  putMessage,
  replaceAllMemories,
  touchMemoriesLastUsed,
} from './db/indexedDb';
import { applyMemoryActions } from './utils/memoryLogic';
import { useJarvisEngine } from './hooks/useJarvisEngine';
import { TopBar, type SidePanelTab } from './components/TopBar';
import { VisualizerCanvas } from './components/VisualizerCanvas';
import { VoiceControls } from './components/VoiceControls';
import { SideDrawer } from './components/SideDrawer';
import type {
  ChatMessage,
  ConversationSession,
  MemoryAction,
  MemoryCategory,
  MemoryItem,
} from './types/jarvis';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultSession(): ConversationSession {
  const now = new Date().toISOString();
  return {
    id: createId('sess'),
    title: 'Sesión actual',
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTab, setActiveTab] = useState<SidePanelTab>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const memoriesRef = useRef<MemoryItem[]>([]);
  memoriesRef.current = memories;
  const activeSessionIdRef = useRef<string>('');
  activeSessionIdRef.current = activeSessionId;
  const sessionsRef = useRef<ConversationSession[]>([]);
  sessionsRef.current = sessions;

  // Hydrate IndexedDB on mount
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const [loadedMemories, loadedSessions] = await Promise.all([
          getAllMemories(),
          getAllConversations(),
        ]);

        let currentSessions = loadedSessions;
        if (currentSessions.length === 0) {
          const initial = makeDefaultSession();
          await putConversation(initial);
          currentSessions = [initial];
        }

        const firstId = currentSessions[0].id;
        const loadedMessages = await getMessagesByConversation(firstId);

        if (!cancelled) {
          setMemories(loadedMemories);
          setSessions(currentSessions);
          setActiveSessionId(firstId);
          setMessages(loadedMessages);
          setIsHydrated(true);
        }
      } catch {
        if (!cancelled) {
          const fallback = makeDefaultSession();
          setSessions([fallback]);
          setActiveSessionId(fallback.id);
          setIsHydrated(true);
        }
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Background memory extraction after each turn
  const runBackgroundMemoryExtraction = useCallback(
    async (userText: string, assistantText: string) => {
      try {
        const currentMemories = memoriesRef.current;
        const resp = await fetch('/api/memory/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: userText,
            assistantMessage: assistantText,
            existingMemories: currentMemories.map((m) => ({
              id: m.id,
              text: m.text,
              category: m.category,
            })),
          }),
        });

        if (!resp.ok) return;
        const data = (await resp.json()) as { actions?: MemoryAction[] };
        if (!Array.isArray(data.actions) || data.actions.length === 0) return;

        const applied = applyMemoryActions(memoriesRef.current, data.actions);
        if (applied.changed) {
          setMemories(applied.next);
          await replaceAllMemories(applied.next);
        }
      } catch {
        // Silent background resilience: never interrupt conversation UX
      }
    },
    [],
  );

  const handleCommitTurn = useCallback(
    async (
      userText: string,
      assistantText: string,
      source: 'voz' | 'texto',
      usedMemoryIds: string[],
    ) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;

      const now = new Date().toISOString();
      const userMsg: ChatMessage = {
        id: createId('msg'),
        conversationId: sessionId,
        role: 'user',
        text: userText,
        timestamp: now,
        source,
      };
      const assistantTime = new Date(Date.now() + 1).toISOString();
      const assistantMsg: ChatMessage = {
        id: createId('msg'),
        conversationId: sessionId,
        role: 'assistant',
        text: assistantText,
        timestamp: assistantTime,
        source,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Update session title if still default
      const currentSess = sessionsRef.current.find((s) => s.id === sessionId);
      const nextTitle =
        currentSess && currentSess.title === 'Sesión actual'
          ? userText.slice(0, 44) + (userText.length > 44 ? '…' : '')
          : currentSess?.title ?? 'Sesión';

      const updatedSess: ConversationSession = {
        id: sessionId,
        title: nextTitle,
        createdAt: currentSess?.createdAt ?? now,
        updatedAt: assistantTime,
      };

      setSessions((prev) => [
        updatedSess,
        ...prev.filter((s) => s.id !== sessionId),
      ]);

      try {
        await Promise.all([
          putMessage(userMsg),
          putMessage(assistantMsg),
          putConversation(updatedSess),
          usedMemoryIds.length > 0
            ? touchMemoriesLastUsed(usedMemoryIds, assistantTime)
            : Promise.resolve(),
        ]);

        if (usedMemoryIds.length > 0) {
          const usedSet = new Set(usedMemoryIds);
          setMemories((prev) =>
            prev.map((m) =>
              usedSet.has(m.id) ? { ...m, lastUsedAt: assistantTime } : m,
            ),
          );
        }
      } catch {
        // Ignore storage write error if private mode blocks IDB
      }

      void runBackgroundMemoryExtraction(userText, assistantText);
    },
    [runBackgroundMemoryExtraction],
  );

  const {
    assistantState,
    voiceMode,
    isMicActive,
    liveUserTranscript,
    liveAssistantTranscript,
    error,
    inputAnalyserRef,
    outputAnalyserRef,
    sendTextMessage,
    toggleHandsFree,
    startPushToTalk,
    releasePushToTalk,
    switchVoiceMode,
    interrupt,
    dismissError,
  } = useJarvisEngine({
    memories,
    messages,
    onCommitTurn: handleCommitTurn,
  });

  // Keyboard shortcuts: Space (hold-to-talk) and Escape (interrupt/silence)
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    const isTypingElement = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        interrupt();
        return;
      }

      if (e.code === 'Space' && !e.repeat && !isTypingElement(e.target)) {
        // Only hijack Space if not focused on a button that handles Space natively
        if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') {
          return;
        }
        e.preventDefault();
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          void startPushToTalk();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = false;
        releasePushToTalk();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [interrupt, releasePushToTalk, startPushToTalk]);

  const handleToggleTab = (tab: Exclude<SidePanelTab, null>) => {
    setActiveTab((prev) => (prev === tab ? null : tab));
  };

  const handleNewSession = async () => {
    interrupt();
    const fresh = makeDefaultSession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setMessages([]);
    try {
      await putConversation(fresh);
    } catch {
      // Ignore
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    interrupt();
    setActiveSessionId(sessionId);
    try {
      const msgs = await getMessagesByConversation(sessionId);
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const remaining = sessions.filter((s) => s.id !== sessionId);
    if (remaining.length === 0) return;

    setSessions(remaining);
    if (activeSessionId === sessionId) {
      const nextId = remaining[0].id;
      setActiveSessionId(nextId);
      const msgs = await getMessagesByConversation(nextId);
      setMessages(msgs);
    }
    await deleteConversationById(sessionId);
  };

  const handleEditMemory = async (
    id: string,
    nextText: string,
    nextCategory: MemoryCategory,
  ) => {
    const now = new Date().toISOString();
    let updatedItem: MemoryItem | null = null;
    setMemories((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        updatedItem = {
          ...m,
          text: nextText,
          category: nextCategory,
          updatedAt: now,
        };
        return updatedItem;
      }),
    );
    if (updatedItem) {
      await putMemory(updatedItem);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await deleteMemoryById(id);
  };

  const handleClearAllMemories = async () => {
    setMemories([]);
    await dbClearAllMemories();
  };

  // Determine discrete live transcript text below visualizer
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const displayedUserLine = liveUserTranscript;
  const displayedAssistantLine =
    liveAssistantTranscript ||
    (assistantState === 'inactivo' && messages.length > 0
      ? lastAssistantMsg?.text ?? ''
      : '');

  return (
    <div
      data-state={assistantState}
      className="h-dvh w-full bg-[#0A0A0B] text-[#F4F4F5] flex flex-col overflow-hidden"
    >
      <TopBar
        assistantState={assistantState}
        activeTab={activeTab}
        memoryCount={memories.length}
        messageCount={messages.length}
        onSelectTab={handleToggleTab}
        onNewSession={handleNewSession}
      />

      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Main Instrument Stage */}
        <main className="flex-1 min-w-0 flex flex-col justify-between px-4 sm:px-8 py-6 sm:py-8 overflow-y-auto">
          {/* Gentle inline error banner */}
          <div className="w-full max-w-xl mx-auto min-h-[28px]">
            {error && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md border border-[#EF4444]/40 bg-[#181113] text-xs text-[#FCA5A5]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" strokeWidth={1.75} />
                  <span className="truncate sm:whitespace-normal">{error.message}</span>
                </div>
                <button
                  type="button"
                  onClick={dismissError}
                  aria-label="Cerrar aviso de error"
                  className="h-7 w-7 rounded flex items-center justify-center text-[#FCA5A5] hover:bg-white/[0.06] shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
            )}
          </div>

          {/* Centerpiece Canvas + Subtle Live Transcript */}
          <section
            aria-label="Interfaz de voz"
            className="flex-1 flex flex-col items-center justify-center py-4 gap-5 min-h-[320px]"
          >
            <VisualizerCanvas
              assistantState={assistantState}
              inputAnalyserRef={inputAnalyserRef}
              outputAnalyserRef={outputAnalyserRef}
            />

            <div
              aria-live="polite"
              data-testid="live-transcript"
              className="w-full max-w-xl min-h-[76px] flex flex-col items-center justify-start text-center px-2 gap-2"
            >
              {displayedUserLine && (
                <p className="font-mono text-xs text-[#71717A] max-w-lg line-clamp-2">
                  «{displayedUserLine}»
                </p>
              )}

              {assistantState === 'pensando' && !liveAssistantTranscript ? (
                <p className="font-mono text-xs text-[#22D3EE]">
                  Analizando…
                </p>
              ) : displayedAssistantLine ? (
                <p className="text-sm sm:text-[15px] leading-relaxed text-[#E4E4E7] max-w-lg transition-opacity duration-200">
                  {displayedAssistantLine}
                </p>
              ) : isHydrated ? (
                <p className="text-xs text-[#71717A]">
                  Listo. Activa el micrófono o escribe para empezar.
                </p>
              ) : null}
            </div>
          </section>

          {/* Control Dock */}
          <section aria-label="Controles de voz y texto" className="pt-2">
            <VoiceControls
              assistantState={assistantState}
              voiceMode={voiceMode}
              isMicActive={isMicActive}
              onSwitchVoiceMode={switchVoiceMode}
              onToggleHandsFree={toggleHandsFree}
              onStartPushToTalk={startPushToTalk}
              onReleasePushToTalk={releasePushToTalk}
              onInterrupt={interrupt}
              onSendText={sendTextMessage}
            />
          </section>
        </main>

        {/* Collapsible Side Panel (Terminal Log & Memory Inspector) */}
        <SideDrawer
          activeTab={activeTab}
          onClose={() => setActiveTab(null)}
          onSelectTab={setActiveTab}
          sessions={sessions}
          activeSessionId={activeSessionId}
          messages={messages}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={handleDeleteSession}
          memories={memories}
          onEditMemory={handleEditMemory}
          onDeleteMemory={handleDeleteMemory}
          onClearAllMemories={handleClearAllMemories}
        />
      </div>
    </div>
  );
}
