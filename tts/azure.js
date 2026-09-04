import { register } from './provider.js';

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const TIMEOUT_MS = 30_000;

function endpoint(region, path) {
    return `https://${region}.tts.speech.microsoft.com/cognitiveservices/${path}`;
}

/** SSML 是 XML，正文里的尖括号和 & 必须转义，否则整段合成失败。 */
function escapeXml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** zh-CN-XiaoxiaoNeural -> zh-CN */
function localeOf(voice) {
    const parts = String(voice).split('-');
    return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'zh-CN';
}

/** 数值百分比转 SSML 需要的带符号写法：10 -> "+10%"，-5 -> "-5%" */
function percent(value) {
    const n = Number(value) || 0;
    return `${n >= 0 ? '+' : ''}${n}%`;
}

function buildSsml(text, config) {
    const { voice, rate, pitch } = config;
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${localeOf(voice)}">`
        + `<voice name="${escapeXml(voice)}">`
        + `<prosody rate="${percent(rate)}" pitch="${percent(pitch)}">${escapeXml(text)}</prosody>`
        + '</voice></speak>';
}

function validate(config) {
    if (!config.apiKey) return '未填写 Azure 语音服务密钥';
    if (!config.region) return '未填写 Azure 区域（如 eastasia）';
    if (!config.voice) return '未选择音色';
    return '';
}

function describeFailure(status, body) {
    if (status === 401) return 'Azure 密钥无效或已过期（401）';
    if (status === 403) return 'Azure 密钥无权访问该区域，请确认区域填写正确（403）';
    if (status === 429) return 'Azure 触发限流，请稍后重试（429）';
    return `Azure HTTP ${status}: ${String(body).slice(0, 200)}`;
}

async function synthesize(text, config, signal) {
    const invalid = validate(config);
    if (invalid) throw new Error(invalid);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
        const resp = await fetch(endpoint(config.region, 'v1'), {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': config.apiKey,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
            },
            body: buildSsml(text, config),
            signal: ctrl.signal,
        });
        if (!resp.ok) throw new Error(describeFailure(resp.status, await resp.text().catch(() => '')));
        return await resp.blob();
    } finally {
        clearTimeout(timer);
    }
}

async function listVoices(config) {
    if (!config.apiKey || !config.region) throw new Error('请先填写密钥和区域');
    const resp = await fetch(endpoint(config.region, 'voices/list'), {
        headers: { 'Ocp-Apim-Subscription-Key': config.apiKey },
    });
    if (!resp.ok) throw new Error(describeFailure(resp.status, await resp.text().catch(() => '')));
    const list = await resp.json();
    return list.map((v) => ({
        id: v.ShortName,
        name: `${v.LocalName || v.DisplayName}（${v.Locale}·${v.Gender === 'Female' ? '女' : '男'}）`,
        locale: v.Locale,
    }));
}

register({
    id: 'azure',
    label: 'Azure 语音服务',
    synthesize,
    listVoices,
    validate,
});
