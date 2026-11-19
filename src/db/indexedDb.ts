import type { ChatMessage, ConversationSession, MemoryItem } from '../types/jarvis';

const DB_NAME = 'jarvis-persistent-db';
const DB_VERSION = 1;

const STORE_MEMORIES = 'memories';
const STORE_CONVERSATIONS = 'conversations';
const STORE_MESSAGES = 'messages';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_MEMORIES)) {
        const memStore = db.createObjectStore(STORE_MEMORIES, { keyPath: 'id' });
        memStore.createIndex('category', 'category', { unique: false });
        memStore.createIndex('createdAt', 'createdAt', { unique: false });
        memStore.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        const convStore = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
        convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
        msgStore.createIndex('conversationId', 'conversationId', { unique: false });
        msgStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Error al abrir IndexedDB'));
  });
}

function txPromise<T>(tx: IDBTransaction, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMemories(): Promise<MemoryItem[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readonly');
  const store = tx.objectStore(STORE_MEMORIES);
  const items = await txPromise<MemoryItem[]>(tx, store.getAll());
  db.close();
  return items.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export async function replaceAllMemories(items: MemoryItem[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readwrite');
  const store = tx.objectStore(STORE_MEMORIES);
  store.clear();
  for (const item of items) {
    store.put(item);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function putMemory(item: MemoryItem): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readwrite');
  await txPromise(tx, tx.objectStore(STORE_MEMORIES).put(item));
  db.close();
}

export async function deleteMemoryById(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readwrite');
  await txPromise(tx, tx.objectStore(STORE_MEMORIES).delete(id));
  db.close();
}

export async function clearAllMemories(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readwrite');
  await txPromise(tx, tx.objectStore(STORE_MEMORIES).clear());
  db.close();
}

export async function touchMemoriesLastUsed(ids: string[], nowIso: string): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE_MEMORIES, 'readwrite');
  const store = tx.objectStore(STORE_MEMORIES);
  for (const id of ids) {
    const req = store.get(id);
    req.onsuccess = () => {
      const existing = req.result as MemoryItem | undefined;
      if (existing) {
        store.put({ ...existing, lastUsedAt: nowIso });
      }
    };
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getAllConversations(): Promise<ConversationSession[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_CONVERSATIONS, 'readonly');
  const items = await txPromise<ConversationSession[]>(
    tx,
    tx.objectStore(STORE_CONVERSATIONS).getAll(),
  );
  db.close();
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function putConversation(session: ConversationSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
  await txPromise(tx, tx.objectStore(STORE_CONVERSATIONS).put(session));
  db.close();
}

export async function deleteConversationById(conversationId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_CONVERSATIONS, STORE_MESSAGES], 'readwrite');
  tx.objectStore(STORE_CONVERSATIONS).delete(conversationId);
  const msgStore = tx.objectStore(STORE_MESSAGES);
  const index = msgStore.index('conversationId');
  const req = index.getAllKeys(conversationId);
  req.onsuccess = () => {
    for (const key of req.result) {
      msgStore.delete(key);
    }
  };
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getMessagesByConversation(
  conversationId: string,
): Promise<ChatMessage[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_MESSAGES, 'readonly');
  const index = tx.objectStore(STORE_MESSAGES).index('conversationId');
  const items = await txPromise<ChatMessage[]>(tx, index.getAll(conversationId));
  db.close();
  return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function putMessage(message: ChatMessage): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_MESSAGES, 'readwrite');
  await txPromise(tx, tx.objectStore(STORE_MESSAGES).put(message));
  db.close();
}
