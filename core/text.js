/**
 * 朗读前的文本处理：清洗 + 分片。
 *
 * 用户正则负责剥掉「这条消息特有的」结构（状态栏、思维链等），
 * 这里只做所有场景都需要的通用清洗，两者互补，不重复。
 */

const CODE_BLOCK = /```[\s\S]*?```|`[^`\n]+`/g;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const MD_HEADING = /^\s{0,3}#{1,6}\s+/gm;
const MD_EMPHASIS = /(\*{1,3}|_{1,3}|~~)(.+?)\1/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_RULE = /^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm;
const MD_QUOTE = /^\s{0,3}>\s?/gm;
const URL = /https?:\/\/\S+/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

const DEFAULT_OPTIONS = {
    stripEmoji: true,
    stripUrl: true,
    quotedOnly: false,
};

/** 只保留引号内的对白，用于「只念台词」模式。 */
function extractQuoted(text) {
    const matches = text.match(/[“"「『]([^”"」』]+)[”"」』]/g) || [];
    return matches
        .map((s) => s.slice(1, -1).trim())
        .filter(Boolean)
        .join('。');
}

/**
 * @param {string} raw
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 * @returns {string}
 */
export function clean(raw, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let text = String(raw ?? '');

    text = text.replace(CODE_BLOCK, ' ');
    text = text.replace(MD_IMAGE, ' ').replace(MD_LINK, '$1');
    text = text.replace(HTML_TAG, ' ');
    text = text.replace(MD_RULE, ' ').replace(MD_HEADING, '').replace(MD_QUOTE, '');
    text = text.replace(MD_EMPHASIS, '$2');
    if (opts.stripUrl) text = text.replace(URL, ' ');
    if (opts.stripEmoji) text = text.replace(EMOJI, '');
    if (opts.quotedOnly) text = extractQuoted(text);

    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** 按句末标点切句，保留标点。 */
function toSentences(text) {
    return text
        .split(/(?<=[。！？!?…；;\n])/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** 单句仍然超长时按标点或硬长度再切。 */
function breakLongSentence(sentence, maxLen) {
    const pieces = [];
    let rest = sentence;
    while (rest.length > maxLen) {
        const window = rest.slice(0, maxLen);
        const cut = Math.max(window.lastIndexOf('，'), window.lastIndexOf(','), window.lastIndexOf(' '));
        const at = cut > maxLen * 0.5 ? cut + 1 : maxLen;
        pieces.push(rest.slice(0, at));
        rest = rest.slice(at);
    }
    if (rest) pieces.push(rest);
    return pieces;
}

/**
 * 切成适合逐段合成的片段：贪心合并句子，尽量接近但不超过 maxLen。
 * 片段越大越自然，但首段越小越快出声——默认值是这两者的折中。
 *
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function split(text, maxLen = 200) {
    const chunks = [];
    let buf = '';

    for (const sentence of toSentences(text)) {
        for (const piece of breakLongSentence(sentence, maxLen)) {
            if (buf && buf.length + piece.length > maxLen) {
                chunks.push(buf);
                buf = '';
            }
            buf += piece;
        }
    }
    if (buf.trim()) chunks.push(buf);
    return chunks;
}
