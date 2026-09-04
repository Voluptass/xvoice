import { requestChat } from './llm.js';
import { getActiveLlmProfile, getSettings, saveSettings } from './settings.js';
import { lastCharacterMessage } from './chat-source.js';
import { applyAll } from '../regex/apply.js';
import { listVoices } from '../tts/index.js';

/**
 * AI 导演：把一条角色回复拆成「谁说了什么」的台本，并给每个角色配音色。
 *
 * 拆台本和配音色分开两步，因为它们的失效方式不同——
 * 台本拆错要重来，音色配错只要改映射，不必重新问一次模型。
 */

const NARRATOR = '旁白';
const MAX_VOICES = 60;

const SCRIPT_PROMPT = `你是一位广播剧导演。把下面这段角色扮演的正文拆成可以直接配音的台本。

规则：
- 按正文出现顺序拆，不要重排、不要增删剧情。
- 对白归说话的角色，旁白、动作、心理描写归「${NARRATOR}」。
- speaker 用正文里出现的角色名；正文没写名字但能判断是谁在说，就用你判断的那个名字，全篇保持一致。
- text 去掉引号和星号，只留要念出来的字。
- 只输出 JSON，不要解释、不要代码块围栏。

输出格式：
{"lines":[{"speaker":"角色名","text":"要念的话"}]}

正文：
`;

const VOICE_PROMPT = `你是一位配音导演。给下面每个角色从可用音色里挑一个最合适的。

规则：
- 依据角色在台本里的性别、年龄、气质来挑，不同角色尽量用不同音色。
- 旁白挑一个平稳、不抢戏的音色。
- voice 必须是音色列表里出现过的 id 原文，不要自己编。
- 只输出 JSON，不要解释、不要代码块围栏。

输出格式：
{"cast":[{"speaker":"角色名","voice":"音色id"}]}
`;

/** 模型爱把 JSON 裹在代码块或客套话里，取最外层大括号最稳。 */
function parseJson(raw) {
    const text = String(raw || '').replace(/```(?:json)?|```/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(`模型没有返回 JSON：${text.slice(0, 120)}`);
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch (e) {
        throw new Error(`台本 JSON 解析失败：${e.message}`);
    }
}

function normalizeLines(payload) {
    const lines = (payload?.lines || [])
        .map((l) => ({ speaker: String(l?.speaker || NARRATOR).trim() || NARRATOR, text: String(l?.text || '').trim() }))
        .filter((l) => l.text);
    if (!lines.length) throw new Error('模型没有拆出任何台词，请换一条内容更完整的消息。');
    return lines;
}

/** 台本里出现的角色，按首次出场顺序去重。 */
export function castOf(lines) {
    return [...new Set(lines.map((l) => l.speaker))];
}

/**
 * 把一段正文拆成台本。正文先过用户正则，避免状态栏、思维链被当成台词。
 * @returns {Promise<Array<{speaker: string, text: string}>>}
 */
export async function writeScript(rawText, signal) {
    const source = String(rawText || '').trim();
    if (!source) throw new Error('这条消息没有内容可拆。');
    const { profile } = getActiveLlmProfile();
    const { text } = applyAll(source, getSettings().regex.entries);
    const raw = await requestChat(
        [{ role: 'user', content: SCRIPT_PROMPT + (text.trim() || source) }],
        { ...profile, stream: false },
        { signal },
    );
    return normalizeLines(parseJson(raw));
}

/** 让模型从真实音色列表里给每个角色挑一个，返回 { 角色: 音色id }。 */
async function pickVoicesByAi(cast, signal) {
    const voices = (await listVoices()).slice(0, MAX_VOICES);
    if (!voices.length) throw new Error('当前供应商拉不到音色列表，请在「音色」页签手动为角色指定。');
    const { profile } = getActiveLlmProfile();
    const menu = voices.map((v) => `- ${v.id}：${v.name}`).join('\n');
    const raw = await requestChat(
        [{ role: 'user', content: `${VOICE_PROMPT}\n角色：${cast.join('、')}\n\n可用音色：\n${menu}` }],
        { ...profile, stream: false },
        { signal },
    );
    const valid = new Set(voices.map((v) => v.id));
    const picked = {};
    for (const item of parseJson(raw)?.cast || []) {
        const speaker = String(item?.speaker || '').trim();
        const voice = String(item?.voice || '').trim();
        if (speaker && valid.has(voice)) picked[speaker] = voice;
    }
    return picked;
}

/**
 * 为台本里的角色准备音色映射并存进设置。
 * ai 模式下只补没配过的角色，用户手动改过的不被覆盖；
 * 手动模式把新角色登记成空值，好让「音色」页签把它们列出来等着配。
 * @returns {Promise<{mode: string, roleVoices: object, missing: string[]}>}
 */
export async function assignVoices(cast, signal) {
    const { director } = getSettings();
    const mode = director.voiceMode === 'manual' ? 'manual' : 'ai';
    const pending = cast.filter((name) => !director.roleVoices[name]);
    if (pending.length) {
        if (mode === 'ai') Object.assign(director.roleVoices, await pickVoicesByAi(pending, signal));
        pending.forEach((name) => {
            if (!director.roleVoices[name]) director.roleVoices[name] = '';
        });
        saveSettings();
    }
    const missing = cast.filter((name) => !director.roleVoices[name]);
    return { mode, roleVoices: { ...director.roleVoices }, missing };
}

/**
 * 完整跑一遍导演流程：取最近一条角色回复 → 拆台本 → 配音色。
 * @returns {Promise<{lines: Array, cast: string[], roleVoices: object, missing: string[], mode: string}>}
 */
export async function direct({ text, signal } = {}) {
    const source = text || lastCharacterMessage();
    if (!source) throw new Error('当前聊天里还没有角色回复。');
    const lines = await writeScript(source, signal);
    const cast = castOf(lines);
    const { mode, roleVoices, missing } = await assignVoices(cast, signal);
    return { lines, cast, roleVoices, missing, mode };
}
