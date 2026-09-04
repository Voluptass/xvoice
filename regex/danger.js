/**
 * 灾难性回溯（ReDoS）检测。
 *
 * 正则跑在浏览器主线程上，一条 (a+)+ 就能把整个酒馆卡死。
 * 与其等它卡住再想办法中断，不如在保存规则时就拦下来。
 */

const RULES = [
    {
        test: /\([^()]*[+*][^()]*\)\s*[+*]/,
        name: '嵌套量词',
        detail: '形如 (a+)+ 的写法会让匹配失败时的回溯次数呈指数增长',
    },
    {
        test: /\((?:[^()]*\|)+[^()]*\)\s*[+*]/,
        name: '交替分组加量词',
        detail: '形如 (a|b)+ 在分支可互相匹配时会产生大量回溯',
    },
    {
        test: /\.[*+][^?]*\.[*+]/,
        name: '多段贪婪通配',
        detail: '多个 .* / .+ 串联会让引擎在各种切分方式间反复试探',
    },
    {
        test: /\(\s*\)\s*[+*]/,
        name: '空分组加量词',
        detail: '对可匹配空串的分组加量词可能导致死循环',
    },
    {
        test: /\{\d{3,},?\d*\}/,
        name: '超大重复次数',
        detail: '过大的 {n,m} 会成倍放大匹配开销',
    },
];

const MAX_PATTERN_LENGTH = 500;

/**
 * @param {string} pattern
 * @returns {{safe: boolean, warnings: Array<{name: string, detail: string}>}}
 */
export function inspect(pattern) {
    const src = String(pattern || '');
    if (!src) return { safe: true, warnings: [] };

    const warnings = RULES
        .filter((r) => r.test.test(src))
        .map(({ name, detail }) => ({ name, detail }));

    if (src.length > MAX_PATTERN_LENGTH) {
        warnings.push({
            name: '规则过长',
            detail: `长度 ${src.length} 字符，建议拆成多条规则`,
        });
    }
    return { safe: warnings.length === 0, warnings };
}

/** 汇总成一句可直接展示给用户的话。 */
export function describe(pattern) {
    const { safe, warnings } = inspect(pattern);
    if (safe) return '';
    return warnings.map((w) => `${w.name}：${w.detail}`).join('；');
}
