/**
 * 自适应面板：宽屏是可拖拽浮窗，窄屏变底部抽屉。
 *
 * 断点 600px——酒馆移动端 UI 切换在 768px 左右，
 * 但很多折叠屏展开后有 700px，600 能精确兜住纯手机。
 *
 * 底部抽屉：全宽、从底部滑入、占屏高 85%、向下拽关闭。
 * 浮窗模式：和之前一样，可拖拽、位置持久化。
 */

import { icon } from './icons.js';

const POSITION_KEY = 'xvoice-panel-pos';
const MOBILE_BP = 600;
const SHEET_MAX = 0.88;
const DISMISS_THRESHOLD = 80;

// ── 工具函数 ────────────────────────────────────

function isMobile() {
    return window.innerWidth < MOBILE_BP;
}

/**
 * 触摸设备（手机 / 平板）。在这类设备上聚焦输入框会弹出软键盘，
 * 所以选择弹窗只给鼠标设备自动聚焦搜索框。
 */
export function isTouchDevice() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function viewportSize() {
    const viewport = window.visualViewport;
    const layoutWidth = window.innerWidth || document.documentElement.clientWidth;
    const layoutHeight = window.innerHeight || document.documentElement.clientHeight;
    return {
        width: viewport && viewport.width ? viewport.width : layoutWidth,
        height: viewport && viewport.height ? viewport.height : layoutHeight,
        offsetLeft: viewport && viewport.offsetLeft ? viewport.offsetLeft : 0,
        offsetTop: viewport && viewport.offsetTop ? viewport.offsetTop : 0,
    };
}

function syncViewportVars(root) {
    const { width, height, offsetLeft, offsetTop } = viewportSize();
    root.style.setProperty('--xvoice-viewport-width', `${Math.round(width)}px`);
    root.style.setProperty('--xvoice-viewport-height', `${Math.round(height)}px`);
    root.style.setProperty('--xvoice-sheet-height', `${Math.round(height * SHEET_MAX)}px`);
    root.style.setProperty('--xvoice-sheet-min-height', `${Math.round(Math.min(280, height * 0.5))}px`);
    root.style.setProperty('--xvoice-viewport-left', `${Math.round(offsetLeft)}px`);
    root.style.setProperty('--xvoice-viewport-top', `${Math.round(offsetTop)}px`);
}

function loadPosition() {
    try { return JSON.parse(localStorage.getItem(POSITION_KEY)) || null; } catch { return null; }
}

function savePosition(root) {
    const { left, top, width, height } = root.style;
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top, width, height }));
}

// ── 桌面：拖拽 ──────────────────────────────────

function clampIntoView(root) {
    const rect = root.getBoundingClientRect();
    const { width, height, offsetLeft, offsetTop } = viewportSize();
    const minLeft = Math.max(0, offsetLeft);
    const minTop = Math.max(0, offsetTop);
    root.style.left = `${Math.max(minLeft, Math.min(rect.left, offsetLeft + width - Math.min(rect.width, 200)))}px`;
    root.style.top = `${Math.max(minTop, Math.min(rect.top, offsetTop + height - 40))}px`;
}

function makeDraggable(root, handle) {
    let origin = null;
    const cap = (fn, id) => { try { fn.call(handle, id); } catch { /* 忽略 */ } };

    handle.addEventListener('pointerdown', (e) => {
        if (isMobile() || e.target.closest('button')) return;
        const rect = root.getBoundingClientRect();
        origin = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
        cap(handle.setPointerCapture, e.pointerId);
        e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!origin) return;
        root.style.left = `${origin.left + e.clientX - origin.x}px`;
        root.style.top = `${origin.top + e.clientY - origin.y}px`;
    });
    handle.addEventListener('pointerup', (e) => {
        if (!origin) return;
        origin = null;
        cap(handle.releasePointerCapture, e.pointerId);
        clampIntoView(root);
        savePosition(root);
    });
}

// ── 移动端：向下拽关闭 ─────────────────────────

