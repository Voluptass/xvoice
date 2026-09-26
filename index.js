import { getSettings } from './core/settings.js';
import { onPipelineEvent } from './core/pipeline.js';
import { initAutoRead } from './core/auto-read.js';
import { initMessageButtons, clearActiveState } from './ui/message-button.js';
import { initSelectionPopup } from './ui/selection.js';
import { initSlashCommands } from './ui/slash.js';
import { initHotkey } from './ui/hotkey.js';
import { initPanel } from './ui/panel.js';
import { initAutoReload } from './ui/autoreload.js';

function notify(level, message) {
    if (typeof toastr !== 'undefined') toastr[level](message, 'xvoice');
    else console.log(`[xvoice] ${message}`);
}

function bindFeedback() {
    onPipelineEvent((event, payload) => {
        if (event === 'player') {
            if (payload.state === 'idle') clearActiveState();
            return;
        }
        if (event === 'error') {
            clearActiveState();
            return notify('error', payload?.message || String(payload));
        }
        if (event === 'regexError') {
            const detail = payload.map((e) => `${e.name}：${e.message}`).join('；');
            return notify('warning', `部分正则规则被跳过 —— ${detail}`);
        }
    });
}

/**
 * 生命周期钩子：ST 更新完本扩展后会调用它（见 manifest.json 的 hooks.update）。
 * 时机在「更新完成」提示弹出之前。ST 默认只提示用户手动刷新，
 * 这里替用户刷新一次——留一点时间让 ST 的提示先画出来。
 */
export function onExtensionUpdate() {
    setTimeout(() => location.reload(), 1200);
}

jQuery(async () => {
    try {
        getSettings();
        bindFeedback();
        await initPanel();
        initMessageButtons();
        initSelectionPopup();
        initAutoRead();
        initHotkey();
        initAutoReload();
        await initSlashCommands();
        console.log('[xvoice] 初始化完成');
    } catch (e) {
        console.error('[xvoice] 初始化失败:', e);
        notify('error', `初始化失败：${e.message}`);
    }
});
