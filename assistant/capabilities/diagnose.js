import { registerAll } from '../registry.js';
import { getSettings, getActiveLlmProfile } from '../../core/settings.js';
import { testConnection, suggestBaseFix } from '../../core/llm.js';
import { checkReady, currentProvider, cache } from '../../tts/index.js';
import { getPoolStatus } from '../../tts/keypool.js';
import { inspect } from '../../regex/danger.js';
import { prepare } from '../../core/pipeline.js';

const SAMPLE = '“你终于来了。”她放下手中的杯子，望向窗外。*雨还在下。*';

function checkLlm() {
    const { profile, name, fellBack } = getActiveLlmProfile();
    const issues = [];
    if (!profile.apiUrl) issues.push('未填写 API 地址');
    if (!profile.model) issues.push('未选择模型');
    if (!profile.apiKey) issues.push('未填写 API Key');
    if (fellBack) issues.push(`绑定的预设已失效，正在回落使用「${name || '无'}」`);
    const hint = suggestBaseFix(profile.apiUrl);
    if (hint) issues.push(`API 地址可能缺少版本段，建议改为 ${hint}`);
    return { profile: name, model: profile.model, maxTokens: profile.maxTokens, issues };
}

function checkTts() {
    const { tts } = getSettings();
    const invalid = checkReady();
    const result = { provider: tts.provider, ready: !invalid, issues: invalid ? [invalid] : [] };
    if (tts.provider === 'minimax') {
        result.keyPool = getPoolStatus(tts.minimax.apiKeys || []);
        const cooling = result.keyPool.filter((k) => !k.available).length;
        if (cooling) result.issues.push(`${cooling} 个 Key 正处于限流冷却中`);
    }
    return result;
}

function checkRegex() {
    const { entries } = getSettings().regex;
    const enabled = entries.filter((e) => e.enabled);
    const risky = enabled
        .filter((e) => !inspect(e.find).safe)
        .map((e) => e.name);
    return { total: entries.length, enabled: enabled.length, risky };
}

/** 用样例文本跑一遍完整管线，直接暴露「正则把文本吃空了」这类问题。 */
function checkPipeline(sample) {
    const text = sample || SAMPLE;
    const { chunks, cleaned, afterRegex, errors } = prepare(text);
    return {
        input: text,
        afterRegex,
        cleaned,
        chunkCount: chunks.length,
        firstChunk: chunks[0] || '',
        regexErrors: errors,
        warning: cleaned ? '' : '文本经处理后为空，朗读会失败。请检查正则规则是否过度删除。',
    };
}

registerAll([
    {
        id: 'diagnose.run',
        summary: '对插件做一次完整自检，返回 LLM / TTS / 正则 / 文本管线四项状态。排查任何问题都应先调用它',
        params: { sample: '可选，用于试跑管线的样例文本' },
        handler: async ({ sample } = {}) => ({
            llm: checkLlm(),
            tts: checkTts(),
            regex: checkRegex(),
            playback: getSettings().playback,
            pipeline: checkPipeline(sample),
            cache: await cache.stats().catch(() => ({ count: 0, max: 0 })),
        }),
    },
    {
        id: 'diagnose.testLlm',
        summary: '实际发一次最小请求测试 LLM 连通性，返回成功与否及错误详情',
        handler: async () => {
            const { profile } = getActiveLlmProfile();
            return testConnection(profile);
        },
    },
    {
        id: 'diagnose.testTts',
        summary: '实际合成一小段音频测试 TTS 连通性，不播放，只验证接口可用',
        params: { text: '可选，测试用文本，默认为一句短语' },
        handler: async ({ text } = {}) => {
            const { provider, config } = currentProvider();
            const blob = await provider.synthesize(text || '语音测试', config);
            return { ok: true, bytes: blob.size, type: blob.type };
        },
    },
]);
