/**
 * Incrementally buffers streaming text tokens and emits speakable fragments
 * on natural Spanish punctuation boundaries so TTS starts on the first phrase.
 */
export class StreamSentenceSplitter {
  private buffer = '';
  private hasEmittedFirst = false;

  push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    const emitted: string[] = [];

    while (true) {
      const boundary = this.findBoundary(this.buffer, this.hasEmittedFirst);
      if (boundary === -1) break;

      const chunk = this.buffer.slice(0, boundary + 1).trim();
      this.buffer = this.buffer.slice(boundary + 1);
      if (chunk) {
        emitted.push(chunk);
        this.hasEmittedFirst = true;
      }
    }

    return emitted;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }

  reset(): void {
    this.buffer = '';
    this.hasEmittedFirst = false;
  }

  private findBoundary(text: string, hasEmittedFirst: boolean): number {
    // Strong sentence endings (. ? ! \n) once we have at least a short phrase
    const minSentenceLen = hasEmittedFirst ? 18 : 10;
    for (let i = minSentenceLen; i < text.length; i++) {
      const ch = text[i];
      if (ch === '.' || ch === '?' || ch === '!' || ch === '\n') {
        // Avoid splitting inside numbers like 3.14 or abbreviations if next char is digit
        const next = text[i + 1];
        if (ch === '.' && next && /\d/.test(next)) {
          continue;
        }
        return i;
      }
    }

    // For very first utterance, also allow splitting on comma/colon/semicolon after 42 chars
    // so voice starts speaking immediately with low perceived latency.
    const clauseThreshold = hasEmittedFirst ? 95 : 42;
    if (text.length >= clauseThreshold) {
      for (let i = clauseThreshold - 10; i < text.length; i++) {
        const ch = text[i];
        if (ch === ',' || ch === ';' || ch === ':') {
          return i;
        }
      }
    }

    return -1;
  }
}
