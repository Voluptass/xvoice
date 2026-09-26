import { eventSource, event_types } from '../../../../../script.js';

/**
 * 更新后自动刷新的兜底机制。
 *
 * 正常路径：ST 的「更新」按钮更新完会调用 manifest 里的 update 钩子（见 index.js），
 * 那里直接刷新页面。但如果是在服务器上手动 `git pull`，不会触发任何钩子，
 * 所以这里再定时问一下服务器：扩展自己的入口文件有没有被换过。
 *
 * 只比对文件时间戳（HEAD 请求的 Last-Modified），开销极小，且只在
 * 「标签页可见 + 没有正在生成回复 + 输入框没有草稿」时才真的刷新，
 * 免得打断用户。
 */

const INTERVAL = 60_000;
const ENTRY = new URL('../index.js', import.meta.url);
const INPUT_ID = 'send_textarea';

let generating = false;
let known = null;
let notified = false;
let checking = false;
let reloading = false;

/** 输入框里有还没发出去的内容。 */
function hasDraft() {
    const input = document.getElementById(INPUT_ID);
    return !!input && input.value.trim().length > 0;
}

/** 取入口文件的版本指纹；服务器不支持时返回 null，功能自动失效。 */
async function stamp() {
    const res = await fetch(ENTRY, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    return res.headers.get('last-modified') || res.headers.get('etag');
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
        if (known === null) { known = now; return; }
        if (now === known) return;

        // 文件变了。生成中或用户有草稿就先不刷新，只提醒一下
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

export function initAutoReload() {
    eventSource.on(event_types.GENERATION_STARTED, () => { generating = true; });
    eventSource.on(event_types.GENERATION_ENDED, () => { generating = false; });
    eventSource.on(event_types.GENERATION_STOPPED, () => { generating = false; });

    // 先记下当前版本，再定时 / 回到前台时复查
    check();
    setInterval(check, INTERVAL);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        notified = false;
        check();
    });
}