function makeSwipeDismiss(root, handle, onClose) {
    let startY = null;
    let offsetY = 0;

    handle.addEventListener('pointerdown', (e) => {
        if (!isMobile()) return;
        startY = e.clientY;
        offsetY = 0;
        root.style.transition = 'none';
        cap(handle.setPointerCapture, e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
        if (startY === null) return;
        offsetY = Math.max(0, e.clientY - startY);
        root.style.transform = `translateY(${offsetY}px)`;
    });
    handle.addEventListener('pointerup', (e) => {
        if (startY === null) return;
        startY = null;
        root.style.transition = '';
        if (offsetY > DISMISS_THRESHOLD) {
            onClose();
        }
        root.style.transform = '';
        offsetY = 0;
        cap(handle.releasePointerCapture, e.pointerId);
    });

    const cap = (fn, id) => { try { fn.call(handle, id); } catch { /* 忽略 */ } };
}

// ── 遮罩层 ──────────────────────────────────────

function createBackdrop(onTap) {
    const el = document.createElement('div');
    el.className = 'xvoice-backdrop';
    el.addEventListener('click', onTap);
    return el;
}

// ── 构建外壳 ────────────────────────────────────

function buildShell(title) {
    const root = document.createElement('div');
    root.className = 'xvoice-float';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', title);
    root.tabIndex = -1;
    root.innerHTML = `
        <div class="xvoice-float-bar" title="拖动可移动窗口">
            <div class="xvoice-sheet-handle"></div>
            <span class="xvoice-float-title">${title}</span>
            <button class="xvoice-float-close" title="关闭" aria-label="关闭面板">${icon('xmark')}</button>
        </div>
        <div class="xvoice-float-body"></div>
        <div class="xvoice-resize-grip" aria-hidden="true"></div>`;
    return root;
}

/** 打开时把焦点送进面板：优先当前可见页签里标记了 data-autofocus 的控件，否则落到当前页签。 */
function focusFirst(body) {
    const pane = body.querySelector('.xvoice-wpane:not([hidden])');
    const target = pane?.querySelector('[data-autofocus]')
        || body.querySelector('.xvoice-tab.active')
        || body;
    try { target.focus(); } catch { /* 忽略 */ }
}

// ── 公共接口 ────────────────────────────────────

/**
 * @param {{title: string, onFirstOpen?: (body: HTMLElement) => void, onShow?: () => void}} options
 * @returns {{body: HTMLElement, open: Function, close: Function, toggle: Function}}
 */
export function createFloatingPanel({ title, onFirstOpen, onShow }) {
    const root = buildShell(title);
    const body = root.querySelector('.xvoice-float-body');
    const bar = root.querySelector('.xvoice-float-bar');
    const backdrop = createBackdrop(() => close());
    let mounted = false;
    let lastFocused = null;

    Object.assign(root.style, loadPosition() || { left: '', top: '' });
    syncViewportVars(root);
    document.body.append(root);
    document.body.append(backdrop);
    makeDraggable(root, bar);
    makeSwipeDismiss(root, bar, () => close());

    function applyMode() {
        root.classList.toggle('xvoice-float--mobile', isMobile());
    }

    const close = () => {
        const wasOpen = root.classList.contains('xvoice-float-open');
        root.classList.remove('xvoice-float-open');
        backdrop.classList.remove('xvoice-backdrop-show');
        root.style.transform = '';
        if (wasOpen && lastFocused && document.contains(lastFocused)) {
            try { lastFocused.focus(); } catch { /* 忽略 */ }
        }
        lastFocused = null;
    };

    const open = () => {
        syncViewportVars(root);
        if (!mounted) {
            mounted = true;
            onFirstOpen?.(body);
        }
        if (!root.classList.contains('xvoice-float-open')) {
            lastFocused = document.activeElement;
        }
        applyMode();
        root.classList.add('xvoice-float-open');
        if (isMobile()) {
            backdrop.classList.add('xvoice-backdrop-show');
            // 清掉桌面模式遗留的内联定位，让 CSS 接管
            root.style.left = '';
            root.style.top = '';
        } else {
            backdrop.classList.remove('xvoice-backdrop-show');
            clampIntoView(root);
        }
        focusFirst(body);
        onShow?.();
    };

    root.querySelector('.xvoice-float-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && root.classList.contains('xvoice-float-open')) close();
    });

    const handleViewportChange = () => {
        syncViewportVars(root);
        if (!root.classList.contains('xvoice-float-open')) return;
        applyMode();
        if (isMobile()) {
            backdrop.classList.add('xvoice-backdrop-show');
        } else {
            backdrop.classList.remove('xvoice-backdrop-show');
            clampIntoView(root);
        }
    };
    window.addEventListener('resize', handleViewportChange);
    if (window.visualViewport && window.visualViewport.addEventListener) {
        window.visualViewport.addEventListener('resize', handleViewportChange);
        window.visualViewport.addEventListener('scroll', handleViewportChange);
    }

    return { body, open, close, toggle: () => (root.classList.contains('xvoice-float-open') ? close() : open()) };
}
