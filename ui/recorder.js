import { mixToMono, resample, encodeWav } from '../core/audio.js';

/**
 * 录音（锦上添花）。
 *
 * 只在安全上下文（https / localhost）且浏览器支持 getUserMedia 时可用；
 * 用 http://局域网IP 打开酒馆时浏览器会禁用麦克风，这时隐藏录音入口即可，
 * 改用「选择音频文件」。
 *
 * 录完浏览器给的格式五花八门（webm/opus、ogg/opus、mp4/aac），而 MiniMax
 * 只收 mp3/m4a/wav，所以统一解码成 PCM、重采样到 16kHz、编成 wav。
 */

const TARGET_RATE = 16000;

export const RECORD_MIN_MS = 10_000;
export const RECORD_MAX_MS = 5 * 60_000;

/** 当前环境能不能录音。 */
export function canRecord() {
    return typeof window !== 'undefined'
        && !!navigator.mediaDevices?.getUserMedia
        && typeof window.MediaRecorder === 'function';
}

function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return candidates.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || '';
}

/** 把浏览器录出来的音频 Blob 转成 16kHz 单声道 wav。 */
async function toWav(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        const mono = resample(mixToMono(channels), buffer.sampleRate, TARGET_RATE);
        return new Blob([encodeWav(mono, TARGET_RATE)], { type: 'audio/wav' });
    } finally {
        ctx.close?.();
    }
}

export class Recorder {
    #stream = null;
    #recorder = null;
    #chunks = [];
    #startedAt = 0;
    #mimeType = '';

    get recording() {
        return !!this.#recorder;
    }

    get elapsed() {
        return this.#startedAt ? Date.now() - this.#startedAt : 0;
    }

    async start() {
        if (this.#recorder) return;
        this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.#mimeType = pickMimeType();
        this.#recorder = new MediaRecorder(this.#stream, this.#mimeType ? { mimeType: this.#mimeType } : undefined);
        this.#chunks = [];
        this.#recorder.ondataavailable = (e) => { if (e.data?.size) this.#chunks.push(e.data); };
        this.#recorder.start();
        this.#startedAt = Date.now();
    }

    /** 停止并返回 wav Blob。 */
    async stop() {
        const rec = this.#recorder;
        if (!rec) return null;
        await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
        this.#release();
        const raw = new Blob(this.#chunks, { type: this.#mimeType || 'audio/webm' });
        this.#chunks = [];
        return toWav(raw);
    }

    /** 放弃录音。 */
    cancel() {
        try {
            if (this.#recorder && this.#recorder.state !== 'inactive') this.#recorder.stop();
        } catch { /* 忽略 */ }
        this.#release();
        this.#chunks = [];
    }

    #release() {
        this.#recorder = null;
        this.#startedAt = 0;
        this.#stream?.getTracks().forEach((t) => t.stop());
        this.#stream = null;
    }
}
