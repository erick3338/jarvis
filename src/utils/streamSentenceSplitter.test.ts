import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamSentenceSplitter } from './streamSentenceSplitter';

test('StreamSentenceSplitter emits early on first sentence boundary', () => {
  const splitter = new StreamSentenceSplitter();
  assert.deepEqual(splitter.push('Hola, '), []);
  const first = splitter.push('todo en orden.');
  assert.deepEqual(first, ['Hola, todo en orden.']);
  const second = splitter.push(' ¿En qué trabajamos hoy?');
  assert.deepEqual(second, ['¿En qué trabajamos hoy?']);
  assert.deepEqual(splitter.flush(), []);
});

test('StreamSentenceSplitter avoids splitting decimals and flushes remainder', () => {
  const splitter = new StreamSentenceSplitter();
  assert.deepEqual(splitter.push('La presión está en 9.5 bares'), []);
  assert.deepEqual(splitter.flush(), ['La presión está en 9.5 bares']);
});

test('StreamSentenceSplitter emits long first clause on comma for low latency', () => {
  const splitter = new StreamSentenceSplitter();
  const out = splitter.push('Revisé tus notas sobre la cafetera manual de acero, y ya tengo un par de ideas');
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith(','));
  assert.deepEqual(splitter.flush(), ['y ya tengo un par de ideas']);
});
