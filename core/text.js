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

// ── 本地对白提取 ─────────────────────────────────
//
// 不调用大模型，靠规则从正文里抓引号对白并尽量标注说话人。
// 快、免费、离线，但说话人识别是启发式的：拿不准就标「未知」，
// 排版特别复杂时应该交给 AI 导演。

const UNKNOWN_SPEAKER = '未知';
const DIALOGUE_QUOTE = /[“"「『]([^”"」』]*)[”"」』]/g;
// 名字里不允许出现标点、引号、括号，避免把整句叙述当成说话人
const NAME = '[^\\s：:，,。！？!?；;、()（）\\[\\]【】“”"「」『』*_]{1,16}';
// 行内任意位置的「名字：」，取引号前面最近的一个
const NAME_COLON = new RegExp(`(${NAME})[*_\\s]*[：:]`, 'g');
// 引号后面的「X说 / X道 / X笑道……」
const SPEAKER_AFTER = new RegExp(`^\\s*[，,]?\\s*(${NAME})\\s*(?:说道|问道|答道|笑道|冷笑道|苦笑道|低声说|回答|开口|说|道|问|答|喊|叫)`);
const SPEAK_VERB_TAIL = /(?:说道|问道|答道|笑道|冷笑道|苦笑道|低声说|回答|开口|说|道|问|答|喊|叫)$/;
const BAD_NAME = /[了着的地得笑怒叹哭想，,。！？!?：:；;、()（）\[\]【】]/;
// 元信息字段名，不应被当成说话人
const META_WORDS = 'date|time|datetime|day|week|weekday|location|loc|place|status|state|name|id|uid|turn|round|depth|index|mood|weather|season|hp|mp|level|时间|日期|地点|位置|状态|天气|心情|季节|回合|好感度|等级';
const META_KEY = new RegExp(`^(?:${META_WORDS})$`, 'i');
// 看起来像日期 / 时间 / 纯数字的引号内容，不当对白
const META_TEXT = new RegExp(
    `^(?:${META_WORDS}|\\d{4}年\\d{1,2}月\\d{1,2}日.*|\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}:\\d{2}(?::\\d{2})?|[-+]?\\d+(?:\\.\\d+)?)$`,
    'i',
);

/** 把候选名字清理成干净的角色名，不像名字就返回空串。 */
function cleanName(name) {
    let s = String(name || '').replace(/[*_\s]/g, '').trim();
    let prev = '';
    while (s && s !== prev) {
        prev = s;
        s = s.replace(SPEAK_VERB_TAIL, '');
    }
    if (!s || s.length > 12) return '';
    if (BAD_NAME.test(s)) return '';
    if (/[=<>]/.test(s)) return '';   // 键值对 / 标签
    if (/^\d+$/.test(s)) return '';     // 纯数字（回合号 / ID）
    if (META_KEY.test(s)) return '';    // date / time / location ……
    return s;
}

/**
 * 从正文里提取引号对白及其说话人。
 * @param {string} raw 已经清洗过的正文
 * @returns {Array<{speaker: string, text: string}>}
 */
export function parseDialogue(raw) {
    const out = [];
    let lastSpeaker = '';

    for (const line of String(raw ?? '').split(/\n+/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 本行所有「名字：」的位置，供引号就近取用
        const prefixes = [];
        NAME_COLON.lastIndex = 0;
        let p;
        while ((p = NAME_COLON.exec(trimmed))) {
            const name = cleanName(p[1]);
            if (name) prefixes.push({ name, end: p.index + p[0].length });
        }

        let found = false;
        DIALOGUE_QUOTE.lastIndex = 0;
        let m;
        while ((m = DIALOGUE_QUOTE.exec(trimmed))) {
            const text = m[1].trim();
            if (!text || META_TEXT.test(text)) continue;
            found = true;

            // 优先用引号前面最近的那个「名字：」
            let speaker = '';
            for (let i = prefixes.length - 1; i >= 0; i--) {
                if (prefixes[i].end <= m.index) { speaker = prefixes[i].name; break; }
            }
            if (!speaker) {
                const after = trimmed.slice(m.index + m[0].length).match(SPEAKER_AFTER);
                speaker = cleanName(after?.[1]) || lastSpeaker || UNKNOWN_SPEAKER;
            }
            if (speaker !== UNKNOWN_SPEAKER) lastSpeaker = speaker;
            out.push({ speaker, text });
        }
        // 「名字：」单独成行时，后面几行的对白默认归它
        if (!found && prefixes.length) lastSpeaker = prefixes[prefixes.length - 1].name;
    }

    return out;
}

/**
 * 本地提取的可信度：能确定说话人的比例。低于 0.5 建议改用 AI。
 * @param {Array<{speaker: string, text: string}>} lines
 * @returns {number} 0~1
 */
export function dialogueConfidence(lines) {
    if (!lines?.length) return 0;
    const known = lines.filter((l) => l.speaker !== UNKNOWN_SPEAKER).length;
    return known / lines.length;
}
