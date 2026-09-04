import { createMainWindow } from './main-window.js';

/**
 * 扩展在酒馆里只保留两个入口，全部界面都在浮窗内：
 *   1. 扩展设置栏的一个按钮
 *   2. 魔法棒扩展菜单的一项
 */

function entryHtml() {
    return `<div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>xvoice 语音朗读</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <button class="menu_button xvoice-open-btn" data-xv-open>打开 xvoice 面板</button>
            <small class="xvoice-hint">播放、音色、正则、AI 助手都在面板里。也可以从右上角魔法棒菜单打开。</small>
        </div>
    </div>`;
}

/** 魔法棒扩展菜单里放一个入口，聊天时随手可点。 */
function injectMenuEntry(onClick) {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const item = document.createElement('div');
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-headphones extensionsMenuExtensionButton"></div>'
        + '<span>xvoice 语音朗读</span>';
    item.addEventListener('click', onClick);
    menu.append(item);
}

export async function initPanel() {
    const win = createMainWindow();

    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (host) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = entryHtml();
        wrapper.querySelector('[data-xv-open]').addEventListener('click', () => win.open('player'));
        host.append(wrapper.firstElementChild);
    }

    injectMenuEntry(() => win.open('player'));
    return win;
}
