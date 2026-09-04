import { Placement } from '../core/constants.js';

/**
 * 正则条目。
 * 内部使用直白命名，与 SillyTavern 正则脚本格式的转换集中在本文件，
 * 其余模块不需要知道 ST 那套 disabled / scriptName 的反向命名。
 */

export const DEFAULT_ENTRY = {
    id: '',
    name: '新建规则',
    enabled: true,
    find: '',
    replace: '',
    trimStrings: [],
    placement: [Placement.AI_OUTPUT],
};

let counter = 0;

export function createEntry(overrides = {}) {
    counter += 1;
    return { ...DEFAULT_ENTRY, id: `rx_${Date.now()}_${counter}`, ...overrides };
}

/** 从 SillyTavern 正则脚本 JSON 导入；格式不符时返回 null。 */
export function fromStFormat(json) {
    if (!json || typeof json.findRegex !== 'string') return null;
    return createEntry({
        id: json.id || undefined,
        name: json.scriptName || '导入的规则',
        enabled: json.disabled !== true,
        find: json.findRegex,
        replace: json.replaceString || '',
        trimStrings: Array.isArray(json.trimStrings) ? json.trimStrings : [],
        placement: Array.isArray(json.placement) ? json.placement : [Placement.AI_OUTPUT],
    });
}

export function toStFormat(entry) {
    return {
        id: entry.id,
        scriptName: entry.name,
        disabled: !entry.enabled,
        findRegex: entry.find,
        replaceString: entry.replace,
        trimStrings: entry.trimStrings,
        placement: entry.placement,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
        markdownOnly: true,
        promptOnly: false,
    };
}

/** 批量导入：接受单个对象或数组，过滤掉无法识别的项。 */
export function importEntries(raw) {
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map(fromStFormat).filter(Boolean);
}
