import { getSettings, saveSettings } from '../core/settings.js';
import { createEntry, importEntries } from '../regex/entry.js';
import { describe } from '../regex/danger.js';
import { trace } from '../core/pipeline.js';
import { escapeHtml } from './form.js';

const SAMPLE = '<think>让我想想</think>\n“你终于来了。”她放下杯子。\n【状态栏】好感度：+3';

function entries() {
    return getSettings().regex.entries;
}

function entryHtml(entry) {
    return `<div class="xvoice-rule" data-id="${entry.id}">
        <div class="xvoice-rule-head">
            <input type="checkbox" data-f="enabled" ${entry.enabled ? 'checked' : ''}>
            <input class="text_pole" data-f="name" value="${escapeHtml(entry.name)}">
            <button class="menu_button xvoice-del" title="删除">✕</button>
        </div>
        <input class="text_pole" data-f="find" placeholder="匹配式，如 /<think>[\\s\\S]*?<\\/think>/g" value="${escapeHtml(entry.find)}">
        <input class="text_pole" data-f="replace" placeholder="替换为（留空即删除）" value="${escapeHtml(entry.replace)}">
        <small class="xvoice-hint xvoice-error" data-warn></small>
    </div>`;
}

function listHtml() {
    const rules = entries();
    if (!rules.length) return '<p class="xvoice-hint">还没有规则。正则的目标是让文本只剩要朗读的正文。</p>';
    return rules.map(entryHtml).join('');
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
        if (!event.target.closest('.xvoice-del')) return;
        const id = event.target.closest('.xvoice-rule').dataset.id;
        getSettings().regex.entries = entries().filter((e) => e.id !== id);
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
            <button class="menu_button" data-rx="add">新增规则</button>
            <button class="menu_button" data-rx="import">导入 ST 正则</button>
        </div>
        <div data-xv-rules class="xvoice-rules"></div>
        <hr>
        <label>测试原文</label>
        <textarea class="text_pole" data-xv-test-input rows="4">${escapeHtml(SAMPLE)}</textarea>
        <div class="xvoice-row"><button class="menu_button" data-rx="test">测试</button></div>
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
