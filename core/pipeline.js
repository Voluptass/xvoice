import { applyAll, applyWithTrace } from '../regex/apply.js';
import { clean, split } from './text.js';
import { synthesize } from '../tts/index.js';
import { Player } from '../player/player.js';
import { getSettings } from './settings.js';

const MAX_INFLIGHT = 2;

/** 限制同时在途的合成请求，防止快速跳段时堆出一串并发请求。 */
function createLimiter(max) {
    let active = 0;
    const waiting = [];
    const run = async (fn, resolve, reject) => {
        active += 1;
        try {
            resolve(await fn());
        } catch (e) {
            reject(e);
        } finally {
            active -= 1;
            const next = waiting.shift();
            if (next) run(...next);
        }
    };
    return (fn) => new Promise((resolve, reject) => {
        if (active < max) run(fn, resolve, reject);
        else waiting.push([fn, resolve, reject]);
    });
}

const limit = createLimiter(MAX_INFLIGHT);
const listeners = new Set();

function emit(event, payload) {
    listeners.forEach((fn) => {
        try { fn(event, payload); } catch (e) { console.warn('[xvoice] 监听器出错:', e); }
    });
}

export function onPipelineEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export const player = new Player((snapshot) => {
    emit('player', snapshot);
    if (snapshot.error) emit('error', snapshot.error);
});

/**
 * 走完文本处理的全部步骤，不做合成。
 * 朗读和正则调试面板共用它，保证「预览看到的」就是「实际念的」。
 * @returns {{chunks: string[], cleaned: string, afterRegex: string, errors: Array}}
 */
export function prepare(rawText, options = {}) {
    const settings = getSettings();
    const { text: afterRegex, errors } = applyAll(rawText, settings.regex.entries);
    const cleaned = clean(afterRegex, { ...settings.playback, ...options });
    return { chunks: split(cleaned, settings.playback.chunkSize), cleaned, afterRegex, errors };
}

/** 逐条展示正则的中间结果，供调试面板定位是哪条规则吃掉了文本。 */
export function trace(rawText) {
    const settings = getSettings();
    const { text, steps } = applyWithTrace(rawText, settings.regex.entries);
    return { steps, cleaned: clean(text) };
}

/** 处理后没内容时，把原因说准——用户最容易被笼统的「文本为空」带偏。 */
export function emptyReason() {
    if (getSettings().playback.quotedOnly) {
        return '这条消息里没有引号内的对白。想连旁白一起念的话，'
            + '去朗读设置关掉「只朗读引号内的对白」。';
    }
    return '文本经正则和清洗后为空，请检查正则规则是否删过头了。';
}

/**
 * 朗读一段文本。
 * @param {string} rawText 未经处理的原文
 * @param {object} [options] 透传给 clean()
 */
export function speak(rawText, options = {}) {
    const { chunks, errors } = prepare(rawText, options);
    if (errors.length) emit('regexError', errors);
    if (!chunks.length) {
        emit('error', new Error(emptyReason()));
        return;
    }
    player.setVolume(getSettings().playback.volume);
    // 普通朗读不区分角色，speaker 置空；只有导演台本才带真实说话人
    player.load(chunks.map((text) => ({ text, speaker: '' })), (chunk) =>
        limit(() => synthesize(chunk.text)));
    player.play(0);
}

/**
 * 按番剧台本朗读：每个分段带说话人，合成时用该角色对应的音色。
 * @param {Array<{text: string, speaker: string}>} lines
 */
export function speakScript(lines) {
    const chunks = lines
        .map(({ text, speaker }) => ({ text: String(text || '').trim(), speaker }))
        .filter((c) => c.text);
    if (!chunks.length) {
        emit('error', new Error('台本里没有可朗读的内容。'));
        return;
    }
    player.setVolume(getSettings().playback.volume);
    player.load(chunks, (chunk) =>
        limit(() => synthesize(chunk.text, undefined, voiceFor(chunk.speaker))));
    player.play(0);
}

/** 按角色查它的音色覆盖。查不到就留给当前供应商默认音色。 */
export function voiceFor(speaker) {
    const { director } = getSettings();
    const override = director?.roleVoices?.[speaker];
    if (!override) return undefined;
    const { tts } = getSettings();
    return tts.provider === 'minimax' ? { voiceId: override } : { voice: override };
}

export function stop() {
    player.stop();
}
