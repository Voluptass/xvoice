import { createFloatingPanel } from './floating.js';
import { mountPlayerTab } from './tab-player.js';
import { mountReadTab } from './tab-read.js';
import { mountVoiceTab } from './tab-voice.js';
import { mountRegexTab } from './tab-regex.js';
import { mountAssistantTab } from './tab-assistant.js';
import { icon } from './icons.js';

/**
 * 主浮窗：播放、全部设置、AI 助手都在这一个窗口里切页签，
 * 不用在浮窗和酒馆设置栏之间来回跳。
 */

const TABS = [
    { id: 'player', label: '播放器', icon: 'headphones', mount: (pane, ctx) => mountPlayerTab(pane, ctx) },
    { id: 'assistant', label: 'AI 助手', icon: 'wand-magic-sparkles', mount: (pane) => mountAssistantTab(pane) },
    { id: 'voice', label: '音色', icon: 'microphone-lines', mount: (pane) => mountVoiceTab(pane) },
    { id: 'regex', label: '正则', icon: 'filter', mount: (pane) => mountRegexTab(pane) },
    { id: 'read', label: '朗读', icon: 'gear', mount: (pane, ctx) => mountReadTab(pane, ctx) },
];

function shellHtml() {
    const nav = TABS.map((t, i) =>
        `<button class="xvoice-tab${i ? '' : ' active'}" role="tab" id="xv-tab-${t.id}"
            aria-controls="xv-pane-${t.id}" aria-selected="${i ? 'false' : 'true'}" tabindex="${i ? '-1' : '0'}"
            data-wtab="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join('');
    const panes = TABS.map((t, i) =>
        `<section class="xvoice-wpane" id="xv-pane-${t.id}" role="tabpanel" aria-labelledby="xv-tab-${t.id}"
            tabindex="0" data-wpane="${t.id}"${i ? ' hidden' : ''}></section>`).join('');
    return `<nav class="xvoice-tabs xvoice-wtabs" role="tablist" aria-label="xvoice 功能页">${nav}</nav>${panes}`;
}

function activate(body, id, focus = false) {
    body.querySelectorAll('.xvoice-tab').forEach((el) => {
        const on = el.dataset.wtab === id;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', String(on));
        el.tabIndex = on ? 0 : -1;
        if (on && focus) el.focus();
    });
    body.querySelectorAll('.xvoice-wpane')
        .forEach((el) => { el.hidden = el.dataset.wpane !== id; });
}

/** 左右方向键在页签间移动，Home/End 跳到首尾——标准的 tablist 键盘约定。 */
function bindTabKeys(body) {
    body.querySelector('.xvoice-wtabs').addEventListener('keydown', (event) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        const tabs = [...body.querySelectorAll('.xvoice-tab')];
        const current = tabs.findIndex((t) => t.classList.contains('active'));
        let next = current;
        if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        event.preventDefault();
        activate(body, tabs[next].dataset.wtab, true);
    });
}

/** 单个页签挂载失败只废掉该页，并把原因写在页面上而不是留白。 */
function mountTab(tab, body, ctx) {
    const pane = body.querySelector(`[data-wpane="${tab.id}"]`);
    try {
        tab.mount(pane, ctx);
    } catch (e) {
        console.error(`[xvoice] 「${tab.label}」初始化失败:`, e);
        pane.innerHTML = `<p class="xvoice-error">「${tab.label}」初始化失败：${e.message}<br>
            请打开浏览器控制台（F12）把红色报错发给作者。</p>`;
    }
}

/** @returns {{open: (tab?: string) => void, close: Function}} */
export function createMainWindow() {
    let body = null;
    const win = createFloatingPanel({
        title: 'xvoice',
        onFirstOpen: (el) => {
            body = el;
            body.innerHTML = shellHtml();
            const ctx = { activate: (id) => activate(body, id) };
            body.addEventListener('click', (event) => {
                const id = event.target.closest('[data-wtab]')?.dataset.wtab;
                if (id) activate(body, id);
            });
            bindTabKeys(body);
            TABS.forEach((tab) => mountTab(tab, body, ctx));
        },
    });

    return {
        close: win.close,
        open: (tab) => {
            // 先切到目标页签再打开，focusFirst 才知道该把焦点送给哪个可见页
            if (body && tab) {
                activate(body, tab);
                win.open();
            } else {
                win.open();
            }
        },
    };
}
