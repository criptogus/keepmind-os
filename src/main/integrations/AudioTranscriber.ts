import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WHISPER_BINARIES = ['whisper-cli', 'whisper-cpp', 'main'];
const FFMPEG_CANDIDATES = ['ffmpeg', path.join(process.env.HOME || '', '.local/bin/ffmpeg')];

/**
 * Transcribes WhatsApp voice messages locally with whisper.cpp (model in
 * <userData>/whisper-models) and falls back to the OpenAI Whisper API when
 * an API key is configured. Returns null when neither is available.
 */
export class AudioTranscriber {
  private modelsDir: string;
  private openAiKey?: () => string | null;

  constructor(modelsDir: string, openAiKey?: () => string | null) {
    this.modelsDir = modelsDir;
    this.openAiKey = openAiKey;
  }

  private findBinary(names: string[]): string | null {
    for (const name of names) {
      if (name.includes('/') ? existsSync(name) : this.which(name)) return name;
    }
    return null;
  }

  private which(bin: string): boolean {
    const dirs = (process.env.PATH || '').split(path.delimiter);
    return dirs.some((d) => existsSync(path.join(d, bin)));
  }

  private findModel(): string | null {
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      const files = readdirSync(this.modelsDir).filter((f) => /^ggml-.*\.bin$/i.test(f));
      // Prefer base/small/medium over tiny for PT-BR accuracy.
      const rank = (f: string) => (/tiny/i.test(f) ? 0 : /base/i.test(f) ? 2 : /small/i.test(f) ? 3 : /medium/i.test(f) ? 4 : 1);
      files.sort((a, b) => rank(b) - rank(a));
      return files[0] ? path.join(this.modelsDir, files[0]) : null;
    } catch {
      return null;
    }
  }

  /** True when local whisper.cpp transcription can run on this machine. */
  isAvailable(): boolean {
    return !!(this.findBinary(WHISPER_BINARIES) && this.findModel() && this.findBinary(FFMPEG_CANDIDATES));
  }

  async transcribe(audio: Buffer, mimetype = 'audio/ogg'): Promise<string | null> {
    const local = await this.whisperCpp(audio, mimetype).catch(() => null);
    if (local) return local;
    return this.openAiWhisper(audio, mimetype).catch(() => null);
  }

  private async whisperCpp(audio: Buffer, mimetype: string): Promise<string | null> {
    const bin = this.findBinary(WHISPER_BINARIES);
    const model = this.findModel();
    const ffmpeg = this.findBinary(FFMPEG_CANDIDATES);
    if (!bin || !model || !ffmpeg) return null;

    const dir = await mkdtemp(path.join(tmpdir(), 'km-audio-'));
    try {
      const ext = mimetype.includes('mpeg') || mimetype.includes('mp3') ? 'mp3'
        : mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a'
        : mimetype.includes('wav') ? 'wav' : 'ogg';
      const input = path.join(dir, `in.${ext}`);
      const wav = path.join(dir, 'in.wav');
      await writeFile(input, audio);
      await execFileAsync(ffmpeg, ['-y', '-i', input, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], { timeout: 60_000 });
      const { stdout } = await execFileAsync(bin, [
        '-m', model, '-f', wav, '-l', 'pt', '-nt', '-np',
      ], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
      const text = stdout
        .split('\n')
        .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      return text || null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async openAiWhisper(audio: Buffer, mimetype: string): Promise<string | null> {
    const key = this.openAiKey?.();
    if (!key) return null;
    const ext = mimetype.includes('mpeg') ? 'mp3' : mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a' : mimetype.includes('wav') ? 'wav' : 'ogg';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimetype }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: string };
    return body.text?.trim() || null;
  }
}
