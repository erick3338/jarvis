export type AssistantState = 'inactivo' | 'escuchando' | 'pensando' | 'hablando';

export type VoiceMode = 'manos-libres' | 'pulsar';

export type MemoryCategory =
  | 'identidad'
  | 'preferencias'
  | 'proyectos'
  | 'rutinas'
  | 'personas'
  | 'otros';

export interface MemoryItem {
  id: string;
  text: string;
  category: MemoryCategory;
  createdAt: string;
  lastUsedAt: string;
  updatedAt?: string;
}

export interface MemoryAction {
  action: 'create' | 'update' | 'delete';
  targetId?: string;
  text: string;
  category: MemoryCategory;
}

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  source: 'voz' | 'texto';
}

export interface AppError {
  code: 'mic-denied' | 'mic-missing' | 'offline' | 'api' | 'ws';
  message: string;
}
