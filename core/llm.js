import { getRequestHeaders } from '../../../../../script.js';

/**
 * 唯一的 LLM 请求通道。
 *
 * 设计约束（针对旧实现的已知故障）：
 * 1. 测试连接与真实业务请求走同一个 requestChat()，不存在“测得通用不了”。
 * 2. apiUrl 一律视为完整 base，只去尾部斜杠，绝不猜测补 /v1，
 *    因此直连与酒馆代理对同一份配置的解读完全一致。
 * 3. CSRF 交给酒馆的 getRequestHeaders()，不自建 token 缓存与文案匹配。
 * 4. 输出被截断（finish_reason=length）单独报错，不伪装成 JSON 解析失败。
 */

const CHAT_PATH = '/chat/completions';
const MODELS_PATH = '/models';
const PROXY_URL = '/api/backends/chat-completions/generate';
const PROXY_STATUS_URL = '/api/backends/chat-completions/status';

/** apiUrl 只做一件事：去掉尾部斜杠。 */
export function normalizeBase(raw) {
    return String(raw || '').trim().replace(/\/+$/, '');
}

/**
 * base 看起来缺少版本段时返回建议值，供 UI 提示用。
 * 只提示，不自动修改——静默改 URL 是旧实现最难排查的坑。
 */
export function suggestBaseFix(raw) {
    const base = normalizeBase(raw);
    if (!base || /\/v\d/.test(base)) return '';
    return `${base}/v1`;
}

