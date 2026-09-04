import { getSettings, saveSettings } from '../core/settings.js';
import { renderFields, bindFields } from './form.js';
import { speak } from '../core/pipeline.js';
import { speakHandy } from './hotkey.js';

const READ_FIELDS = [
    { key: 'autoRead', label: '自动朗读角色新消息', type: 'checkbox' },
    { key: 'volume', label: '音量', type: 'number', min: 0, max: 1, step: 0.1 },
    { key: 'chunkSize', label: '分段长度', type: 'number', min: 50, max: 2000, hint: '越小越快出声，越大越连贯' },
    { key: 'quotedOnly', label: '只朗读引号内的对白', type: 'checkbox' },
    { key: 'stripEmoji', label: '过滤表情符号', type: 'checkbox' },
    { key: 'stripUrl', label: '过滤网址', type: 'checkbox' },
];

function paneHtml() {
    return `${renderFields(READ_FIELDS)}
        <div class="xvoice-row">
            <button class="menu_button" data-act="player">去播放器</button>
            <button class="menu_button" data-act="last">朗读最新消息</button>
            <button class="menu_button" data-act="preview">试听</button>
        </div>
        <small class="xvoice-hint">快捷键 Alt+R：有选中就念选中的，没有就念最新一条；播放中按则暂停/继续。
        也可以点消息右上角的喇叭，或用 /xvoice 文本 命令。</small>`;
}

export function mountReadTab(pane, ctx) {
    pane.innerHTML = paneHtml();
    const refresh = bindFields(pane, READ_FIELDS, () => getSettings().playback, saveSettings);
    document.addEventListener('xvoice:settings-changed', refresh);

    pane.addEventListener('click', (event) => {
        const act = event.target.closest('[data-act]')?.dataset.act;
        if (act === 'player') ctx.activate('player');
        if (act === 'last') speakHandy();
        if (act === 'preview') speak('这是一段试听文本，用来确认音色和语速是否合适。');
    });
}
