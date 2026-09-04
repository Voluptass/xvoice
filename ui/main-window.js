import { createFloatingPanel } from './floating.js';
import { mountPlayerTab } from './tab-player.js';
import { mountReadTab } from './tab-read.js';
import { mountVoiceTab } from './tab-voice.js';
import { mountRegexTab } from './tab-regex.js';
import { mountAssistantTab } from './tab-assistant.js';

/**
 * 主浮窗：播放、全部设置、AI 助手都在这一个窗口里切页签，
 * 不用在浮窗和酒馆设置栏之间来回跳。
 */

const TABS = [
    { id: 'player', label: '播放器', mount: (pane, ctx) => mountPlayerTab(pane, ctx) },
    { id: 'assistant', label: 'AI 助手', mount: (pane) => mountAssistantTab(pane) },
    { id: 'voice', label: '音色', mount: (pane) => mountVoiceTab(pane) },
    { id: 'regex', label: '正则', mount: (pane) => mountRegexTab(pane) },
    { id: 'read', label: '朗读', mount: (pane, ctx) => mountReadTab(pane, ctx) },
];

function shellHtml() {
    const nav = TABS.map((t, i) =>
        `<button class="xvoice-tab${i ? '' : ' active'}" data-wtab="${t.id}">${t.label}</button>`).join('');
    const panes = TABS.map((t, i) =>
        `<section class="xvoice-wpane" data-wpane="${t.id}"${i ? ' hidden' : ''}></section>`).join('');
    return `<nav class="xvoice-tabs xvoice-wtabs">${nav}</nav>${panes}`;
}

function activate(body, id) {
    body.querySelectorAll('.xvoice-tab')
        .forEach((el) => el.classList.toggle('active', el.dataset.wtab === id));
    body.querySelectorAll('.xvoice-wpane')
        .forEach((el) => { el.hidden = el.dataset.wpane !== id; });
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
            TABS.forEach((tab) => mountTab(tab, body, ctx));
        },
    });

    return {
        close: win.close,
        open: (tab) => {
            win.open();
            if (tab && body) activate(body, tab);
        },
    };
}
