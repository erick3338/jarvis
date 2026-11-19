import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiConfigError(
      'Falta configurar GEMINI_API_KEY en el entorno del servidor.',
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiConfigError';
  }
}

export function mapGeminiError(err: unknown): { status: number; message: string } {
  if (err instanceof GeminiConfigError) {
    return { status: 503, message: err.message };
  }

  console.error('[Gemini API error]', err);
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403')) {
    return {
      status: 403,
      message: 'La clave de API de Gemini no es válida o no tiene permisos. Revisa Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      message: 'Se alcanzó el límite temporal de solicitudes de Gemini. Intenta de nuevo en unos segundos.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      message: 'El modelo de Gemini solicitado no está disponible en este momento.',
    };
  }
  return {
    status: 500,
    message: 'No pude comunicarme con Gemini en este momento. Intenta de nuevo.',
  };
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const mapped = mapGeminiError(err);
      // Do not retry auth/not-found/bad-request config errors
      if (mapped.status === 403 || mapped.status === 404 || err instanceof GeminiConfigError) {
        throw err;
      }
      if (i < attempts - 1) {
        const delayMs = 350 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}
