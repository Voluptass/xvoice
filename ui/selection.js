import { speak } from '../core/pipeline.js';

const POPUP_ID = 'xvoice-selection-popup';
const MIN_LENGTH = 2;

let suppressUntil = 0;

function removePopup() {
    document.getElementById(POPUP_ID)?.remove();
}

function isEditable(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function createPopup(x, y, text) {
    const el = document.createElement('button');
    el.id = POPUP_ID;
    el.type = 'button';
    el.className = 'xvoice-selection-popup';
    el.innerHTML = '<i class="fa-solid fa-volume-high" aria-hidden="true"></i> 朗读选中内容';
    el.setAttribute('aria-label', '朗读选中内容');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // 用 mousedown 抢在选区被取消之前触发；随后短暂屏蔽，避免 mouseup 又把它浮出来
    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        suppressUntil = Date.now() + 400;
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

function showForSelection() {
    if (Date.now() < suppressUntil) return;
    removePopup();
    const picked = currentSelection();
    if (!picked) return;
    const { rect, text } = picked;
    // 靠边时把浮标拉回可视区内
    const x = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70);
    const y = Math.max(rect.top - 40, 6);
    document.body.append(createPopup(x, y, text));
}

function shouldIgnore(event) {
    if (Date.now() < suppressUntil) return true;
    const el = event.target;
    return !!(el && el.closest && el.closest(`#${POPUP_ID}`));
}

function onMouseUp(event) {
    if (shouldIgnore(event)) return;
    if (isEditable(event.target)) {
        removePopup();
        return;
    }
    showForSelection();
}

/** 选中任意文本后浮出朗读按钮，覆盖「朗读用户指定内容」这个主场景。 */
export function initSelectionPopup() {
    document.addEventListener('mouseup', onMouseUp);
    // 移动端没有 mouseup，等选区手柄稳定后再浮出
    document.addEventListener('touchend', (event) => {
        if (shouldIgnore(event) || isEditable(event.target)) return;
        setTimeout(showForSelection, 250);
    });
    document.addEventListener('scroll', removePopup, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') removePopup();
    });
}
