/**
 * Tipi, ki jih hranimo tudi ko je Gemini izklopljen.
 * Odvisnost @google/genai je odstranjena: vgrajeni model se ne zaganja.
 */

export interface AgentMessage {
  callId: string;
  remoteNumber: string;
  callerName?: string;
  reason?: string;
  callbackNumber?: string;
  urgency?: "low" | "normal" | "high";
  takenAt: string;
}

export interface TranscriptLine {
  role: "caller" | "agent";
  text: string;
  at: string;
}

/** Pretokovni linearni vzorčevalnik za mono s16le PCM. */
export class Resampler {
  private position = 0;
  private last = 0;

  constructor(private readonly from: number, private readonly to: number) {}

  process(input: Buffer): Buffer {
    const samples = new Int16Array(input.buffer, input.byteOffset, Math.floor(input.length / 2));
    const step = this.from / this.to;
    const out: number[] = [];
    while (this.position < samples.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const a = index === 0 ? this.last : samples[index - 1]!;
      const b = samples[index]!;
      out.push(Math.round(a + (b - a) * frac));
      this.position += step;
    }
    this.position -= samples.length;
    if (samples.length) this.last = samples[samples.length - 1]!;
    return Buffer.from(Int16Array.from(out).buffer);
  }
}
