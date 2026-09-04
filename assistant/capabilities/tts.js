import { registerAll } from '../registry.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { listProviders, listVoices, checkReady, cache } from '../../tts/index.js';
import { Provider } from '../../core/constants.js';

/** 各供应商存音色的字段名不同，对助手统一暴露为 voice。 */
const VOICE_FIELD = {
    [Provider.MINIMAX]: 'voiceId',
    [Provider.AZURE]: 'voice',
};

function ttsSettings() {
    return getSettings().tts;
}

function applyConfig(target, patch) {
    const applied = [];
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || !(key in target)) continue;
        target[key] = value;
        applied.push(key);
    }
    return applied;
}

registerAll([
    {
        id: 'tts.status',
        summary: '查看当前 TTS 供应商、音色参数与就绪状态',
        handler: async () => {
            const tts = ttsSettings();
            const invalid = checkReady();
            return {
                provider: tts.provider,
                available: listProviders(),
                config: tts[tts.provider],
                ready: !invalid,
                issue: invalid,
                cacheEnabled: tts.cacheEnabled,
                cache: await cache.stats().catch(() => null),
            };
        },
    },
    {
        id: 'tts.setProvider',
        summary: '切换 TTS 供应商',
        mutates: true,
        params: { provider: `供应商 id，可选 ${Object.values(Provider).join(' / ')}` },
        handler: ({ provider }) => {
            if (!listProviders().some((p) => p.id === provider)) {
                throw new Error(`不支持的供应商：${provider}`);
            }
            ttsSettings().provider = provider;
            saveSettings();
            return { provider };
        },
    },
    {
        id: 'tts.configure',
        summary: '修改当前供应商的参数（音色、语速、音量、音调等），只传需要改的字段',
        mutates: true,
        params: {
            voice: '音色 id',
            speed: '语速，MiniMax 为 0.5–2.0',
            rate: '语速百分比，Azure 用，如 10 表示 +10%',
            pitch: '音调',
            vol: '音量，MiniMax 用',
            emotion: '情绪，MiniMax 用',
            apiKey: 'API 密钥',
            region: 'Azure 区域',
        },
        handler: ({ voice, ...rest }) => {
            const tts = ttsSettings();
            const config = tts[tts.provider];
            const patch = { ...rest };
            if (voice !== undefined) patch[VOICE_FIELD[tts.provider]] = voice;
            const applied = applyConfig(config, patch);
            saveSettings();
            return { provider: tts.provider, applied, config };
        },
    },
    {
        id: 'tts.addKey',
        summary: '为 MiniMax 追加一个 API Key（多 Key 可缓解限流）',
        mutates: true,
        params: { key: 'MiniMax API Key' },
        handler: ({ key }) => {
            if (!key) throw new Error('缺少 key 参数');
            const { minimax } = ttsSettings();
            if (minimax.apiKeys.includes(key)) return { added: false, total: minimax.apiKeys.length };
            minimax.apiKeys.push(key);
            saveSettings();
            return { added: true, total: minimax.apiKeys.length };
        },
    },
    {
        id: 'tts.listVoices',
        summary: '拉取当前供应商可用的音色列表（MiniMax 与 Azure 均支持在线拉取）',
        params: { keyword: '可选，按名称或语言过滤' },
        handler: async ({ keyword } = {}) => {
            const voices = await listVoices();
            if (!keyword) return voices.slice(0, 50);
            const kw = String(keyword).toLowerCase();
            return voices.filter((v) => `${v.id}${v.name}`.toLowerCase().includes(kw)).slice(0, 50);
        },
    },
    {
        id: 'tts.clearCache',
        summary: '清空 TTS 音频缓存，用于释放存储空间（换音色无需清理，缓存键已包含音色参数）',
        mutates: true,
        handler: async () => {
            await cache.clear();
            return { cleared: true };
        },
    },
]);
