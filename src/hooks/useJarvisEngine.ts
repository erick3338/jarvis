import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeRmsEnergy,
  downsampleTo16k,
  float32ToInt16Bytes,
  pcm16BytesToFloat32,
  uint8ToBase64,
  base64ToUint8,
} from '../utils/audioMath';
import {
  formatMemoriesForPrompt,
  selectRelevantMemories,
} from '../utils/memoryLogic';
import { StreamSentenceSplitter } from '../utils/streamSentenceSplitter';
import type {
  AppError,
  AssistantState,
  ChatMessage,
  MemoryItem,
  VoiceMode,
} from '../types/jarvis';

interface UseJarvisEngineOptions {
  memories: MemoryItem[];
  messages: ChatMessage[];
  onCommitTurn: (
    userText: string,
    assistantText: string,
    source: 'voz' | 'texto',
    usedMemoryIds: string[],
  ) => Promise<void>;
}

export function useJarvisEngine({
  memories,
  messages,
  onCommitTurn,
}: UseJarvisEngineOptions) {
  const [assistantState, setAssistantState] = useState<AssistantState>('inactivo');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('manos-libres');
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantTranscript, setLiveAssistantTranscript] = useState('');
  const [error, setError] = useState<AppError | null>(null);
  const [isMicActive, setIsMicActive] = useState(false);

  // Refs for 60fps canvas visualizer access without React re-renders
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  // Latest state refs to prevent stale closures inside audio/WS callbacks
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onCommitTurnRef = useRef(onCommitTurn);
  onCommitTurnRef.current = onCommitTurn;
  const assistantStateRef = useRef<AssistantState>('inactivo');
  const voiceModeRef = useRef<VoiceMode>('manos-libres');
  voiceModeRef.current = voiceMode;

  const setSyncedState = useCallback((next: AssistantState) => {
    assistantStateRef.current = next;
    setAssistantState(next);
  }, []);

  // Audio playback graph (24kHz)
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Mic capture graph
  const inputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Live WS session
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef(false);
  const isStreamingMicToWsRef = useRef(false);
  const liveUserTurnBufRef = useRef('');
  const liveAssistantTurnBufRef = useRef('');
  const liveUsedMemoryIdsRef = useRef<string[]>([]);
  const bargeInFramesRef = useRef(0);

  // Text + streaming TTS abort/queue refs
  const chatAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsWorkerRunningRef = useRef(false);
  const ttsGenerationIdRef = useRef(0);

  const ensureOutputAudio = useCallback(() => {
    if (!outputCtxRef.current || outputCtxRef.current.state === 'closed') {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ sampleRate: 24000 });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      analyser.connect(ctx.destination);
      outputCtxRef.current = ctx;
      outputAnalyserRef.current = analyser;
    }
    if (outputCtxRef.current.state === 'suspended') {
      void outputCtxRef.current.resume();
    }
    return {
      ctx: outputCtxRef.current,
      analyser: outputAnalyserRef.current!,
    };
  }, []);

  const schedulePcm24kChunk = useCallback(
    (pcmBytes: Uint8Array) => {
      if (pcmBytes.byteLength < 2) return;
      const { ctx, analyser } = ensureOutputAudio();
      const float32 = pcm16BytesToFloat32(pcmBytes);
      if (float32.length === 0) return;

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyser);

      const now = ctx.currentTime;
      if (nextStartTimeRef.current < now + 0.02) {
        nextStartTimeRef.current = now + 0.02;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };
    },
    [ensureOutputAudio],
  );

  const stopOutputAudio = useCallback(() => {
    ttsGenerationIdRef.current += 1;
    ttsQueueRef.current = [];
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;

    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped source
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const interrupt = useCallback(() => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    stopOutputAudio();

    if (isMicActive && voiceModeRef.current === 'manos-libres') {
      setSyncedState('escuchando');
    } else {
      setSyncedState('inactivo');
    }
  }, [isMicActive, setSyncedState, stopOutputAudio]);

  // Fallback browser TTS in es-MX when server streaming TTS cannot run
  const speakWithWebSpeechFallback = useCallback((text: string, generationId: number) => {
    return new Promise<void>((resolve) => {
      if (
        typeof window === 'undefined' ||
        !('speechSynthesis' in window) ||
        generationId !== ttsGenerationIdRef.current
      ) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const maxWaitMs = Math.min(12000, Math.max(1200, text.length * 75));
      const timer = setTimeout(finish, maxWaitMs);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-MX';
      utterance.rate = 1.02;
      const voices = window.speechSynthesis.getVoices();
      const mxVoice =
        voices.find((v) => v.lang.toLowerCase().includes('es-mx')) ??
        voices.find((v) => v.lang.toLowerCase().startsWith('es'));
      if (mxVoice) utterance.voice = mxVoice;

      utterance.onend = finish;
      utterance.onerror = finish;
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    });
  }, []);

  const waitForScheduledAudioDrain = useCallback(async (generationId: number) => {
    while (
      generationId === ttsGenerationIdRef.current &&
      activeSourcesRef.current.size > 0
    ) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }, []);

  const processTtsQueue = useCallback(
    async (generationId: number) => {
      if (ttsWorkerRunningRef.current) return;
      ttsWorkerRunningRef.current = true;

      try {
        while (
          ttsQueueRef.current.length > 0 &&
          generationId === ttsGenerationIdRef.current
        ) {
          const fragment = ttsQueueRef.current.shift()!;
          if (!fragment.trim()) continue;

          setSyncedState('hablando');
          const controller = new AbortController();
          ttsAbortRef.current = controller;

          try {
            const resp = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: fragment }),
              signal: controller.signal,
            });

            if (resp.status === 204) {
              await speakWithWebSpeechFallback(fragment, generationId);
              continue;
            }

            if (!resp.ok || !resp.body) {
              throw new Error(`TTS HTTP ${resp.status}`);
            }

            const reader = resp.body.getReader();
            let leftover: Uint8Array | null = null;

            while (generationId === ttsGenerationIdRef.current) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!value || value.byteLength === 0) continue;

              let combined: Uint8Array;
              if (leftover && leftover.byteLength > 0) {
                combined = new Uint8Array(leftover.byteLength + value.byteLength);
                combined.set(leftover, 0);
                combined.set(value, leftover.byteLength);
                leftover = null;
              } else {
                combined = value;
              }

              const evenLen = combined.byteLength - (combined.byteLength % 2);
              if (evenLen > 0) {
                schedulePcm24kChunk(combined.subarray(0, evenLen));
              }
              if (combined.byteLength > evenLen) {
                leftover = combined.slice(evenLen);
              }
            }
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') {
              break;
            }
            // Graceful fallback to Mexican Spanish Web Speech API
            await speakWithWebSpeechFallback(fragment, generationId);
          }
        }

        await waitForScheduledAudioDrain(generationId);
      } finally {
        ttsWorkerRunningRef.current = false;
        if (
          generationId === ttsGenerationIdRef.current &&
          assistantStateRef.current === 'hablando'
        ) {
          setSyncedState(
            isMicActive && voiceModeRef.current === 'manos-libres'
              ? 'escuchando'
              : 'inactivo',
          );
        }
      }
    },
    [
      isMicActive,
      schedulePcm24kChunk,
      setSyncedState,
      speakWithWebSpeechFallback,
      waitForScheduledAudioDrain,
    ],
  );

  const enqueueTtsFragment = useCallback(
    (fragment: string, generationId: number) => {
      if (generationId !== ttsGenerationIdRef.current) return;
      ttsQueueRef.current.push(fragment);
      void processTtsQueue(generationId);
    },
    [processTtsQueue],
  );

  // Send text turn (works anytime, streams response & starts TTS on first phrase)
  const sendTextMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError({
          code: 'offline',
          message: 'Sin conexión a internet. Revisa tu red e intenta de nuevo.',
        });
        return;
      }

      setError(null);
      interrupt();

      const generationId = ++ttsGenerationIdRef.current;
      setLiveUserTranscript(text);
      setLiveAssistantTranscript('');
      setSyncedState('pensando');

      const relevant = selectRelevantMemories(text, memoriesRef.current, 12);
      const usedIds = relevant.map((m) => m.id);
      const memoriesPrompt = formatMemoriesForPrompt(relevant);

      const historyPayload = messagesRef.current.slice(-14).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const controller = new AbortController();
      chatAbortRef.current = controller;

      const splitter = new StreamSentenceSplitter();
      let fullReply = '';

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: historyPayload,
            memories: memoriesPrompt,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          let errMsg = 'No pude obtener respuesta del servidor.';
          try {
            const payload = (await resp.json()) as { error?: string };
            if (payload?.error) errMsg = payload.error;
          } catch {
            // Keep default message
          }
          throw new Error(errMsg);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            const parsed = JSON.parse(jsonStr) as {
              delta?: string;
              done?: boolean;
              fullText?: string;
              error?: string;
            };

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.delta) {
              fullReply += parsed.delta;
              setLiveAssistantTranscript(fullReply);
              const fragments = splitter.push(parsed.delta);
              for (const frag of fragments) {
                enqueueTtsFragment(frag, generationId);
              }
            }

            if (parsed.done) {
              const tail = splitter.flush();
              for (const frag of tail) {
                enqueueTtsFragment(frag, generationId);
              }
            }
          }
        }

        if (fullReply.trim()) {
          await onCommitTurnRef.current(text, fullReply.trim(), 'texto', usedIds);
        }
        if (ttsQueueRef.current.length === 0 && !ttsWorkerRunningRef.current) {
          setSyncedState(
            isMicActive && voiceModeRef.current === 'manos-libres'
              ? 'escuchando'
              : 'inactivo',
          );
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError({
          code: 'api',
          message:
            err instanceof Error
              ? err.message
              : 'Error al comunicarse con JARVIS.',
        });
        setSyncedState(
          isMicActive && voiceModeRef.current === 'manos-libres'
            ? 'escuchando'
            : 'inactivo',
        );
      }
    },
    [enqueueTtsFragment, interrupt, isMicActive, setSyncedState],
  );

  // Teardown microphone & WS live session
  const teardownLiveVoice = useCallback(() => {
    isStreamingMicToWsRef.current = false;
    wsReadyRef.current = false;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch {
        // Ignore
      }
      micSourceRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      void inputCtxRef.current.close();
    }
    inputCtxRef.current = null;
    inputAnalyserRef.current = null;
    setIsMicActive(false);
  }, []);

  const ensureLiveConnection = useCallback(
    async (streamImmediately: boolean) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError({
          code: 'offline',
          message: 'Sin conexión a internet. El modo de voz requiere conexión.',
        });
        return false;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError({
          code: 'mic-missing',
          message: 'Este navegador no soporta captura de audio. Usa el campo de texto.',
        });
        return false;
      }

      setError(null);

      try {
        if (!mediaStreamRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          mediaStreamRef.current = stream;

          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const inputCtx = new Ctx();
          inputCtxRef.current = inputCtx;

          const source = inputCtx.createMediaStreamSource(stream);
          micSourceRef.current = source;

          const analyser = inputCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.75;
          inputAnalyserRef.current = analyser;

          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          // Mute sink so mic does not echo locally
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;

          source.connect(analyser);
          analyser.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);

          processor.onaudioprocess = (event) => {
            if (!isStreamingMicToWsRef.current) return;
            const channel = event.inputBuffer.getChannelData(0);

            // Instant local barge-in detection while JARVIS is speaking
            const rms = computeRmsEnergy(channel);
            if (assistantStateRef.current === 'hablando') {
              if (rms > 0.045) {
                bargeInFramesRef.current += 1;
                if (bargeInFramesRef.current >= 2) {
                  bargeInFramesRef.current = 0;
                  stopOutputAudio();
                  setSyncedState('escuchando');
                }
              } else {
                bargeInFramesRef.current = 0;
              }
            }

            if (
              wsRef.current &&
              wsRef.current.readyState === WebSocket.OPEN &&
              wsReadyRef.current
            ) {
              const resampled = downsampleTo16k(channel, inputCtx.sampleRate);
              const bytes = float32ToInt16Bytes(resampled);
              const base64 = uint8ToBase64(bytes);
              wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64 }));
            }
          };
        }

        if (!wsRef.current || wsRef.current.readyState > WebSocket.OPEN) {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
          wsRef.current = ws;
          wsReadyRef.current = false;

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Tiempo de espera agotado al conectar voz en vivo.'));
            }, 8000);

            ws.onopen = () => {
              const relevant = selectRelevantMemories(
                liveUserTurnBufRef.current || 'identidad preferencias proyectos',
                memoriesRef.current,
                14,
              );
              liveUsedMemoryIdsRef.current = relevant.map((m) => m.id);
              ws.send(
                JSON.stringify({
                  type: 'init',
                  memories: formatMemoriesForPrompt(relevant),
                }),
              );
            };

            ws.onmessage = (event) => {
              const msg = JSON.parse(event.data as string) as {
                type: string;
                text?: string;
                data?: string;
                message?: string;
              };

              if (msg.type === 'ready') {
                clearTimeout(timeout);
                wsReadyRef.current = true;
                resolve();
                return;
              }

              if (msg.type === 'inputTranscript' && msg.text) {
                liveUserTurnBufRef.current += msg.text;
                setLiveUserTranscript(liveUserTurnBufRef.current.trim());
                if (assistantStateRef.current === 'inactivo') {
                  setSyncedState('escuchando');
                }
              } else if (msg.type === 'outputTranscript' && msg.text) {
                liveAssistantTurnBufRef.current += msg.text;
                setLiveAssistantTranscript(liveAssistantTurnBufRef.current.trim());
              } else if (msg.type === 'audio' && msg.data) {
                if (assistantStateRef.current !== 'hablando') {
                  setSyncedState('hablando');
                }
                const bytes = base64ToUint8(msg.data);
                schedulePcm24kChunk(bytes);
              } else if (msg.type === 'interrupted') {
                stopOutputAudio();
                if (isStreamingMicToWsRef.current) {
                  setSyncedState('escuchando');
                }
              } else if (msg.type === 'turnComplete') {
                const uText = liveUserTurnBufRef.current.trim();
                const aText = liveAssistantTurnBufRef.current.trim();
                liveUserTurnBufRef.current = '';
                liveAssistantTurnBufRef.current = '';

                if (uText || aText) {
                  void onCommitTurnRef.current(
                    uText || '[Audio de voz]',
                    aText || '[Respuesta por audio]',
                    'voz',
                    liveUsedMemoryIdsRef.current,
                  );
                }

                // Wait for remaining buffered playback before returning to listening/idle
                const checkDrain = () => {
                  if (activeSourcesRef.current.size === 0) {
                    if (isStreamingMicToWsRef.current) {
                      setSyncedState('escuchando');
                    } else {
                      setSyncedState('inactivo');
                    }
                  } else {
                    setTimeout(checkDrain, 100);
                  }
                };
                setTimeout(checkDrain, 120);
              } else if (msg.type === 'error') {
                clearTimeout(timeout);
                setError({
                  code: 'ws',
                  message: msg.message || 'Error en la sesión de voz en vivo.',
                });
                teardownLiveVoice();
                setSyncedState('inactivo');
                reject(new Error(msg.message));
              }
            };

            ws.onerror = () => {
              clearTimeout(timeout);
              setError({
                code: 'ws',
                message: 'No se pudo establecer la conexión de voz en tiempo real.',
              });
              teardownLiveVoice();
              setSyncedState('inactivo');
              reject(new Error('WS error'));
            };

            ws.onclose = () => {
              wsReadyRef.current = false;
              if (isStreamingMicToWsRef.current) {
                teardownLiveVoice();
                setSyncedState('inactivo');
              }
            };
          });
        }

        ensureOutputAudio();
        setIsMicActive(true);
        isStreamingMicToWsRef.current = streamImmediately;
        if (streamImmediately) {
          setSyncedState('escuchando');
        }
        return true;
      } catch (err) {
        const name = (err as Error)?.name ?? '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError({
            code: 'mic-denied',
            message:
              'Permiso de micrófono denegado. Habilítalo en tu navegador o escribe abajo.',
          });
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError({
            code: 'mic-missing',
            message: 'No se encontró ningún micrófono conectado en este dispositivo.',
          });
        } else if (err instanceof Error && err.message) {
          setError({ code: 'ws', message: err.message });
        }
        teardownLiveVoice();
        setSyncedState('inactivo');
        return false;
      }
    },
    [
      ensureOutputAudio,
      schedulePcm24kChunk,
      setSyncedState,
      stopOutputAudio,
      teardownLiveVoice,
    ],
  );

  const toggleHandsFree = useCallback(async () => {
    if (isMicActive) {
      teardownLiveVoice();
      stopOutputAudio();
      setSyncedState('inactivo');
      return;
    }
    setVoiceMode('manos-libres');
    await ensureLiveConnection(true);
  }, [ensureLiveConnection, isMicActive, setSyncedState, stopOutputAudio, teardownLiveVoice]);

  const startPushToTalk = useCallback(async () => {
    setVoiceMode('pulsar');
    stopOutputAudio();
    liveUserTurnBufRef.current = '';
    liveAssistantTurnBufRef.current = '';
    const ok = await ensureLiveConnection(true);
    if (ok) {
      isStreamingMicToWsRef.current = true;
      setSyncedState('escuchando');
    }
  }, [ensureLiveConnection, setSyncedState, stopOutputAudio]);

  const releasePushToTalk = useCallback(() => {
    if (!isStreamingMicToWsRef.current) return;
    isStreamingMicToWsRef.current = false;
    setSyncedState('pensando');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audioStreamEnd' }));
    }
  }, [setSyncedState]);

  const switchVoiceMode = useCallback(
    (nextMode: VoiceMode) => {
      if (nextMode === voiceModeRef.current) return;
      if (isMicActive) {
        teardownLiveVoice();
        stopOutputAudio();
        setSyncedState('inactivo');
      }
      setVoiceMode(nextMode);
    },
    [isMicActive, setSyncedState, stopOutputAudio, teardownLiveVoice],
  );

  const dismissError = useCallback(() => setError(null), []);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      stopOutputAudio();
      teardownLiveVoice();
      if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
        void outputCtxRef.current.close();
      }
    };
  }, [stopOutputAudio, teardownLiveVoice]);

  return {
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
  };
}
