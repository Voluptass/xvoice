/**
 * 助手与 LLM 之间的调用协议。
 *
 * 用 XML 标签而不是 function calling：酒馆用户接的中转 API 五花八门，
 * 很多不支持 tools 字段，但所有模型都能稳定吐出标签。
 *
 * 格式：<xv name="能力ID">{"参数": "值"}</xv>
 */

const CALL_TAG = /<xv\s+name=["']([\w.]+)["']\s*>([\s\S]*?)<\/xv>/g;

/**
 * 从回复中提取全部调用。参数解析失败时保留错误信息，
 * 由执行层回灌给模型让它自己修正，而不是静默丢弃。
 * @returns {Array<{id: string, params: object, error?: string}>}
 */
export function parseCalls(text) {
    const calls = [];
    for (const [, id, body] of String(text || '').matchAll(CALL_TAG)) {
        const raw = body.trim();
        if (!raw) {
            calls.push({ id, params: {} });
            continue;
        }
        try {
            calls.push({ id, params: JSON.parse(raw) });
        } catch (e) {
            calls.push({ id, params: {}, error: `参数不是合法 JSON：${e.message}` });
        }
    }
    return calls;
}

/** 去掉调用标签，剩下的是给用户看的自然语言。 */
export function stripCalls(text) {
    return String(text || '')
        .replace(CALL_TAG, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** 把执行结果拼成回灌给模型的消息。 */
export function formatResults(results) {
    const lines = results.map((r) => {
        const payload = r.ok ? JSON.stringify(r.result ?? null) : `错误：${r.error}`;
        return `<xv-result name="${r.id}">${payload}</xv-result>`;
    });
    return lines.join('\n');
}

/** 写进系统提示词的协议说明。 */
export function protocolInstructions(capabilityList) {
    return `你可以调用下列能力来查看或修改插件配置。调用格式（参数为 JSON，无参数可留空）：

<xv name="能力ID">{"参数名": "值"}</xv>

规则：
- 一次回复可以发出多个调用，系统会按顺序执行并把结果以 <xv-result> 返回给你。
- 拿到结果后再继续回答，不要凭空猜测当前配置。
- 标记 [会修改配置] 的能力会真实改动用户设置，动手前先说明你要做什么。
- 调用标签之外的文字会直接展示给用户，请用中文、简洁地说明。

可用能力：
${capabilityList}`;
}
