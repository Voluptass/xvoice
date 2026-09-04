/**
 * AI 助手能力注册表。
 *
 * 每个模块把「AI 能对我做什么」注册进来，助手侧不认识任何具体模块，
 * 模块侧也不认识助手。新增能力只需 register()，提示词自动更新。
 *
 * @typedef {object} Capability
 * @property {string} id        形如 'regex.list'，前缀即所属模块
 * @property {string} summary   一句话说明，会写进提示词
 * @property {Record<string, string>} [params] 参数名 -> 说明
 * @property {boolean} [mutates] 是否会改动用户配置
 * @property {(params: object) => Promise<any>|any} handler
 */

const capabilities = new Map();

export function register(cap) {
    if (!cap?.id || typeof cap.handler !== 'function') {
        throw new Error('能力必须包含 id 和 handler');
    }
    capabilities.set(cap.id, { params: {}, mutates: false, ...cap });
}

export function registerAll(caps) {
    caps.forEach(register);
}

export function list() {
    return [...capabilities.values()];
}

export function has(id) {
    return capabilities.has(id);
}

/** 生成写进系统提示词的能力清单。 */
export function describeAll() {
    return list()
        .map((cap) => {
            const params = Object.entries(cap.params)
                .map(([k, desc]) => `    - ${k}: ${desc}`)
                .join('\n');
            const flag = cap.mutates ? ' [会修改配置]' : '';
            return `- ${cap.id}${flag}：${cap.summary}${params ? '\n' + params : ''}`;
        })
        .join('\n');
}

/**
 * 执行一次调用。失败不抛出，而是返回结构化错误，
 * 让助手能把失败原因读回去并自行改正，而不是整轮对话中断。
 * @returns {Promise<{ok: boolean, id: string, result?: any, error?: string}>}
 */
export async function invoke(id, params = {}) {
    const cap = capabilities.get(id);
    if (!cap) return { ok: false, id, error: `不存在的能力：${id}` };
    try {
        return { ok: true, id, result: await cap.handler(params) };
    } catch (e) {
        return { ok: false, id, error: e?.message || String(e) };
    }
}

/** 仅用于测试或热重载。 */
export function reset() {
    capabilities.clear();
}
