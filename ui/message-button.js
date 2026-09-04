import { eventSource, event_types } from '../../../../../script.js';
import { speak, stop } from '../core/pipeline.js';
import { messageAt } from '../core/chat-source.js';

const BTN_CLASS = 'xvoice-speak-btn';

function buildButton() {
    const btn = document.createElement('div');
    btn.className = `${BTN_CLASS} mes_button fa-solid fa-volume-high interactable`;
    btn.title = 'xvoice 朗读本条消息';
    btn.tabIndex = 0;
    return btn;
}

function injectInto(messageEl) {
    const container = messageEl.querySelector('.mes_buttons');
    if (!container || container.querySelector(`.${BTN_CLASS}`)) return;
    container.prepend(buildButton());
}

/** 朗读原始 mes 文本而非渲染后的 DOM，避免 markdown 渲染结果干扰正则。 */
function textOfMessage(messageEl) {
    return messageAt(messageEl.getAttribute('mesid'))
        || messageEl.querySelector('.mes_text')?.innerText
        || '';
}

function onChatClick(event) {
    const btn = event.target.closest(`.${BTN_CLASS}`);
    if (!btn) return;
    const messageEl = btn.closest('.mes');
    if (!messageEl) return;
    event.stopPropagation();

    if (btn.classList.contains('xvoice-active')) {
        stop();
        return;
    }
    document.querySelectorAll(`.${BTN_CLASS}.xvoice-active`)
        .forEach((el) => el.classList.remove('xvoice-active'));
    btn.classList.add('xvoice-active');
    speak(textOfMessage(messageEl));
}

function injectAll() {
    document.querySelectorAll('#chat .mes').forEach(injectInto);
}

export function initMessageButtons() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    chatEl.addEventListener('click', onChatClick);
    injectAll();

    [event_types.MESSAGE_RENDERED, event_types.CHAT_CHANGED, event_types.MESSAGE_SWIPED]
        .filter(Boolean)
        .forEach((evt) => eventSource.on(evt, injectAll));
}

/** 播放结束或停止时清掉高亮。 */
export function clearActiveState() {
    document.querySelectorAll(`.${BTN_CLASS}.xvoice-active`)
        .forEach((el) => el.classList.remove('xvoice-active'));
}
