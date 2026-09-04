import { speak, player } from '../core/pipeline.js';
import { lastCharacterMessage, selectedText } from '../core/chat-source.js';

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA']);

function isTyping(target) {
    return TYPING_TAGS.has(target?.tagName) || target?.isContentEditable;
}

/**
 * 朗读「手头这段」：选中了就念选中的，否则念最后一条角色消息。
 * 已经在播时按同一个键是暂停/继续——丢掉进度不是用户按这个键的本意。
 */
export function speakHandy() {
    if (player.active) return player.toggle();
    const text = selectedText() || lastCharacterMessage();
    if (!text) return;
    speak(text);
}

/** Alt+R：全局朗读快捷键。在输入框里打字时不拦截。 */
export function initHotkey() {
    document.addEventListener('keydown', (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key.toLowerCase() !== 'r') return;
        if (isTyping(event.target)) return;
        event.preventDefault();
        speakHandy();
    });
}
