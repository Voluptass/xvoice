import { eventSource, event_types } from '../../../../../script.js';
import { player, onPipelineEvent, speak, speakScript, prepare, voiceFor } from '../core/pipeline.js';
import { direct } from '../core/director.js';
import { State } from '../player/player.js';
import { recentMessages, messageAt, lastCharacterMessage } from '../core/chat-source.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { parseDialogue } from '../core/text.js';
import { speakHandy } from './hotkey.js';
import { escapeHtml } from './form.js';
import { ICON } from './icons.js';

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
    if (state === State.PLAYING) return ICON.pause;
    if (state === State.LOADING) return ICON.spinner;
    return ICON.play;
}

function playLabel(state) {
    if (state === State.PLAYING) return '暂停';
    if (state === State.PAUSED) return '继续';
    return '播放';
}

/** 这一段的说话人用了哪个音色，鼠标悬停就能看到，方便排查配错音色。 */
function voiceTag(speaker) {
    if (!speaker) return '';
    const override = voiceFor(speaker);
    const voiceId = override ? (override.voiceId || override.voice || '') : '';
    return ` title="角色：${escapeHtml(speaker)} · 音色：${escapeHtml(voiceId || '默认')}"`;
}

function lineHtml(chunk, i, current) {
    const cls = i === current ? 'xvoice-line xvoice-line-active' : 'xvoice-line';
    const who = chunk.speaker
        ? `<span class="xvoice-line-who"${voiceTag(chunk.speaker)}>${escapeHtml(chunk.speaker)}</span>`
        : '';
    return `<button type="button" class="${cls}" data-line="${i}" aria-current="${i === current}">
        <span class="xvoice-line-no">${i + 1}</span>
        ${who}
        <span class="xvoice-line-text">${escapeHtml(chunk.text)}</span>
    </button>`;
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
    return `<button type="button" class="${cls}" data-msg="${msg.id}" title="点击朗读这条">
        <span class="xvoice-pick-name">${escapeHtml(msg.name)}</span>
        <span class="xvoice-pick-text">${escapeHtml(previewOf(msg.text))}</span>
    </button>`;
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
            <button class="menu_button" data-pl="direct" title="让 AI 把最近一条角色回复拆成台本，按角色分音色朗读">${ICON.director} AI 导演</button>
            <button class="menu_button" data-pl="extract" title="本地快速提取引号里的对白，不调用 AI">${ICON.extract} 提取对话</button>
            <span class="xvoice-status" data-pl-director></span>
        </div>
        <div class="xvoice-player-bar">
            <button class="menu_button" data-pl="prev" title="上一段" aria-label="上一段">${ICON.prev}</button>
            <button class="menu_button xvoice-play-btn" data-pl="toggle" title="播放 / 暂停" aria-label="播放">${ICON.play}</button>
            <button class="menu_button" data-pl="next" title="下一段" aria-label="下一段">${ICON.next}</button>
            <button class="menu_button" data-pl="restart" title="从头播放" aria-label="从头播放">${ICON.restart}</button>
            <button class="menu_button" data-pl="stop" title="停止" aria-label="停止">${ICON.stop}</button>
        </div>
        <div class="xvoice-progress" data-pl-progress role="progressbar"
            aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="xvoice-progress-fill" data-pl-progress-fill></div>
        </div>
        <div class="xvoice-player-meta">
            <span class="xvoice-player-status" data-pl-status>未在播放</span>
            <label class="xvoice-vol" title="音量">
                <i class="fa-solid fa-volume-low" aria-hidden="true"></i>
                <input type="range" min="0" max="1" step="0.05" data-pl-vol aria-label="音量">
                <i class="fa-solid fa-volume-high" aria-hidden="true"></i>
            </label>
        </div>
        <div class="xvoice-lines" data-pl-lines></div>
        <div class="xvoice-extract-result" data-pl-extract style="display:none"></div>`;
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
        const on = i === index;
        el.classList.toggle('xvoice-line-active', on);
        el.setAttribute('aria-current', String(on));
    });
}

function scrollToActive(box) {
    box.querySelector('.xvoice-line-active')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function update(pane, snapshot) {
    const { state, index, chunks } = snapshot;
    const total = chunks.length;
    pane.querySelector('[data-pl-status]').textContent = statusText(snapshot);

    const playBtn = pane.querySelector('.xvoice-play-btn');
    playBtn.innerHTML = playIcon(state);
    playBtn.setAttribute('aria-label', playLabel(state));

    const percent = total && index >= 0 ? Math.round(((index + 1) / total) * 100) : 0;
    pane.querySelector('[data-pl-progress-fill]').style.width = `${percent}%`;
    pane.querySelector('[data-pl-progress]').setAttribute('aria-valuenow', String(percent));

    const box = pane.querySelector('[data-pl-lines]');
    renderLines(box, chunks, index);
    if (index >= 0) scrollToActive(box);
    // 导演和提取对话按钮不依赖已有分段，别跟着播放控件一起禁用
    pane.querySelectorAll('[data-pl]:not([data-pl="direct"]):not([data-pl="extract"])').forEach((btn) => {
        btn.disabled = !chunks.length;
    });
}

/** 音量即时生效，松手才落盘，避免拖动时反复写配置。 */
function bindVolume(pane) {
    const slider = pane.querySelector('[data-pl-vol]');
    slider.addEventListener('input', () => {
        const value = Number(slider.value);
        getSettings().playback.volume = value;
        player.setVolume(value);
    });
    slider.addEventListener('change', () => saveSettings());
    return () => { slider.value = String(getSettings().playback.volume ?? 1); };
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

/** 本地提取：不调用 AI，瞬间出结果，只列出引号里的对白供核对。 */
function runExtract(pane) {
    const resultBox = pane.querySelector('[data-pl-extract]');
    const btn = pane.querySelector('[data-pl="extract"]');
    if (btn.disabled) return;
    resultBox.style.display = 'block';
    resultBox.classList.remove('xvoice-error');

    const lines = localDialogue();
    if (!lines.length) {
        resultBox.textContent = lastCharacterMessage()
            ? '没找到引号里的对白。排版复杂的话，点「AI 导演」让模型来拆。'
            : '当前聊天里还没有角色回复。';
        return;
    }
    const cast = [...new Set(lines.map((l) => l.speaker))];
    resultBox.innerHTML = `<div class="xvoice-extract-status">
            <span>本地提取 ${lines.length} 句 · ${escapeHtml(cast.join('、'))}</span>
            <button type="button" class="menu_button" data-extract-play>朗读</button>
        </div>
        ${lines.map(extractLineHtml).join('')}`;
}

/** 用已保存的角色音色朗读提取结果；没配过的角色用默认音色。 */
function playExtracted(pane) {
    const lines = localDialogue();
    if (!lines.length) return;
    const status = pane.querySelector('[data-pl-director]');
    status.classList.remove('xvoice-error');
    status.textContent = `${lines.length} 句 · 用已配音色朗读`;
    speakScript(lines);
}

const ACTIONS = {
    toggle: () => (player.chunks.length ? player.toggle() : speakHandy()),
    prev: () => player.prev(),
    next: () => player.next(),
    restart: () => player.restart(),
    stop: () => player.stop(),
};

/** 本地提取：不调用 AI，瞬间出结果。 */
function localDialogue() {
    const raw = lastCharacterMessage();
    if (!raw) return [];
    // 显式关掉「只念引号」：否则正文已被抽成纯文本，拿不到引号和说话人
    const { cleaned } = prepare(raw, { quotedOnly: false });
    return parseDialogue(cleaned);
}

function extractLineHtml(line) {
    return `<div class="xvoice-extract-line">
        <span class="xvoice-extract-speaker">${escapeHtml(line.speaker)}</span>
        <span class="xvoice-extract-text">${escapeHtml(line.text)}</span>
    </div>`;
}

export function mountPlayerTab(pane) {
    pane.innerHTML = paneHtml();
    renderPicker(pane);
    const syncVolume = bindVolume(pane);
    syncVolume();

    pane.addEventListener('click', (event) => {
        if (event.target.closest('[data-extract-play]')) return playExtracted(pane);

        const msgId = event.target.closest('[data-msg]')?.dataset.msg;
        if (msgId !== undefined) return speak(messageAt(msgId));

        const act = event.target.closest('[data-pl]')?.dataset.pl;
        if (act === 'direct') return runDirector(pane);
        if (act === 'extract') return runExtract(pane);
        if (act) return ACTIONS[act]?.();

        const line = event.target.closest('.xvoice-line')?.dataset.line;
        if (line !== undefined) player.seek(Number(line));
    });

    onPipelineEvent((ev, payload) => {
        if (ev === 'player') update(pane, payload);
    });

    document.addEventListener('xvoice:settings-changed', syncVolume);

    // 新消息进来时刷新点播列表，否则列表永远停在打开浮窗那一刻
    [event_types.MESSAGE_RENDERED, event_types.CHARACTER_MESSAGE_RENDERED, event_types.CHAT_CHANGED]
        .filter(Boolean)
        .forEach((evt) => eventSource.on(evt, () => renderPicker(pane)));

    update(pane, { state: player.state, index: player.index, chunks: player.chunks });
}
