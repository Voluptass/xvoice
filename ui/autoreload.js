import { eventSource, event_types } from '../../../../../script.js';

/**
 * 更新后自动刷新的兜底机制，不依赖 ST 版本。
 *
 * 正常路径是 ST 的 update 钩子（见 index.js 与 manifest.json 的 hooks），
 * 但有两个坑：
 *   1. 钩子需要 ST ≥ 1.17.0；
 *   2. ST 只在「安装 / 移动」时重新读取 manifest，更新时用的是页面打开时那份，
 *      所以「第一次引入钩子」的那次更新不会触发它。
 * 因此这里再加一层：盯着扩展入口文件的时间戳，变了就刷新。
 *
 * 触发时机：点扩展面板里的「更新」按钮后就密集轮询（几秒内生效），
 * 平时每 60s、以及切回标签页时检查一次。
 * 生成回复中或输入框有草稿时只提示、不刷新，避免打断用户。
 */

const INTERVAL = 60_000;
const FAST_INTERVAL = 2_000;
const FAST_DURATION = 60_000;
const ENTRY = new URL('../index.js', import.meta.url);
const INPUT_ID = 'send_textarea';

/** 扩展目录名（用于判断点的是不是本扩展的更新按钮）。 */
const FOLDER = (() => {
    const m = /\/extensions\/third-party\/([^/]+)\//.exec(ENTRY.pathname);
    return m ? decodeURIComponent(m[1]) : '';
})();

let generating = false;
let known = null;
let notified = false;
let checking = false;
let reloading = false;
let stampWarned = false;
let fastTimer = null;
let fastUntil = 0;

/** 输入框里有还没发出去的内容。 */
function hasDraft() {
    const input = document.getElementById(INPUT_ID);
    return !!input && input.value.trim().length > 0;
}

/** 取入口文件的版本指纹；拿不到时返回 null，兜底自动失效。 */
async function stamp() {
    const res = await fetch(ENTRY, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    const value = res.headers.get('last-modified') || res.headers.get('etag');
    if (!value && !stampWarned) {
        stampWarned = true;
        console.warn('[xvoice] 入口文件没有 Last-Modified/ETag，'
            + '「更新后自动刷新」的兜底不可用（若 ST ≥ 1.17.0，仍可走 update 钩子）。');
    }
    return value;
}

function toast(message, timeOut) {
    if (typeof toastr !== 'undefined') toastr.info(message, 'xvoice', timeOut ? { timeOut } : undefined);
}

async function check() {
    if (checking || reloading || document.visibilityState === 'hidden') return;
    checking = true;
    try {
        const now = await stamp();
        if (!now) return;
        if (known === null) {
            known = now;
            console.debug('[xvoice] 自动刷新基线:', now);
            return;
        }
        if (now === known) return;

        console.info('[xvoice] 检测到扩展文件已更新');
        // 生成中或用户有草稿就先不刷新，只提醒一下
        if (generating || hasDraft()) {
            if (!notified) {
                notified = true;
                toast('检测到 xvoice 已更新，方便时刷新页面即可生效。', 8000);
            }
            return;
        }

        reloading = true;
        toast('xvoice 已更新，正在刷新页面…');
        setTimeout(() => location.reload(), 1200);
    } catch {
        /* 网络异常忽略，下次再试 */
    } finally {
        checking = false;
    }
}

/** 点了扩展面板里的「更新」按钮后，密集检查一段时间，更新一落地就刷新。 */
function onUpdateClick(event) {
    const btn = event.target?.closest?.('.btn_update');
    if (!btn) return;
    const block = btn.closest('.extension_block');
    const name = block?.getAttribute('data-name') || '';
    if (FOLDER && name && !name.includes(FOLDER)) return;
    startFastPoll();
}

function startFastPoll() {
    fastUntil = Date.now() + FAST_DURATION;
    if (fastTimer) return;
    fastTimer = setInterval(() => {
        if (Date.now() > fastUntil) {
            clearInterval(fastTimer);
            fastTimer = null;
            return;
        }
        check();
    }, FAST_INTERVAL);
}

export function initAutoReload() {
    eventSource.on(event_types.GENERATION_STARTED, () => { generating = true; });
    eventSource.on(event_types.GENERATION_ENDED, () => { generating = false; });
    eventSource.on(event_types.GENERATION_STOPPED, () => { generating = false; });

    document.addEventListener('click', onUpdateClick, true);

    // 先记下当前版本，再定时 / 回到前台时复查
    check();
    setInterval(check, INTERVAL);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        notified = false;
        check();
    });
}