/** 走酒馆代理时 key 会被拼进 header 字符串，先挡掉会拼坏的字符。 */
function assertHeaderSafe(apiKey) {
    if (/[\r\n"]/.test(apiKey)) {
        throw new Error('API Key 含有换行或引号，无法通过酒馆代理发送。请检查是否粘贴多余内容，或改用「绕过酒馆代理」。');
    }
}

function stripImages(messages) {
    return messages.map((m) => {
        if (!Array.isArray(m?.content)) return m;
        const text = m.content
            .map((p) => (typeof p === 'string' ? p : p?.text || ''))
            .filter(Boolean)
            .join('\n');
        return { ...m, content: text };
    });
}

/** 合并相邻同角色消息；部分模型不接受连续 system 或 system 开头。 */
function mergeAdjacent(messages, mergeSystemUser) {
    const roleOf = (r) => (mergeSystemUser && r === 'system' ? 'user' : r);
    const out = [];
    for (const m of messages) {
        if (!m) continue;
        const last = out[out.length - 1];
        const canMerge = last
            && roleOf(last.role) === roleOf(m.role)
            && typeof last.content === 'string'
            && typeof m.content === 'string';
        if (canMerge) {
            last.content = last.content ? `${last.content}\n\n${m.content}` : m.content;
        } else {
            out.push({ ...m, role: roleOf(m.role) });
        }
    }
    return out;
}

function buildPayload(messages, profile) {
    const prepared = mergeAdjacent(stripImages(messages), profile.mergeSystemUser);
    return {
        model: profile.model,
        messages: prepared,
        temperature: profile.temperature,
        top_p: profile.topP,
        max_tokens: profile.maxTokens,
        stream: !!profile.stream,
    };
}

/** 按 bypassProxy 组装最终请求。两条分支共用同一个 base，不做二次加工。 */
function buildRequest(payload, profile) {
    const base = normalizeBase(profile.apiUrl);
    if (profile.bypassProxy) {
        return {
            url: base + CHAT_PATH,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${profile.apiKey}`,
            },
            body: JSON.stringify(payload),
        };
    }
    assertHeaderSafe(profile.apiKey);
    return {
        url: PROXY_URL,
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...payload,
            chat_completion_source: 'custom',
            custom_url: base,
            custom_include_headers: `Authorization: "Bearer ${profile.apiKey}"`,
        }),
    };
}

function describeError(status, statusText, rawText) {
    const head = `HTTP ${status}${statusText ? ' ' + statusText : ''}`;
    const raw = String(rawText || '').trim();
    // 返回网页而非 JSON，几乎总是地址填错。贴出整页 HTML 对用户毫无帮助。
    if (/^<(!doctype|html)/i.test(raw)) {
        return `${head}：服务器返回的是网页而不是接口数据，通常是 API 地址填错了`;
    }
    let detail = raw.replace(/\s+/g, ' ');
    try {
        const json = JSON.parse(raw);
        detail = json?.error?.message || json?.message || detail;
    } catch { /* 非 JSON，用原文 */ }
    if (!detail) return head;
    return `${head}: ${detail.slice(0, 300)}`;
}

/** 从非流式响应体取正文，并把“被截断”与“空回复”区分开。 */
function extractContent(data) {
    const choice = data?.choices?.[0];
    const content = choice?.message?.content || '';
    if (choice?.finish_reason === 'length') {
        throw new Error(`输出被截断（max_tokens=${data?.usage?.completion_tokens ?? '?'} 已用尽），请在 LLM 设置里调大「最大输出长度」。`);
    }
    if (!content) {
        throw new Error(`模型返回空内容。finish_reason=${choice?.finish_reason ?? '未知'}`);
    }
    return content;
}

/** 解析一行 SSE。返回 null 表示该行应忽略。 */
function parseStreamLine(raw) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith(':') || line.startsWith('event:')) return null;
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (!payload || payload === '[DONE]') return null;
    let json;
    try { json = JSON.parse(payload); } catch { return null; }
    if (json?.error) throw new Error(json.error.message || String(json.error));
    const choice = json?.choices?.[0];
    return {
        delta: choice?.delta?.content ?? choice?.message?.content ?? '',
        truncated: choice?.finish_reason === 'length',
    };
}

function consumeLine(line, state, onDelta) {
    const parsed = parseStreamLine(line);
    if (!parsed) return;
    if (parsed.truncated) state.truncated = true;
    if (!parsed.delta) return;
    state.text += parsed.delta;
    onDelta?.(parsed.delta);
}

/** 流式下截断不抛错：用户已经看到内容了，清空反而更难排查。 */
function appendTruncationWarning(text, onDelta) {
    const warn = '\n\n⚠️ 输出被截断，请在 LLM 设置里调大「最大输出长度」。';
    onDelta?.(warn);
    return text + warn;
}

async function readStream(resp, onDelta) {
    if (!resp.body) throw new Error('响应没有 body，无法流式读取');
    const state = { text: '', truncated: false };
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) consumeLine(line, state, onDelta);
    }
    if (buf.trim()) consumeLine(buf, state, onDelta);
    if (!state.text) throw new Error('流式响应未产出任何内容');
    return state.truncated ? appendTruncationWarning(state.text, onDelta) : state.text;
}

/**
 * 发起一次对话补全。测试连接与业务调用都走这里。
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} profile 见 settings.DEFAULT_LLM_PROFILE
 * @param {{signal?: AbortSignal, onDelta?: (t:string)=>void}} [opts]
 * @returns {Promise<string>}
 */
export async function requestChat(messages, profile, opts = {}) {
    if (!normalizeBase(profile.apiUrl)) throw new Error('未填写 API 地址');
    if (!profile.model) throw new Error('未选择模型');

    const { url, headers, body } = buildRequest(buildPayload(messages, profile), profile);
    const resp = await fetch(url, { method: 'POST', headers, body, signal: opts.signal });

    if (!resp.ok) {
        throw new Error(describeError(resp.status, resp.statusText, await resp.text().catch(() => '')));
    }
    if (profile.stream) return readStream(resp, opts.onDelta);

    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); } catch {
        throw new Error(`响应不是有效 JSON：${rawText.slice(0, 200)}`);
    }
    if (data?.error) throw new Error(data.error.message || String(data.error));
    return extractContent(data);
}

/** 兼容 {data:[{id}]}、{models:[...]}、[...] 等多种返回形状。 */
function extractModelIds(payload) {
    const list = Array.isArray(payload) ? payload : (payload?.data ?? payload?.models ?? []);
    const ids = list
        .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || m?.model))
        .filter(Boolean);
    return [...new Set(ids)].sort();
}

async function fetchModelsDirect(profile, signal) {
    const resp = await fetch(normalizeBase(profile.apiUrl) + MODELS_PATH, {
        headers: { Authorization: `Bearer ${profile.apiKey}` },
        signal,
    });
    if (!resp.ok) {
        throw new Error(describeError(resp.status, resp.statusText, await resp.text().catch(() => '')));
    }
    return extractModelIds(await resp.json());
}

/** 酒馆代理没有透传 /models，用它的 status 端点拿同样的清单。 */
async function fetchModelsViaProxy(profile, signal) {
    assertHeaderSafe(profile.apiKey);
    const resp = await fetch(PROXY_STATUS_URL, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: normalizeBase(profile.apiUrl),
            custom_include_headers: `Authorization: "Bearer ${profile.apiKey}"`,
        }),
        signal,
    });
    if (!resp.ok) {
        throw new Error(describeError(resp.status, resp.statusText, await resp.text().catch(() => '')));
    }
    return extractModelIds(await resp.json());
}

/**
 * 拉取可用模型列表。与 requestChat 走同一套 base 归一化和代理开关，
 * 避免出现「列表拉得到但聊天发不出去」这种配置错位。
 * @returns {Promise<string[]>}
 */
export async function listModels(profile, opts = {}) {
    if (!normalizeBase(profile.apiUrl)) throw new Error('请先填写 API 地址');
    const ids = profile.bypassProxy
        ? await fetchModelsDirect(profile, opts.signal)
        : await fetchModelsViaProxy(profile, opts.signal);
    if (!ids.length) {
        throw new Error('接口没有返回任何模型，该服务可能不支持 /models，请手动填写模型名');
    }
    return ids;
}

/**
 * 连通性自检。刻意复用 requestChat，只把参数压到最小，
 * 保证测出来的结果和实际调用完全同源。
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function testConnection(profile) {    const probe = { ...profile, stream: false, maxTokens: 16, temperature: 0 };
    try {
        const reply = await requestChat([{ role: 'user', content: 'ping' }], probe);
        return { ok: true, message: `连接正常，模型回复：${reply.slice(0, 50)}` };
    } catch (e) {
        const hint = suggestBaseFix(profile.apiUrl);
        const extra = hint ? `\n提示：API 地址可能缺少版本段，试试 ${hint}` : '';
        return { ok: false, message: `${e.message || e}${extra}` };
    }
}
