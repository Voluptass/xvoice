import { getSettings, saveSettings } from '../core/settings.js';
import { createEntry, importEntries } from '../regex/entry.js';
import { describe } from '../regex/danger.js';
import { trace } from '../core/pipeline.js';
import { escapeHtml } from './form.js';
import { icon } from './icons.js';

const SAMPLE = '<think>让我想想</think>\n“你终于来了。”她放下杯子。\n【状态栏】好感度：+3';

function entries() {
    return getSettings().regex.entries;
}

function entryHtml(entry, index, total) {
    const up = index === 0 ? ' disabled' : '';
    const down = index === total - 1 ? ' disabled' : '';
    return `<div class="xvoice-rule" data-id="${entry.id}">
        <div class="xvoice-rule-head">
            <input type="checkbox" data-f="enabled" ${entry.enabled ? 'checked' : ''}
                title="启用 / 停用" aria-label="启用这条规则">
            <input class="text_pole" data-f="name" value="${escapeHtml(entry.name)}" placeholder="规则名">
            <button type="button" class="xvoice-icon-btn" data-move="up" title="上移（越靠前越先执行）"
                aria-label="上移"${up}>${icon('arrow-up')}</button>
            <button type="button" class="xvoice-icon-btn" data-move="down" title="下移"
                aria-label="下移"${down}>${icon('arrow-down')}</button>
            <button type="button" class="xvoice-del" title="删除" aria-label="删除这条规则">${icon('trash-can')}</button>
        </div>
        <input class="text_pole" data-f="find" placeholder="匹配式，如 /<think>[\\s\\S]*?<\\/think>/g" value="${escapeHtml(entry.find)}">
        <input class="text_pole" data-f="replace" placeholder="替换为（留空即删除）" value="${escapeHtml(entry.replace)}">
        <small class="xvoice-hint xvoice-error" data-warn></small>
    </div>`;
}

function listHtml() {
    const rules = entries();
    if (!rules.length) return '<p class="xvoice-hint">还没有规则。正则的目标是让文本只剩要朗读的正文。</p>';
    return rules.map((e, i) => entryHtml(e, i, rules.length)).join('');
}

function renderTrace(steps) {
    if (!steps.length) return '<p class="xvoice-hint">没有启用中的规则。</p>';
    return steps.map((s) => {
        const state = s.error ? `出错：${escapeHtml(s.error)}`
            : s.changed ? '已改动' : '未匹配';
        const cls = s.error ? 'xvoice-error' : s.changed ? 'xvoice-changed' : '';
        return `<div class="xvoice-step ${cls}"><b>${escapeHtml(s.name)}</b><span>${state}</span></div>`;
    }).join('');
}

function refreshWarnings(root) {
    root.querySelectorAll('.xvoice-rule').forEach((el) => {
        const entry = entries().find((e) => e.id === el.dataset.id);
        el.querySelector('[data-warn]').textContent = entry ? describe(entry.find) : '';
    });
}

function renderList(root) {
    root.querySelector('[data-xv-rules]').innerHTML = listHtml();
    refreshWarnings(root);
}

/** 顺序会影响结果（前面的规则先跑），所以要能调整。 */
function moveEntry(root, id, dir) {
    const list = entries();
    const from = list.findIndex((e) => e.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    saveSettings();
    renderList(root);
}

/** 只在挂载时调用一次；列表内容用事件委托，重渲染不需要重新绑定。 */
function bindList(root) {
    const list = root.querySelector('[data-xv-rules]');

    list.addEventListener('change', (event) => {
        const field = event.target.dataset.f;
        const id = event.target.closest('.xvoice-rule')?.dataset.id;
        if (!field || !id) return;
        const entry = entries().find((e) => e.id === id);
        entry[field] = field === 'enabled' ? event.target.checked : event.target.value;
        saveSettings();
        refreshWarnings(root);
    });

    list.addEventListener('click', (event) => {
        const rule = event.target.closest('.xvoice-rule');
        if (!rule) return;
        const move = event.target.closest('[data-move]')?.dataset.move;
        if (move) return moveEntry(root, rule.dataset.id, move === 'up' ? -1 : 1);
        if (!event.target.closest('.xvoice-del')) return;
        getSettings().regex.entries = entries().filter((e) => e.id !== rule.dataset.id);
        saveSettings();
        renderList(root);
    });
}

function runTest(root) {
    const input = root.querySelector('[data-xv-test-input]').value;
    const { steps, cleaned } = trace(input);
    root.querySelector('[data-xv-test-steps]').innerHTML = renderTrace(steps);
    const out = root.querySelector('[data-xv-test-output]');
    out.value = cleaned;
    out.classList.toggle('xvoice-error', !cleaned.trim());
    root.querySelector('[data-xv-test-count]').textContent =
        `原文 ${input.length} 字 → 朗读 ${cleaned.length} 字`;
}

function importFromClipboard(root) {
    const raw = prompt('粘贴 SillyTavern 正则脚本 JSON：');
    if (!raw) return;
    try {
        const imported = importEntries(JSON.parse(raw));
        if (!imported.length) throw new Error('没有解析出有效规则');
        entries().push(...imported);
        saveSettings();
        renderList(root);
    } catch (e) {
        alert(`导入失败：${e.message}`);
    }
}

export function mountRegexTab(pane) {
    pane.innerHTML = `
        <div class="xvoice-row">
            <button class="menu_button" data-rx="add">${icon('plus')} 新增规则</button>
            <button class="menu_button" data-rx="import">${icon('file-import')} 导入 ST 正则</button>
        </div>
        <small class="xvoice-hint">规则从上到下依次执行，顺序会影响结果。</small>
        <div data-xv-rules class="xvoice-rules"></div>
        <hr>
        <label>测试原文</label>
        <textarea class="text_pole" data-xv-test-input rows="4">${escapeHtml(SAMPLE)}</textarea>
        <div class="xvoice-row">
            <button class="menu_button" data-rx="test">${icon('flask')} 测试</button>
            <span class="xvoice-status" data-xv-test-count></span>
        </div>
        <div data-xv-test-steps class="xvoice-steps"></div>
        <label>朗读时实际使用的文本</label>
        <textarea class="text_pole" data-xv-test-output rows="3" readonly></textarea>`;

    bindList(pane);
    renderList(pane);
    pane.addEventListener('click', (event) => {
        const act = event.target.closest('[data-rx]')?.dataset.rx;
        if (act === 'add') {
            entries().push(createEntry());
            saveSettings();
            renderList(pane);
        }
        if (act === 'import') importFromClipboard(pane);
        if (act === 'test') runTest(pane);
    });
}
