import type { MemoryAction, MemoryCategory, MemoryItem } from '../types/jarvis';

const SPANISH_STOPWORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por',
  'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero',
  'sus', 'le', 'ya', 'o', 'este', 'sí', 'porque', 'esta', 'entre', 'cuando',
  'muy', 'sin', 'sobre', 'también', 'me', 'hasta', 'hay', 'donde', 'quien',
  'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra',
  'otros', 'ese', 'eso', 'ante', 'ellos', 'e', 'esto', 'mí', 'antes', 'algunos',
  'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto', 'esa', 'estos',
  'mucho', 'quienes', 'nada', 'muchos', 'cual', 'poco', 'ella', 'estar', 'estas',
  'algunas', 'algo', 'nosotros', 'mi', 'mis', 'tú', 'te', 'ti', 'tu', 'tus',
  'ellas', 'nosotras', 'vosotros', 'vosotras', 'os', 'mío', 'mía', 'míos',
  'mías', 'tuyo', 'tuya', 'tuyos', 'tuyas', 'suyo', 'suya', 'suyos', 'suyas',
  'nuestro', 'nuestra', 'nuestros', 'nuestras', 'es', 'son', 'fue', 'ser',
  'hola', 'jarvis', 'oye', 'dime', 'puedes', 'quiero', 'favor',
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length > 2 && !SPANISH_STOPWORDS.has(token));
}

/**
 * Selects the most relevant memories for a query without bloating context.
 * Identity memories and directly matching tokens receive highest priority,
 * followed by recently used memories.
 */
export function selectRelevantMemories(
  query: string,
  memories: MemoryItem[],
  limit = 12,
): MemoryItem[] {
  if (memories.length === 0) return [];

  const queryTokens = new Set(tokenize(query));
  const now = Date.now();

  const scored = memories.map((mem) => {
    const memTokens = tokenize(mem.text);
    let overlap = 0;
    for (const token of memTokens) {
      if (queryTokens.has(token)) {
        overlap += 3;
      } else {
        for (const q of queryTokens) {
          if (q.length >= 4 && (token.includes(q) || q.includes(token))) {
            overlap += 1.5;
          }
        }
      }
    }

    const identityBoost = mem.category === 'identidad' ? 2.5 : 0;
    const preferenceBoost = mem.category === 'preferencias' ? 0.5 : 0;
    const ageHours = Math.max(0, (now - Date.parse(mem.lastUsedAt || mem.createdAt)) / 3_600_000);
    const recencyBoost = 1 / (1 + ageHours / 48);

    return {
      mem,
      score: overlap + identityBoost + preferenceBoost + recencyBoost,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.mem);
}

export function formatMemoriesForPrompt(memories: MemoryItem[]): string {
  if (memories.length === 0) return '';
  return memories
    .map((m) => `- [${m.category}] ${m.text}`)
    .join('\n');
}

export function filterMemories(
  memories: MemoryItem[],
  search: string,
  category: MemoryCategory | 'todas',
): MemoryItem[] {
  const normalizedQuery = normalizeText(search);
  return memories.filter((mem) => {
    if (category !== 'todas' && mem.category !== category) return false;
    if (!normalizedQuery) return true;
    return normalizeText(mem.text).includes(normalizedQuery);
  });
}

function generateMemoryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Applies memory extraction actions (create, update, delete) deterministically
 * while preventing duplicate entries and preserving creation timestamps on updates.
 */
export function applyMemoryActions(
  existing: MemoryItem[],
  actions: MemoryAction[],
  nowIso: string = new Date().toISOString(),
): {
  next: MemoryItem[];
  changed: boolean;
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
} {
  let list = existing.map((item) => ({ ...item }));
  let changed = false;
  let addedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  for (const act of actions) {
    const cleanText = (act.text ?? '').trim();

    if (act.action === 'delete') {
      const beforeLen = list.length;
      if (act.targetId) {
        list = list.filter((item) => item.id !== act.targetId);
      } else if (cleanText) {
        const targetNorm = normalizeText(cleanText);
        list = list.filter((item) => !normalizeText(item.text).includes(targetNorm));
      }
      if (list.length !== beforeLen) {
        changed = true;
        deletedCount += beforeLen - list.length;
      }
      continue;
    }

    if (!cleanText) continue;

    if (act.action === 'update' && act.targetId) {
      const idx = list.findIndex((item) => item.id === act.targetId);
      if (idx !== -1) {
        list[idx] = {
          ...list[idx],
          text: cleanText,
          category: act.category || list[idx].category,
          updatedAt: nowIso,
          lastUsedAt: nowIso,
        };
        changed = true;
        updatedCount += 1;
        continue;
      }
    }

    // Check near-exact normalized duplicate before creating
    const normNew = normalizeText(cleanText);
    const duplicateIdx = list.findIndex((item) => normalizeText(item.text) === normNew);
    if (duplicateIdx !== -1) {
      list[duplicateIdx] = {
        ...list[duplicateIdx],
        lastUsedAt: nowIso,
      };
      continue;
    }

    list.unshift({
      id: generateMemoryId(),
      text: cleanText,
      category: act.category || 'otros',
      createdAt: nowIso,
      lastUsedAt: nowIso,
      updatedAt: nowIso,
    });
    changed = true;
    addedCount += 1;
  }

  return { next: list, changed, addedCount, updatedCount, deletedCount };
}
