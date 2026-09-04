import { registerAll } from '../registry.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { createEntry, importEntries, toStFormat } from '../../regex/entry.js';
import { inspect } from '../../regex/danger.js';
import { toRegExp } from '../../regex/apply.js';
import { trace } from '../../core/pipeline.js';

function entries() {
    return getSettings().regex.entries;
}

function findEntry(id) {
    const found = entries().find((e) => e.id === id);
    if (!found) throw new Error(`找不到规则：${id}`);
    return found;
}

/** 写入前统一校验：语法必须合法，且不能有回溯风险。 */
function assertUsable(pattern) {
    toRegExp(pattern);
    const { safe, warnings } = inspect(pattern);
    if (!safe) {
        throw new Error(`规则存在性能风险，已拒绝保存：${warnings.map((w) => w.name).join('、')}`);
    }
}

registerAll([
    {
        id: 'regex.list',
        summary: '列出全部正则规则（含 id、名称、启用状态、匹配式与替换式）',
        handler: () => entries().map(({ id, name, enabled, find, replace }) =>
            ({ id, name, enabled, find, replace })),
    },
    {
        id: 'regex.add',
        summary: '新增一条正则规则，返回新规则的 id',
        mutates: true,
        params: {
            name: '规则名称',
            find: '匹配式，支持 /pattern/flags 或裸模式',
            replace: '替换内容，可用 {{match}} 代表整段命中，默认为空（即删除）',
        },
        handler: ({ name, find, replace = '' }) => {
            assertUsable(find);
            const entry = createEntry({ name: name || '新建规则', find, replace });
            entries().push(entry);
            saveSettings();
            return { id: entry.id };
        },
    },
    {
        id: 'regex.update',
        summary: '修改已有规则的字段（只传需要改的字段）',
        mutates: true,
        params: { id: '规则 id', name: '可选', find: '可选', replace: '可选', enabled: '可选，布尔值' },
        handler: ({ id, ...patch }) => {
            const entry = findEntry(id);
            if (patch.find !== undefined) assertUsable(patch.find);
            Object.assign(entry, patch);
            saveSettings();
            return { id, updated: Object.keys(patch) };
        },
    },
    {
        id: 'regex.remove',
        summary: '删除一条规则',
        mutates: true,
        params: { id: '规则 id' },
        handler: ({ id }) => {
            const list = entries();
            const at = list.findIndex((e) => e.id === id);
            if (at < 0) throw new Error(`找不到规则：${id}`);
            const [removed] = list.splice(at, 1);
            saveSettings();
            return { removed: removed.name };
        },
    },
    {
        id: 'regex.test',
        summary: '用给定文本跑一遍全部规则，逐条返回处理前后的结果，用于定位是哪条规则改动了文本',
        params: { text: '要测试的原文' },
        handler: ({ text }) => {
            if (!text) throw new Error('缺少 text 参数');
            return trace(text);
        },
    },
    {
        id: 'regex.import',
        summary: '导入 SillyTavern 正则脚本 JSON（可以是单个对象或数组）',
        mutates: true,
        params: { json: 'ST 正则脚本的 JSON 字符串或对象' },
        handler: ({ json }) => {
            const raw = typeof json === 'string' ? JSON.parse(json) : json;
            const imported = importEntries(raw);
            if (!imported.length) throw new Error('没有解析出任何有效规则');
            entries().push(...imported);
            saveSettings();
            return { count: imported.length, names: imported.map((e) => e.name) };
        },
    },
    {
        id: 'regex.export',
        summary: '把当前规则导出为 SillyTavern 正则脚本格式',
        handler: () => entries().map(toStFormat),
    },
]);
