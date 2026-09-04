import { register, hexToBlob } from './provider.js';
import { pickKey, markRateLimited, nextAvailableIn } from './keypool.js';

const BASE = {
    cn: 'https://api.minimaxi.com/v1',
    io: 'https://api.minimax.io/v1',
};

const RATE_LIMITED = 1002;
const TIMEOUT_MS = 60_000;

function buildBody(text, config) {
    const voice = {
        voice_id: config.voiceId,
        speed: Number(config.speed),
        vol: Number(config.vol),
        pitch: Number(config.pitch),
    };
    if (config.emotion) voice.emotion = config.emotion;
    return {
        model: config.model,
        text,
        stream: false,
        voice_setting: voice,
        audio_setting: { format: 'mp3', sample_rate: 32000, channel: 1, bitrate: 128000 },
        // 用 hex 直接拿到音频字节，避开 url 模式下二次请求 CDN 的跨域面
        output_format: 'hex',
        language_boost: 'auto',
    };
}

/** 发一次 POST。返回 {rateLimited:true} 或 {data}，HTTP/业务错误直接抛出。 */
async function postJson(base, key, path, body, signal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
        const resp = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error(`MiniMax HTTP ${resp.status}: ${text.slice(0, 200)}`);
        return parseBaseResp(text);
    } finally {
        clearTimeout(timer);
    }
}

function parseBaseResp(rawText) {
    let data;
    try { data = JSON.parse(rawText); } catch {
        throw new Error(`MiniMax 返回非 JSON：${rawText.slice(0, 200)}`);
    }
    const code = data?.base_resp?.status_code;
    if (code === RATE_LIMITED) return { rateLimited: true };
    if (code) throw new Error(`MiniMax 错误 ${code}：${data?.base_resp?.status_msg || ''}`);
    return { data };
}

/** 带 key 轮换地发一次请求；全部 key 冷却时给出明确等待时间。 */
async function postWithKeys(config, path, body, signal) {
    const base = BASE[config.platform];
    const keys = config.apiKeys;
    for (let i = 0; i < keys.length; i++) {
        const key = pickKey(keys);
        if (!key) break;
        const result = await postJson(base, key, path, body, signal);
        if (result.data) return result.data;
        markRateLimited(key);
    }
    const wait = Math.ceil(nextAvailableIn(keys) / 1000);
    throw new Error(`MiniMax 所有 Key 都在限流冷却中，约 ${wait} 秒后可重试。可在设置里添加更多 Key。`);
}

function validate(config) {
    if (!config.apiKeys?.length) return '未填写 MiniMax API Key';
    if (!BASE[config.platform]) return `未知的接入点：${config.platform}`;
    if (!config.voiceId) return '未选择音色';
    if (!config.model) return '未选择模型';
    return '';
}

async function synthesize(text, config, signal) {
    const invalid = validate(config);
    if (invalid) throw new Error(invalid);

    const data = await postWithKeys(config, '/t2a_v2', buildBody(text, config), signal);
    const hex = data?.data?.audio;
    if (!hex) throw new Error('MiniMax 未返回音频数据');
    return hexToBlob(hex, 'audio/mpeg');
}

const VOICE_GROUPS = [
    ['system_voice', '系统'],
    ['voice_cloning', '克隆'],
    ['voice_generation', '生成'],
];

/** 拉取账号下全部可用音色，省得用户去控制台抄 id。 */
async function listVoices(config) {
    if (!config.apiKeys?.length) throw new Error('请先填写 API Key');
    const data = await postWithKeys(config, '/get_voice', { voice_type: 'all' });
    return VOICE_GROUPS.flatMap(([field, label]) =>
        (data?.[field] || []).map((v) => ({
            id: v.voice_id,
            name: `${v.voice_name || v.voice_id}（${label}）`,
        })));
}

register({
    id: 'minimax',
    label: 'MiniMax',
    synthesize,
    listVoices,
    validate,
});
