/**
 * TTS 供应商注册表。
 * 新增供应商只需实现下面的接口并 register()，调用方与 UI 都无需改动。
 *
 * @typedef {object} TtsProvider
 * @property {string} id
 * @property {string} label
 * @property {(text: string, config: object, signal?: AbortSignal) => Promise<Blob>} synthesize
 * @property {(config: object) => Promise<Array<{id: string, name: string}>>} [listVoices]
 * @property {(config: object) => string} validate 返回空串表示配置可用，否则为错误原因
 */

const registry = new Map();

export function register(provider) {
    registry.set(provider.id, provider);
}

export function getProvider(id) {
    const p = registry.get(id);
    if (!p) throw new Error(`未知的 TTS 供应商：${id}`);
    return p;
}

export function listProviders() {
    return [...registry.values()].map(({ id, label }) => ({ id, label }));
}

/** 把十六进制音频串转成 Blob。MiniMax 的 hex 输出走这里。 */
export function hexToBlob(hex, mime) {
    const clean = String(hex || '').trim();
    if (!clean || clean.length % 2 !== 0) throw new Error('音频数据格式异常');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return new Blob([bytes], { type: mime });
}
