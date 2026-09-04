import { eventSource, event_types, chat } from '../../../../../script.js';
import { getSettings } from './settings.js';
import { speak } from './pipeline.js';

function shouldRead(message) {
    if (!getSettings().playback.autoRead) return false;
    return !!message && !message.is_user && !message.is_system;
}

function onMessage(id) {
    const message = chat[Number(id)];
    if (shouldRead(message)) speak(message.mes);
}

/**
 * 自动朗读新收到的角色消息。
 * 优先用「渲染完成」事件，此时文本已完整，不会读到流式中途的半句。
 */
export function initAutoRead() {
    const event = event_types.CHARACTER_MESSAGE_RENDERED || event_types.MESSAGE_RECEIVED;
    if (!event) return console.warn('[xvoice] 当前酒馆版本不支持自动朗读所需的事件');
    eventSource.on(event, onMessage);
}
