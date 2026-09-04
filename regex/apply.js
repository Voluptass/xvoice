import { Placement } from '../core/constants.js';
import { inspect } from './danger.js';

/** 把 "/pattern/flags" 或裸模式串编译成 RegExp。非法时抛出可读错误。 */
export function toRegExp(pattern) {
    const src = String(pattern || '').trim();
    if (!src) throw new Error('规则为空');

    const delimited = /^\/(.*)\/([gimsuy]*)$/s.exec(src);
    const [body, flags] = delimited ? [delimited[1], delimited[2] || 'g'] : [src, 'g'];
    try {
        return new RegExp(body, flags.includes('g') ? flags : flags + 'g');
    } catch (e) {
        throw new Error(`正则语法错误：${e.message}`);
    }
}

/** ST 风格的 {{match}} 宏，以及 $1..$9 反向引用（导入的 ST 正则大量使用）。 */
function expandReplacement(replace, matched, groups) {
    return String(replace ?? '')
        .replace(/\{\{match\}\}/gi, matched)
        .replace(/\$(\d)/g, (_, i) => groups[Number(i) - 1] ?? '');
}

/** replace 回调的尾参是 offset、string，带命名组时还多一个对象。 */
function captureGroups(args) {
    const last = args[args.length - 1];
    const hasNamed = last !== null && typeof last === 'object';
    return args.slice(1, hasNamed ? -3 : -2);
}

function trimAway(text, trimStrings) {
    return (trimStrings || []).reduce(
        (acc, s) => (s ? acc.split(s).join('') : acc),
        text,
    );
}

/**
 * 应用单条规则。
 * @returns {string}
 */
export function applyEntry(text, entry) {
    const re = toRegExp(entry.find);
    return text.replace(re, (...args) => {
        const replaced = expandReplacement(entry.replace, args[0], captureGroups(args));
        return trimAway(replaced, entry.trimStrings);
    });
}

/**
 * 按顺序应用全部启用的规则。
 * 单条规则出错不中断整条管线——用户往往有十几条规则，
 * 一条写错就整段不朗读是最难排查的失败方式。
 *
 * @param {string} text
 * @param {Array<object>} entries
 * @param {number} [placement] 只应用作用于该位置的规则
 * @returns {{text: string, errors: Array<{name: string, message: string}>}}
 */
export function applyAll(text, entries, placement = Placement.AI_OUTPUT) {
    const errors = [];
    let output = String(text ?? '');

    for (const entry of entries || []) {
        if (!entry.enabled) continue;
        if (placement && !entry.placement?.includes(placement)) continue;
        if (!inspect(entry.find).safe) {
            errors.push({ name: entry.name, message: '规则存在回溯风险，已跳过' });
            continue;
        }
        try {
            output = applyEntry(output, entry);
        } catch (e) {
            errors.push({ name: entry.name, message: e.message });
        }
    }
    return { text: output, errors };
}

/** 逐条给出中间结果，供调试面板展示「哪一步把文本吃掉了」。 */
export function applyWithTrace(text, entries, placement = Placement.AI_OUTPUT) {
    const steps = [];
    let output = String(text ?? '');

    for (const entry of entries || []) {
        if (!entry.enabled) continue;
        if (placement && !entry.placement?.includes(placement)) continue;
        const before = output;
        let error = '';
        try {
            output = applyEntry(output, entry);
        } catch (e) {
            error = e.message;
        }
        steps.push({ name: entry.name, before, after: output, changed: before !== output, error });
    }
    return { text: output, steps };
}
