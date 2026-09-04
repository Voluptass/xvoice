import { chat } from '../../../../../script.js';

/**
 * 从酒馆聊天记录取朗读源文本。
 * 一律用原始 mes 而不是渲染后的 DOM——渲染结果混着 markdown 和 HTML，
 * 正则规则是按原文写的。
 */

function isReadable(message) {
    return !!message && !message.is_user && !message.is_system;
}

/** 按楼层号取文本，取不到返回空串。 */
export function messageAt(id) {
    const index = Number(id);
    return Number.isInteger(index) ? (chat[index]?.mes ?? '') : '';
}

/** 最后一条角色消息（跳过用户发言和系统提示）。 */
export function lastCharacterMessage() {
    for (let i = chat.length - 1; i >= 0; i--) {
        if (isReadable(chat[i])) return chat[i].mes;
    }
    return '';
}

/** 当前选中的文本，没有选中时返回空串。 */
export function selectedText() {
    return window.getSelection()?.toString().trim() ?? '';
}

/**
 * 最近的若干条消息，最新的在前，供播放器里点播。
 * 系统提示不列（那不是给人听的），用户自己的发言保留但会标出来。
 * @returns {Array<{id: number, name: string, isUser: boolean, text: string}>}
 */
export function recentMessages(limit = 12) {
    const out = [];
    for (let i = chat.length - 1; i >= 0 && out.length < limit; i--) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        out.push({
            id: i,
            name: m.name || (m.is_user ? '你' : '角色'),
            isUser: !!m.is_user,
            text: m.mes || '',
        });
    }
    return out;
}
