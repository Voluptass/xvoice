import { synthesize } from '../tts/index.js';
import { getSettings } from '../core/settings.js';

/**
 * 音色试听。
 *
 * 独立于主播放器：试听只是一小段样本，不该覆盖用户正在听的台词列表。
 * 用一个共享的 audio 元素，保证任何时刻只响一个样本。
 */

const SAMPLE = '这是一段试听文本，用来确认音色和语速是否合适。';

let audio = null;
let token = 0;
let pending = null;

function ensureAudio() {
    if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
    }
    return audio;
}

function settle(ok) {
    const p = pending;
    pending = null;
    if (!p) return;
    try { URL.revokeObjectURL(p.url); } catch { /* 忽略 */ }
    p.resolve(ok);
}

/** 停掉正在进行的试听，并让还在合成中的请求作废。 */
export function stopPreview() {
    token += 1;
    if (audio) {
        audio.pause();
        audio.removeAttribute('src');
    }
    settle(false);
}

/**
 * 用指定音色试听一句，会打断上一次试听。
 * @param {object|undefined} override 供应商相关的音色覆盖，如 { voiceId } 或 { voice }
 * @param {{text?: string, onStart?: () => void}} [options]
 * @returns {Promise<boolean>} 是否完整播完（被打断返回 false）
 */
export async function previewVoice(override, { text = SAMPLE, onStart } = {}) {
    stopPreview();
    const mine = token;
    const blob = await synthesize(text, undefined, override);
    if (mine !== token) return false;

    const el = ensureAudio();
    el.volume = Math.min(1, Math.max(0, Number(getSettings().playback.volume) || 0));
    const url = URL.createObjectURL(blob);
    el.src = url;
    const done = new Promise((resolve) => { pending = { resolve, url }; });
    el.onended = () => settle(true);
    el.onerror = () => settle(false);
    onStart?.();
    el.play().catch(() => settle(false));
    return done;
}
