import { eventSource, event_types } from '../../../../../script.js';
import { player, onPipelineEvent, speak, speakScript, prepare } from '../core/pipeline.js';
import { direct } from '../core/director.js';
import { State } from '../player/player.js';
import { recentMessages, messageAt } from '../core/chat-source.js';
import { speakHandy } from './hotkey.js';
import { escapeHtml } from './form.js';

const EMPTY_HINT = '还没有朗读内容。<br>在上面挑一条消息，或按 Alt+R 念最新一条。';
const PICK_LIMIT = 12;
const PREVIEW_LEN = 42;

function statusText({ state, index, chunks }) {
    const total = chunks.length;
    const at = `${index + 1} / ${total}`;
    if (state === State.LOADING) return `正在合成第 ${at} 段…`;
    if (state === State.PLAYING) return `播放中 ${at}`;
    if (state === State.PAUSED) return `已暂停 ${at}`;
    return total ? `共 ${total} 段，已停止` : '未在播放';
}

function playIcon(state) {
    if (state === State.PLAYING) return '⏸';
    if (state === State.LOADING) return '…';
    return '▶';
}

function lineHtml(chunk, i, current) {
    const cls = i === current ? 'xvoice-line xvoice-line-active' : 'xvoice-line';
    const who = chunk.speaker
        ? `<span class="xvoice-line-who">${escapeHtml(chunk.speaker)}</span>`
        : '';
    return `<div class="${cls}" data-line="${i}">
        <span class="xvoice-line-no">${i + 1}</span>
        ${who}
        <span class="xvoice-line-text">${escapeHtml(chunk.text)}</span>
    </div>`;
}

/** 预览直接走完整管线，看到的就是会念出来的内容，顺便暴露被正则清空的消息。 */
function previewOf(text) {
    const { cleaned } = prepare(text);
    const flat = cleaned.replace(/\s+/g, ' ').trim();
    if (!flat) return '（按当前设置处理后没有内容）';
    return flat.length > PREVIEW_LEN ? flat.slice(0, PREVIEW_LEN) + '…' : flat;
}

function pickHtml(msg) {
    const cls = msg.isUser ? 'xvoice-pick xvoice-pick-user' : 'xvoice-pick';
    return `<div class="${cls}" data-msg="${msg.id}" title="点击朗读这条">
        <span class="xvoice-pick-name">${escapeHtml(msg.name)}</span>
        <span class="xvoice-pick-text">${escapeHtml(previewOf(msg.text))}</span>
    </div>`;
}

function renderPicker(pane) {
    const box = pane.querySelector('[data-msg-list]');
    if (!box) return;
    const items = recentMessages(PICK_LIMIT);
    box.innerHTML = items.length
        ? items.map(pickHtml).join('')
        : '<p class="xvoice-hint">当前聊天还没有消息。</p>';
}

function paneHtml() {
    return `<details class="xvoice-picker" open>
            <summary>选一条消息朗读</summary>
            <div class="xvoice-msg-list" data-msg-list></div>
        </details>
        <div class="xvoice-row">
            <button class="menu_button" data-pl="direct" title="让 AI 把最近一条角色回复拆成台本，按角色分音色朗读">🎬 AI 导演</button>
            <span class="xvoice-status" data-pl-director></span>
        </div>
        <div class="xvoice-player-bar">
            <button class="menu_button" data-pl="prev" title="上一段">⏮</button>
            <button class="menu_button xvoice-play-btn" data-pl="toggle" title="播放 / 暂停">▶</button>
            <button class="menu_button" data-pl="next" title="下一段">⏭</button>
            <button class="menu_button" data-pl="restart" title="从头播放">↺</button>
            <button class="menu_button" data-pl="stop" title="停止">■</button>
        </div>
        <div class="xvoice-player-status" data-pl-status>未在播放</div>
        <div class="xvoice-lines" data-pl-lines></div>`;
}

/** 只在分段内容变化时重建列表，避免每次状态更新都重绘整份台词。 */
function renderLines(box, chunks, index) {
    const signature = chunks.length + ':' + (chunks[0]?.text || '').slice(0, 20);
    if (box.dataset.sig !== signature) {
        box.dataset.sig = signature;
        box.innerHTML = chunks.length
            ? chunks.map((c, i) => lineHtml(c, i, index)).join('')
            : `<p class="xvoice-hint">${EMPTY_HINT}</p>`;
        return;
    }
    box.querySelectorAll('.xvoice-line').forEach((el, i) => {
        el.classList.toggle('xvoice-line-active', i === index);
    });
}

function scrollToActive(box) {
    box.querySelector('.xvoice-line-active')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function update(pane, snapshot) {
    const { state, index, chunks } = snapshot;
    pane.querySelector('[data-pl-status]').textContent = statusText(snapshot);
    pane.querySelector('.xvoice-play-btn').textContent = playIcon(state);
    const box = pane.querySelector('[data-pl-lines]');
    renderLines(box, chunks, index);
    if (index >= 0) scrollToActive(box);
    // 导演按钮不依赖已有分段，别跟着播放控件一起禁用
    pane.querySelectorAll('[data-pl]:not([data-pl="direct"])').forEach((btn) => {
        btn.disabled = !chunks.length;
    });
}

/** 跑一遍导演流程，把结果写进播放器并直接开演。 */
async function runDirector(pane) {
    const status = pane.querySelector('[data-pl-director]');
    const btn = pane.querySelector('[data-pl="direct"]');
    if (btn.disabled) return;
    btn.disabled = true;
    status.classList.remove('xvoice-error');
    status.textContent = '正在拆台本…';
    try {
        const { lines, cast, missing, mode } = await direct();
        const castText = cast.join('、');
        if (missing.length) {
            status.textContent = mode === 'manual'
                ? `${castText}：还没配音色，去「音色」页签配一下（未配的用默认音色）`
                : `${castText}：${missing.join('、')} 没挑到音色，用默认音色代替`;
        } else {
            status.textContent = `${lines.length} 句 · ${castText}`;
        }
        speakScript(lines);
    } catch (e) {
        status.textContent = e.message;
        status.classList.add('xvoice-error');
    } finally {
        btn.disabled = false;
    }
}

const ACTIONS = {
    toggle: () => (player.chunks.length ? player.toggle() : speakHandy()),
    prev: () => player.prev(),
    next: () => player.next(),
    restart: () => player.restart(),
    stop: () => player.stop(),
};

export function mountPlayerTab(pane) {
    pane.innerHTML = paneHtml();
    renderPicker(pane);

    pane.addEventListener('click', (event) => {
        const msgId = event.target.closest('[data-msg]')?.dataset.msg;
        if (msgId !== undefined) return speak(messageAt(msgId));

        const act = event.target.closest('[data-pl]')?.dataset.pl;
        if (act === 'direct') return runDirector(pane);
        if (act) return ACTIONS[act]?.();

        const line = event.target.closest('.xvoice-line')?.dataset.line;
        if (line !== undefined) player.seek(Number(line));
    });

    onPipelineEvent((ev, payload) => {
        if (ev === 'player') update(pane, payload);
    });

    // 新消息进来时刷新点播列表，否则列表永远停在打开浮窗那一刻
    [event_types.MESSAGE_RENDERED, event_types.CHARACTER_MESSAGE_RENDERED, event_types.CHAT_CHANGED]
        .filter(Boolean)
        .forEach((evt) => eventSource.on(evt, () => renderPicker(pane)));

    update(pane, { state: player.state, index: player.index, chunks: player.chunks });
}
