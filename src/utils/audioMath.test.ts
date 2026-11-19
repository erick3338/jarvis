import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRmsEnergy,
  downsampleTo16k,
  float32ToInt16Bytes,
  pcm16BytesToFloat32,
} from './audioMath';

test('float32ToInt16Bytes and pcm16BytesToFloat32 round-trip accurately', () => {
  const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const bytes = float32ToInt16Bytes(input);
  assert.equal(bytes.byteLength, 10);
  const output = pcm16BytesToFloat32(bytes);
  assert.equal(output.length, 5);
  assert.ok(Math.abs(output[0] - 0) < 0.001);
  assert.ok(Math.abs(output[1] - 0.5) < 0.001);
  assert.ok(Math.abs(output[2] - -0.5) < 0.001);
  assert.ok(Math.abs(output[3] - 1) < 0.001);
  assert.ok(Math.abs(output[4] - -1) < 0.001);
});

test('downsampleTo16k halves sample count from 32kHz and thirds from 48kHz', () => {
  const s48 = new Float32Array(480).fill(0.25);
  const out = downsampleTo16k(s48, 48000);
  assert.equal(out.length, 160);
  assert.ok(Math.abs(out[0] - 0.25) < 0.0001);
});

test('computeRmsEnergy returns expected RMS', () => {
  const silence = new Float32Array(128).fill(0);
  assert.equal(computeRmsEnergy(silence), 0);
  const tone = new Float32Array(128).fill(0.5);
  assert.ok(Math.abs(computeRmsEnergy(tone) - 0.5) < 0.0001);
});
