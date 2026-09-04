import { requestChat } from '../core/llm.js';
import { getActiveLlmProfile } from '../core/settings.js';
import { describeAll, invoke } from './registry.js';
import { parseCalls, stripCalls, formatResults, protocolInstructions } from './protocol.js';

// 注册内置能力（导入即注册）
import './capabilities/diagnose.js';
import './capabilities/llm.js';
import './capabilities/tts.js';
import './capabilities/regex.js';
import './capabilities/playback.js';
import './capabilities/director.js';

const MAX_ROUNDS = 8;

const FORCE_ANSWER = '已达到能力调用次数上限。请不要再发出任何 <xv> 调用，'
    + '直接基于你已经查到的信息，用中文告诉用户结论和下一步该怎么做。';

const ROLE = `你是语音朗读插件 xvoice 的配置助手，负责帮用户把插件调到能用、好用。

工作方式：
- 用户描述问题时，先调用 diagnose.run 拿到真实状态，再下结论。不要猜测配置。
- 定位到问题后，直接调用相应能力帮用户改好，并说明你改了什么、为什么。
- 涉及密钥、付费接口这类敏感改动，先说明再动手。
- 回答简短直接，不要罗列无关选项。

⚠️ 先找现成开关，正则是最后手段。常见需求的正确做法：
- 「只念对白 / 别念旁白和动作」→ playback.configure { quotedOnly: true }
- 「别念表情符号 / 别念网址」→ playback.configure { stripEmoji / stripUrl }
- 「说话太快 / 声音太小 / 换个音色」→ tts.configure
- 「读一半就停 / 出声太慢」→ playback.configure { chunkSize }
- 「男女主分开读 / 按角色配音 / 像广播剧」→ director.run
只有要**删掉正文里的某类内容**（思维链、状态栏、数据块、图片标签）时才写正则。
写正则前先用 playback.preview 看看当前输出，写完再用它确认没把正文吃掉。

如果连续几次调用都没有进展，停下来把情况告诉用户并给出建议，不要反复试错。`;

function buildSystemPrompt() {
    return `${ROLE}\n\n${protocolInstructions(describeAll())}`;
}

async function runCalls(calls, onCall) {
    const results = [];
    for (const call of calls) {
        onCall?.({ id: call.id, status: 'running' });
        const result = call.error
            ? { ok: false, id: call.id, error: call.error }
            : await invoke(call.id, call.params);
        onCall?.({ id: call.id, status: result.ok ? 'done' : 'failed', result });
        results.push(result);
    }
    return results;
}

/** 轮次用尽时再要一次纯文字回答，别把已经查到的信息浪费掉。 */
async function forceConclusion(messages, profile, appended, hooks) {
    messages.push({ role: 'user', content: FORCE_ANSWER });
    appended.push({ role: 'user', content: FORCE_ANSWER });
    const raw = await requestChat(messages, profile, {
        signal: hooks.signal,
        onDelta: hooks.onDelta,
    });
    appended.push({ role: 'assistant', content: raw });
    return {
        reply: stripCalls(raw) || '没能得出结论，请补充说明你遇到的具体现象。',
        messages: appended,
    };
}

/**
 * 跑一轮完整对话：模型可以连续调用能力，直到它给出不含调用的最终答复。
 *
 * @param {string} userInput
 * @param {Array<{role: string, content: string}>} history 之前的对话（不含系统提示）
 * @param {{onDelta?: Function, onCall?: Function, signal?: AbortSignal}} [hooks]
 * @returns {Promise<{reply: string, messages: Array}>} messages 为本轮新增的消息，供调用方追加进历史
 */
export async function chat(userInput, history = [], hooks = {}) {
    const { profile } = getActiveLlmProfile();
    const messages = [
        { role: 'system', content: buildSystemPrompt() },
        ...history,
        { role: 'user', content: userInput },
    ];
    const appended = [{ role: 'user', content: userInput }];

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const raw = await requestChat(messages, profile, {
            signal: hooks.signal,
            onDelta: hooks.onDelta,
        });
        messages.push({ role: 'assistant', content: raw });
        appended.push({ role: 'assistant', content: raw });

        const calls = parseCalls(raw);
        if (!calls.length) return { reply: stripCalls(raw), messages: appended };

        const feedback = formatResults(await runCalls(calls, hooks.onCall));
        messages.push({ role: 'user', content: feedback });
        appended.push({ role: 'user', content: feedback });
    }
    return forceConclusion(messages, profile, appended, hooks);
}

/** 供 UI 展示：当前助手掌握哪些能力。 */
export { list as listCapabilities } from './registry.js';
