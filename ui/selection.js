import { speak } from '../core/pipeline.js';

const POPUP_ID = 'xvoice-selection-popup';
const MIN_LENGTH = 2;

function removePopup() {
    document.getElementById(POPUP_ID)?.remove();
}

function createPopup(x, y, text) {
    const el = document.createElement('div');
    el.id = POPUP_ID;
    el.className = 'xvoice-selection-popup';
    el.innerHTML = '<i class="fa-solid fa-volume-high"></i> 朗读';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removePopup();
        speak(text);
    });
    return el;
}

function currentSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (text.length < MIN_LENGTH || !selection.rangeCount) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text, rect };
}

function onMouseUp(event) {
    if (event.target.closest(`#${POPUP_ID}`)) return;
    removePopup();
    const picked = currentSelection();
    if (!picked) return;
    const { rect, text } = picked;
    document.body.append(createPopup(rect.left + rect.width / 2, rect.top - 36, text));
}

/** 选中任意文本后浮出朗读按钮，覆盖「朗读用户指定内容」这个主场景。 */
export function initSelectionPopup() {
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('scroll', removePopup, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') removePopup();
    });
}
