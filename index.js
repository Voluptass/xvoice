import { getSettings } from './core/settings.js';
import { onPipelineEvent } from './core/pipeline.js';
import { initAutoRead } from './core/auto-read.js';
import { initMessageButtons, clearActiveState } from './ui/message-button.js';
import { initSelectionPopup } from './ui/selection.js';
import { initSlashCommands } from './ui/slash.js';
import { initHotkey } from './ui/hotkey.js';
import { initPanel } from './ui/panel.js';

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

jQuery(async () => {
    try {
        getSettings();
        bindFeedback();
        await initPanel();
        initMessageButtons();
        initSelectionPopup();
        initAutoRead();
        initHotkey();
        await initSlashCommands();
        console.log('[xvoice] 初始化完成');
    } catch (e) {
        console.error('[xvoice] 初始化失败:', e);
        notify('error', `初始化失败：${e.message}`);
    }
});
