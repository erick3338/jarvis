/**
 * Pure PCM audio conversion and energy measurement helpers for 16kHz input
 * and 24kHz Gemini output streams.
 */

export function downsampleTo16k(
  samples: Float32Array,
  inputSampleRate: number,
): Float32Array {
  if (inputSampleRate === 16000) return samples;
  if (inputSampleRate < 16000) return samples;

  const ratio = inputSampleRate / 16000;
  const outputLength = Math.floor(samples.length / ratio);
  const result = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j];
      count++;
    }
    result[i] = count > 0 ? sum / count : samples[start] ?? 0;
  }

  return result;
}

export function float32ToInt16Bytes(float32: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, Math.round(int16), true);
  }
  return new Uint8Array(buffer);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const evenLength = bytes.byteLength - (bytes.byteLength % 2);
  const sampleCount = evenLength / 2;
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, evenLength);

  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

export function computeRmsEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples.length);
}
