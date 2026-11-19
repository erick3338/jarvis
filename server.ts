import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  type LiveServerMessage,
  Modality,
  ThinkingLevel,
} from '@google/genai';
import { getGeminiClient, mapGeminiError, withGeminiRetry } from './server/gemini';
import {
  buildJarvisSystemInstruction,
  buildMemoryExtractionPrompt,
  MEMORY_EXTRACTION_SCHEMA,
  MEMORY_EXTRACTION_SYSTEM_INSTRUCTION,
  type StoredMemoryInput,
} from './server/prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface ChatTurnInput {
  role: 'user' | 'assistant';
  text: string;
}

interface ChatRequestBody {
  message?: string;
  history?: ChatTurnInput[];
  memories?: string;
}

interface TtsRequestBody {
  text?: string;
}

interface ExtractMemoryBody {
  userMessage?: string;
  assistantMessage?: string;
  existingMemories?: StoredMemoryInput[];
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const key = process.env.GEMINI_API_KEY;
    res.json({
      ok: true,
      hasApiKey: Boolean(key && key !== 'MY_GEMINI_API_KEY'),
    });
  });

  // SSE streaming chat endpoint (gemini-4-hydrogen)
  app.post('/api/chat', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ChatRequestBody;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
      return;
    }

    const history = Array.isArray(body.history) ? body.history.slice(-16) : [];
    const memoriesBlock = typeof body.memories === 'string' ? body.memories : '';

    try {
      const ai = getGeminiClient();
      const contents = [
        ...history
          .filter((h) => typeof h?.text === 'string' && h.text.trim().length > 0)
          .map((h) => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.text }],
          })),
        { role: 'user', parts: [{ text: message }] },
      ];

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let fullText = '';
      try {
        const stream = await ai.models.generateContentStream({
          model: 'gemini-3.1-flash-lite',
          contents,
          config: {
            systemInstruction: buildJarvisSystemInstruction(memoriesBlock),
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          },
        });

        for await (const chunk of stream) {
          const delta = chunk.text ?? '';
          if (delta) {
            fullText += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        }
      } catch (streamErr) {
        console.error('[Chat Stream Error, falling back]', streamErr);
        if (fullText) throw streamErr;
        try {
          const liteUnary = await withGeminiRetry(() =>
            ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents,
              config: {
                systemInstruction: buildJarvisSystemInstruction(memoriesBlock),
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              },
            }),
          );
          fullText = (liteUnary.text ?? '').trim();
        } catch (liteErr) {
          console.error('[Flash-lite unary failed, trying gemini-4-hydrogen]', liteErr);
          const hydrogenFallback = await withGeminiRetry(() =>
            ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents,
              config: {
                systemInstruction: buildJarvisSystemInstruction(memoriesBlock),
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            }),
          );
          fullText = (hydrogenFallback.text ?? '').trim();
        }
        if (fullText) {
          res.write(`data: ${JSON.stringify({ delta: fullText })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
      res.end();
    } catch (err) {
      const mapped = mapGeminiError(err);
      const detail = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.status(mapped.status).json({ error: mapped.message, detail });
      } else {
        res.write(`data: ${JSON.stringify({ error: mapped.message, detail })}\n\n`);
        res.end();
      }
    }
  });

  // Streaming TTS endpoint returning headerless 24kHz 16-bit LE PCM chunks
  app.post('/api/tts', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as TtsRequestBody;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Texto vacío para síntesis de voz.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const attemptStream = async (model: string, withStyle: boolean) => {
        return ai.models.generateContentStream({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                withStyle
                  ? {
                      text,
                      speechMetadata: {
                        style:
                          'Calm, natural Mexican Spanish male voice, conversational and crisp',
                      },
                    }
                  : { text },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Charon' },
              },
            },
          },
        });
      };

      let responseStream;
      try {
        responseStream = await attemptStream('gemini-3.8-flash-lite-tts', true);
      } catch {
        try {
          responseStream = await attemptStream('gemini-3.8-flash-lite-tts', false);
        } catch (err2) {
          const raw = err2 instanceof Error ? err2.message : String(err2);
          if (raw.toLowerCase().includes('not_found') || raw.includes('404')) {
            res.setHeader('X-TTS-Fallback', 'web-speech');
            res.status(204).end();
            return;
          }
          throw err2;
        }
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Audio-Sample-Rate', '24000');
      res.flushHeaders();

      for await (const chunk of responseStream) {
        const data = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (data) {
          res.write(Buffer.from(data, 'base64'));
        }
      }
      res.end();
    } catch (err) {
      const mapped = mapGeminiError(err);
      if (!res.headersSent) {
        res.status(mapped.status).json({ error: mapped.message });
      } else {
        res.end();
      }
    }
  });

  // Dedicated memory extraction endpoint returning strict JSON
  app.post('/api/memory/extract', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ExtractMemoryBody;
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
    const assistantMessage =
      typeof body.assistantMessage === 'string' ? body.assistantMessage.trim() : '';
    const existingMemories = Array.isArray(body.existingMemories)
      ? body.existingMemories
      : [];

    if (!userMessage) {
      res.json({ actions: [] });
      return;
    }

    try {
      const ai = getGeminiClient();
      const runExtract = (model: string, thinkingLevel: ThinkingLevel) =>
        ai.models.generateContent({
          model,
          contents: buildMemoryExtractionPrompt(
            userMessage,
            assistantMessage,
            existingMemories,
          ),
          config: {
            systemInstruction: MEMORY_EXTRACTION_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: MEMORY_EXTRACTION_SCHEMA,
            thinkingConfig: { thinkingLevel },
          },
        });

      let response;
      try {
        response = await withGeminiRetry(() =>
          runExtract('gemini-3.1-flash-lite', ThinkingLevel.LOW),
        );
      } catch {
        response = await withGeminiRetry(() =>
          runExtract('gemini-4-hydrogen', ThinkingLevel.LOW),
        );
      }

      const raw = (response.text ?? '{"actions":[]}').trim();
      const parsed = JSON.parse(raw) as { actions?: unknown[] };
      res.json({
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, actions: [] });
    }
  });

  const server = http.createServer(app);

  // WebSocket bridge for real-time Gemini Live API audio sessions
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null = null;
    let isClosed = false;

    const closeAll = () => {
      if (isClosed) return;
      isClosed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
      liveSession = null;
    };

    clientWs.on('close', closeAll);
    clientWs.on('error', closeAll);

    clientWs.on('message', async (raw) => {
      if (isClosed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          memories?: string;
          audio?: string;
          text?: string;
        };

        if (msg.type === 'init') {
          if (liveSession) {
            try {
              liveSession.close();
            } catch {
              // Ignore
            }
          }

          const ai = getGeminiClient();
          const memoriesBlock = typeof msg.memories === 'string' ? msg.memories : '';

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Charon' },
                },
              },
              systemInstruction: buildJarvisSystemInstruction(memoriesBlock),
            },
            callbacks: {
              onopen: () => {
                if (clientWs.readyState === clientWs.OPEN) {
                  clientWs.send(JSON.stringify({ type: 'ready' }));
                }
              },
              onmessage: (message: LiveServerMessage) => {
                if (clientWs.readyState !== clientWs.OPEN) return;
                const content = message.serverContent;

                if (content?.inputTranscription?.text) {
                  clientWs.send(
                    JSON.stringify({
                      type: 'inputTranscript',
                      text: content.inputTranscription.text,
                    }),
                  );
                }

                if (content?.outputTranscription?.text) {
                  clientWs.send(
                    JSON.stringify({
                      type: 'outputTranscript',
                      text: content.outputTranscription.text,
                    }),
                  );
                }

                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'audio',
                        data: part.inlineData.data,
                      }),
                    );
                  }
                }

                if (content?.interrupted) {
                  clientWs.send(JSON.stringify({ type: 'interrupted' }));
                }

                if (content?.turnComplete) {
                  clientWs.send(JSON.stringify({ type: 'turnComplete' }));
                }
              },
              onerror: (err: unknown) => {
                if (clientWs.readyState === clientWs.OPEN) {
                  const mapped = mapGeminiError(err);
                  clientWs.send(
                    JSON.stringify({ type: 'error', message: mapped.message }),
                  );
                }
              },
              onclose: () => {
                if (clientWs.readyState === clientWs.OPEN) {
                  clientWs.send(JSON.stringify({ type: 'closed' }));
                }
              },
            },
          });
          return;
        }

        if (!liveSession) return;

        if (msg.type === 'audio' && typeof msg.audio === 'string') {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'audioStreamEnd') {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        } else if (msg.type === 'text' && typeof msg.text === 'string') {
          liveSession.sendRealtimeInput({ text: msg.text });
        }
      } catch (err) {
        const mapped = mapGeminiError(err);
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.send(
            JSON.stringify({ type: 'error', message: mapped.message }),
          );
        }
      }
    });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
