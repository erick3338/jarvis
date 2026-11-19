import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMemoryActions,
  filterMemories,
  formatMemoriesForPrompt,
  selectRelevantMemories,
} from './memoryLogic';
import type { MemoryItem } from '../types/jarvis';

const sampleMemories: MemoryItem[] = [
  {
    id: 'm1',
    text: 'Se llama Erick y vive en Oaxaca.',
    category: 'identidad',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastUsedAt: '2026-11-10T10:00:00.000Z',
  },
  {
    id: 'm2',
    text: 'Prefiere el café espresso sin azúcar por las mañanas.',
    category: 'preferencias',
    createdAt: '2026-11-02T10:00:00.000Z',
    lastUsedAt: '2026-11-11T10:00:00.000Z',
  },
  {
    id: 'm3',
    text: 'Está construyendo una cafetera espresso manual de acero inoxidable.',
    category: 'proyectos',
    createdAt: '2026-11-03T10:00:00.000Z',
    lastUsedAt: '2026-11-12T10:00:00.000Z',
  },
];

test('selectRelevantMemories prioritizes token matches and identity', () => {
  const selected = selectRelevantMemories('Cómo va mi cafetera de acero', sampleMemories, 2);
  assert.equal(selected[0].id, 'm3');
  assert.equal(selected.length, 2);
});

test('applyMemoryActions creates, updates contradicting memory, and deletes', () => {
  const now = '2026-11-17T12:00:00.000Z';
  const res = applyMemoryActions(
    sampleMemories,
    [
      {
        action: 'update',
        targetId: 'm2',
        text: 'Ahora prefiere té verde matcha por las mañanas.',
        category: 'preferencias',
      },
      {
        action: 'create',
        text: 'Su perro se llama Milo.',
        category: 'personas',
      },
      {
        action: 'delete',
        targetId: 'm3',
        text: '',
        category: 'proyectos',
      },
    ],
    now,
  );

  assert.equal(res.changed, true);
  assert.equal(res.addedCount, 1);
  assert.equal(res.updatedCount, 1);
  assert.equal(res.deletedCount, 1);
  assert.equal(res.next.length, 3);
  assert.equal(res.next.find((m) => m.id === 'm2')?.text, 'Ahora prefiere té verde matcha por las mañanas.');
  assert.equal(res.next.find((m) => m.id === 'm2')?.createdAt, '2026-11-02T10:00:00.000Z');
  assert.equal(res.next.find((m) => m.id === 'm3'), undefined);
});

test('applyMemoryActions prevents duplicate normalized facts', () => {
  const res = applyMemoryActions(sampleMemories, [
    {
      action: 'create',
      text: 'Se llama Erick y vive en Oaxaca',
      category: 'identidad',
    },
  ]);
  assert.equal(res.addedCount, 0);
  assert.equal(res.next.length, 3);
});

test('filterMemories filters by search and category', () => {
  const filtered = filterMemories(sampleMemories, 'espresso', 'proyectos');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'm3');
});

test('formatMemoriesForPrompt produces clean bullet list', () => {
  const prompt = formatMemoriesForPrompt([sampleMemories[0]]);
  assert.equal(prompt, '- [identidad] Se llama Erick y vive en Oaxaca.');
});
