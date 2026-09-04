import { getProvider, listProviders } from './provider.js';
import * as cache from './cache.js';
import { getSettings } from '../core/settings.js';

// 注册内置供应商（导入即注册）
import './minimax.js';
import './azure.js';

export { getProvider, listProviders, cache };

/** 取当前供应商及其配置。 */
export function currentProvider() {
    const { tts } = getSettings();
    return { provider: getProvider(tts.provider), config: tts[tts.provider], settings: tts };
}

/** 当前配置是否可用，返回空串表示就绪。 */
export function checkReady() {
    try {
        const { provider, config } = currentProvider();
        return provider.validate(config);
    } catch (e) {
        return e.message;
    }
}

/**
 * 合成一段文本。命中缓存直接返回，未命中才真正请求。
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @param {object} [voiceOverride] 按角色覆盖音色参数，如 { voiceId: '...' } 或 { voice: '...' }
 * @returns {Promise<Blob>}
 */
export async function synthesize(text, signal, voiceOverride) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('没有可朗读的文本');

    const { provider, config, settings } = currentProvider();
    const effective = voiceOverride ? { ...config, ...voiceOverride } : config;
    if (!settings.cacheEnabled) return provider.synthesize(trimmed, effective, signal);

    const key = await cache.makeKey(provider.id, trimmed, effective);
    const hit = await cache.get(key).catch(() => null);
    if (hit) return hit;

    const blob = await provider.synthesize(trimmed, effective, signal);
    cache.put(key, blob).catch((e) => console.warn('[xvoice] 写缓存失败:', e));
    return blob;
}

/** 拉取当前供应商的音色列表；供应商未实现时返回空数组。 */
export async function listVoices() {
    const { provider, config } = currentProvider();
    if (!provider.listVoices) return [];
    return provider.listVoices(config);
}
