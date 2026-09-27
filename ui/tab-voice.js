import { getSettings, saveSettings } from '../core/settings.js';
import { renderFields, bindFields, escapeHtml } from './form.js';
import { listProviders, listVoices, checkReady } from '../tts/index.js';
import { Provider } from '../core/constants.js';
import { player, voiceOverride } from '../core/pipeline.js';
import { getRoleVoices, currentCardLabel } from '../core/cast.js';
import { previewVoice, stopPreview } from './preview.js';
import { createFloatingPanel } from './floating.js';
import { ICON } from './icons.js';
import { eventSource, event_types } from '../../../../../script.js';

const PROVIDER_FIELDS = {
    [Provider.MINIMAX]: [
        { key: 'apiKeys', label: 'API Key（一行一个）', type: 'list', rows: 3, hint: '填多个可在限流时自动轮换' },
        {
            key: 'platform', label: '接入点', type: 'select',
            options: [{ value: 'cn', label: '国内 api.minimaxi.com' }, { value: 'io', label: '海外 api.minimax.io' }],
        },
        { key: 'model', label: '模型', type: 'text' },
        { key: 'voiceId', label: '音色 id', type: 'text', hint: '可点下方按钮拉取账号下全部音色' },
        { key: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1 },
        { key: 'vol', label: '音量增益', type: 'number', min: 0.1, max: 10, step: 0.1 },
        { key: 'pitch', label: '音调', type: 'number', min: -12, max: 12, step: 1 },
        { key: 'emotion', label: '情绪', type: 'text', hint: '留空为自动，可填 happy / sad / angry 等' },
    ],
    [Provider.AZURE]: [
        { key: 'apiKey', label: '语音服务密钥', type: 'password' },
        { key: 'region', label: '区域', type: 'text', hint: '如 eastasia、japaneast' },
        { key: 'voice', label: '音色', type: 'text', hint: '如 zh-CN-XiaoxiaoNeural，可点下方按钮拉取列表' },
        { key: 'rate', label: '语速 %', type: 'number', min: -50, max: 100, step: 5 },
        { key: 'pitch', label: '音调 %', type: 'number', min: -50, max: 50, step: 5 },
    ],
};

/** 各供应商存音色的字段名不同。 */
const VOICE_FIELD = { [Provider.MINIMAX]: 'voiceId', [Provider.AZURE]: 'voice' };

const DIRECTOR_FIELDS = [
    {
        key: 'voiceMode', label: '角色音色分配', type: 'select',
        options: [
            { value: 'ai', label: 'AI 智能分配（推荐）' },
            { value: 'manual', label: '手动指定' },
        ],
        hint: 'AI 分配会在导演拆完台本后自动为新角色挑音色；已手动配过的角色不会被覆盖',
    },
];

/** 当前供应商的默认音色 id。 */
function currentVoiceId() {
    const { tts } = getSettings();
    return tts[tts.provider]?.[VOICE_FIELD[tts.provider]] || '';
}

// ── 音色列表 ────────────────────────────────────

function voiceRow(voice, selected) {
    const cls = voice.id === selected ? 'xvoice-voice xvoice-voice-selected' : 'xvoice-voice';
    const check = voice.id === selected ? `<i class="fa-solid fa-check" aria-hidden="true"></i>` : '';
    return `<div class="${cls}">
        <button type="button" class="xvoice-voice-pick" data-voice="${escapeHtml(voice.id)}"
            title="点击设为默认音色" aria-pressed="${voice.id === selected}">
            <span class="xvoice-voice-name">${escapeHtml(voice.name)}${check}</span>
            <code class="xvoice-voice-id">${escapeHtml(voice.id)}</code>
        </button>
        <button type="button" class="xvoice-voice-play" data-preview="${escapeHtml(voice.id)}"
            title="试听" aria-label="试听音色 ${escapeHtml(voice.name)}">${ICON.preview}</button>
    </div>`;
}

function renderVoiceList(pane) {
    const box = pane.querySelector('[data-xv-voice-list]');
    const query = (pane.querySelector('[data-xv-voice-search]')?.value || '').trim().toLowerCase();
    const selected = currentVoiceId();
    const list = allVoices.filter((v) =>
        !query || v.id.toLowerCase().includes(query) || (v.name || '').toLowerCase().includes(query));

    pane.querySelector('[data-xv-voice-count]').textContent = allVoices.length
        ? `${list.length} / ${allVoices.length}${voicesFromCache ? ' · 缓存' : ''}` : '';
    box.innerHTML = list.length
        ? list.map((v) => voiceRow(v, selected)).join('')
        : `<p class="xvoice-hint">${allVoices.length ? '没有匹配的音色。' : '还没有拉取到音色。'}</p>`;
}

/** 当前供应商缓存的音色列表。 */
function cachedVoices() {
    const { tts } = getSettings();
    return tts.voiceCache?.[tts.provider]?.voices || [];
}

/** 把缓存列表读进内存（顶替上一次的）。返回是否命中缓存。 */
function loadCachedVoices() {
    allVoices = cachedVoices().slice();
    voicesFromCache = allVoices.length > 0;
    return voicesFromCache;
}

/** 拉取成功后写入缓存，下次打开直接用，不用重新拉。 */
function cacheVoices(voices) {
    const { tts } = getSettings();
    if (!tts.voiceCache) tts.voiceCache = {};
    tts.voiceCache[tts.provider] = { at: Date.now(), voices };
    saveSettings();
}

async function showVoiceList(pane) {
    const box = pane.querySelector('[data-xv-voice-list]');
    const panel = pane.querySelector('[data-xv-voice-panel]');
    const status = pane.querySelector('[data-xv-status]');
    panel.hidden = false;
    box.innerHTML = `<p class="xvoice-hint">${ICON.spinner} 正在拉取音色…</p>`;
    try {
        const voices = await listVoices();
        allVoices = voices.slice(0, 300);
        voicesFromCache = false;
        if (!allVoices.length) {
            box.innerHTML = '<p class="xvoice-hint">当前供应商不支持在线拉取音色，请手动填写音色 id。</p>';
            return;
        }
        cacheVoices(allVoices);
        renderVoiceList(pane);
        status.classList.remove('xvoice-error');
    } catch (e) {
        box.innerHTML = `<p class="xvoice-hint xvoice-error">拉取失败：${escapeHtml(e.message)}</p>`;
    }
}

// ── 试听 ────────────────────────────────────────

let allVoices = [];
let voicesFromCache = false;
let previewBtn = null;
let autoPreviewTimer = null;

/** 当前台本里该角色的台词。用它试听比通用样例直观；没有就回落到通用样例。 */
function lineFor(speaker) {
    const chunk = player.chunks.find((c) => c.speaker === speaker && c.text);
    return chunk?.text || undefined;
}

function resetPreview() {
    if (!previewBtn) return;
    previewBtn.classList.remove('xvoice-loading', 'xvoice-playing');
    previewBtn.innerHTML = ICON.preview;
    previewBtn = null;
}

/**
 * 点一下试听，再点一下停止。同一时刻只播一个样本。
 * @param {HTMLButtonElement} btn
 * @param {object|undefined} override
 */
async function togglePreview(pane, btn, override, text, force = false) {
    const status = pane.querySelector('[data-xv-status]');
    const same = !force && previewBtn === btn;
    stopPreview();
    resetPreview();
    if (same) {
        status.classList.remove('xvoice-error');
        status.textContent = '已停止试听';
        return;
    }
    if (!override) {
        status.textContent = '这个角色还没配音色，先在上面选一个。';
        status.classList.add('xvoice-error');
        return;
    }

    // 试听优先：先停掉正在放的台本，避免两个声音叠在一起
    if (player.active) player.stop();

    status.classList.remove('xvoice-error');
    status.textContent = '试听中…';
    previewBtn = btn;
    btn.classList.add('xvoice-loading');
    btn.innerHTML = ICON.spinner;
    let played = false;
    let failed = false;
    try {
        played = await previewVoice(override, {
            text,
            onStart: () => {
                if (previewBtn !== btn) return;
                btn.classList.remove('xvoice-loading');
                btn.classList.add('xvoice-playing');
                btn.innerHTML = ICON.previewing;
            },
        });
    } catch (e) {
        failed = true;
        status.textContent = `试听失败：${e.message}`;
        status.classList.add('xvoice-error');
    } finally {
        if (previewBtn === btn) {
            resetPreview();
            if (!failed) status.textContent = played ? '试听完成' : '已停止试听';
        }
    }
}

// ── 角色配音表 ──────────────────────────────────

function castHtml() {
    const rows = Object.entries(getRoleVoices());
    if (!rows.length) {
        return '<p class="xvoice-hint">当前角色卡还没有角色配音。点播放器里的「AI 导演」拆一次台本就会自动生成。</p>';
    }
    return rows.map(([name, voice]) => `<div class="xvoice-cast" data-cast="${escapeHtml(name)}">
        <span class="xvoice-cast-name">${escapeHtml(name)}</span>
        <input class="text_pole xvoice-cast-voice" data-cast-voice="${escapeHtml(name)}"
            value="${escapeHtml(voice)}" placeholder="音色 id" autocomplete="off">
        <button type="button" class="xvoice-cast-list" data-cast-list="${escapeHtml(name)}"
            title="从音色列表选择" aria-label="为 ${escapeHtml(name)} 选择音色">${ICON.list}</button>
        <button type="button" class="xvoice-cast-play" data-cast-preview="${escapeHtml(name)}"
            title="试听这个角色的音色" aria-label="试听角色 ${escapeHtml(name)} 的音色">${ICON.preview}</button>
        <button type="button" class="xvoice-del" data-cast-del="${escapeHtml(name)}"
            title="删除" aria-label="删除角色 ${escapeHtml(name)}">${ICON.trash}</button>
    </div>`).join('');
}

function renderCast(pane) {
    pane.querySelector('[data-xv-cast]').innerHTML = castHtml();
    const label = pane.querySelector('[data-xv-card]');
    if (label) label.textContent = currentCardLabel() || '（未选择角色卡）';
}

// ── 角色音色快速选择（弹窗） ─────────────────────

let voicePicker = null;
let pickerRole = '';

function renderPickerList(body, filter = '') {
    const query = String(filter).trim().toLowerCase();
    const list = allVoices.filter((v) =>
        !query || v.id.toLowerCase().includes(query) || (v.name || '').toLowerCase().includes(query));
    body.querySelector('[data-xv-picker-list]').innerHTML = list.length
        ? list.slice(0, 400).map((v) => `<button type="button" class="xvoice-voice-option" data-pick="${escapeHtml(v.id)}">
                <span class="xvoice-voice-option-name">${escapeHtml(v.name)}</span>
                <code class="xvoice-voice-option-id">${escapeHtml(v.id)}</code>
            </button>`).join('')
        : `<p class="xvoice-hint">${allVoices.length
            ? '没有匹配的音色。'
            : '还没有音色列表，请先关闭并点上方「拉取音色列表」。'}</p>`;
}

function createVoicePicker(pane) {
    return createFloatingPanel({
        title: '选择音色',
        onFirstOpen: (body) => {
            body.innerHTML = `<input class="text_pole xvoice-voice-search" data-xv-picker-search
                    placeholder="搜索音色名称或 id…" autocomplete="off">
                <div class="xvoice-model-list" data-xv-picker-list></div>`;
            body.addEventListener('input', (event) => {
                if (event.target.matches('[data-xv-picker-search]')) renderPickerList(body, event.target.value);
            });
            body.addEventListener('click', (event) => {
                const id = event.target.closest('[data-pick]')?.dataset.pick;
                if (!id) return;
                setCastVoice(pane, pickerRole, id);
                voicePicker?.close();
            });
        },
    });
}

function openVoicePicker(pane, name) {
    pickerRole = name;
    voicePicker.open();
    renderPickerList(voicePicker.body);
    voicePicker.body.querySelector('[data-xv-picker-search]')?.focus();
}

// ── 页面 ────────────────────────────────────────

function paneHtml() {
    const options = listProviders()
        .map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
    const blocks = Object.entries(PROVIDER_FIELDS)
        .map(([id, fields]) => `<div class="xvoice-provider" data-provider="${id}">${renderFields(fields)}</div>`)
        .join('');
    return `<div class="xvoice-field">
            <label>供应商</label>
            <select class="text_pole" data-xv-provider>${options}</select>
        </div>
        ${blocks}
        <div class="xvoice-row">
            <button class="menu_button" data-act="voices">拉取音色列表</button>
            <span class="xvoice-status" data-xv-voice-count></span>
            <span class="xvoice-status" data-xv-status></span>
        </div>
        <div class="xvoice-voice-panel" data-xv-voice-panel hidden>
            <input class="text_pole xvoice-voice-search" data-xv-voice-search
                placeholder="搜索音色名称或 id…" autocomplete="off">
            <div class="xvoice-voice-list" data-xv-voice-list></div>
        </div>
        <details class="xvoice-cast-box" open>
            <summary>角色配音（AI 导演用）</summary>
            ${renderFields(DIRECTOR_FIELDS)}
            <div class="xvoice-cast-scope">当前角色卡：<b data-xv-card></b></div>
            <div data-xv-cast></div>
            <small class="xvoice-hint">每个角色卡分开保存。点角色右侧的列表按钮可从拉取到的音色里快速选择，也能直接粘贴音色 id。
            改完音色点右侧试听按钮，会直接用该角色在当前台本里的台词听效果；播放器里已生成的台词要重新点「朗读」才会换上新音色。音色列表会缓存，点「拉取音色列表」才刷新。</small>
        </details>`;
}

/** 按当前供应商同步下拉框选中值、字段块可见性与就绪状态。 */
function syncVisibility(pane) {
    const current = getSettings().tts.provider;
    const select = pane.querySelector('[data-xv-provider]');
    if (select && select.value !== current) select.value = current;
    pane.querySelectorAll('.xvoice-provider')
        .forEach((el) => { el.hidden = el.dataset.provider !== current; });
    const status = pane.querySelector('[data-xv-status]');
    const issue = checkReady();
    status.textContent = issue ? `⚠ ${issue}` : '✓ 配置就绪';
    status.classList.toggle('xvoice-error', !!issue);
}

function applyPickedVoice(pane, voiceId) {
    const { tts } = getSettings();
    const field = VOICE_FIELD[tts.provider];
    tts[tts.provider][field] = voiceId;
    saveSettings();
    const input = pane.querySelector(`.xvoice-provider[data-provider="${tts.provider}"] [data-xv-key="${field}"]`);
    if (input) input.value = voiceId;
    renderVoiceList(pane);
    syncVisibility(pane);
}

/** 记住最后编辑的角色输入框，点音色列表时就知道该填给谁。 */
function trackCastFocus(pane, state) {
    pane.addEventListener('focusin', (event) => {
        state.active = event.target.closest('[data-cast-voice]')?.dataset.castVoice || '';
    });
}

function setCastVoice(pane, name, voiceId) {
    getRoleVoices()[name] = voiceId;
    saveSettings();
    const input = pane.querySelector(`[data-cast-voice="${CSS.escape(name)}"]`);
    if (input) input.value = voiceId;
    // 改完音色直接用该角色的台词试听一下，不用再跑回播放器
    clearTimeout(autoPreviewTimer);
    autoPreviewTimer = setTimeout(() => {
        const btn = pane.querySelector(`[data-cast-preview="${CSS.escape(name)}"]`);
        if (btn) togglePreview(pane, btn, voiceOverride(voiceId), lineFor(name), true);
    }, 150);
}

/** 点音色：刚在编辑某个角色就填给它，否则改当前供应商的默认音色。 */
function pickVoice(pane, state, voiceId) {
    if (state.active) setCastVoice(pane, state.active, voiceId);
    else applyPickedVoice(pane, voiceId);
}

export function mountVoiceTab(pane) {
    pane.innerHTML = paneHtml();
    renderCast(pane);

    voicePicker = createVoicePicker(pane);
    // 有缓存就直接显示，不用重新拉
    if (loadCachedVoices()) {
        pane.querySelector('[data-xv-voice-panel]').hidden = false;
        renderVoiceList(pane);
    }

    const castFocus = { active: '' };
    const refreshers = [];
    const select = pane.querySelector('[data-xv-provider]');
    select.addEventListener('change', () => {
        getSettings().tts.provider = select.value;
        saveSettings();
        const hasCache = loadCachedVoices();
        pane.querySelector('[data-xv-voice-panel]').hidden = !hasCache;
        pane.querySelector('[data-xv-voice-list]').innerHTML = '';
        if (hasCache) renderVoiceList(pane);
        syncVisibility(pane);
    });

    Object.entries(PROVIDER_FIELDS).forEach(([id, fields]) => {
        const block = pane.querySelector(`.xvoice-provider[data-provider="${id}"]`);
        refreshers.push(bindFields(block, fields, () => getSettings().tts[id], () => {
            saveSettings();
            syncVisibility(pane);
            if (fields.some((f) => f.key === VOICE_FIELD[id])) renderVoiceList(pane);
        }));
    });
    refreshers.push(bindFields(pane, DIRECTOR_FIELDS, () => getSettings().director, saveSettings));

    trackCastFocus(pane, castFocus);

    pane.addEventListener('input', (event) => {
        if (event.target.matches('[data-xv-voice-search]')) renderVoiceList(pane);
    });

    pane.addEventListener('change', (event) => {
        const name = event.target.closest('[data-cast-voice]')?.dataset.castVoice;
        if (name) setCastVoice(pane, name, event.target.value.trim());
    });

    pane.addEventListener('click', async (event) => {
        if (event.target.closest('[data-act="voices"]')) return showVoiceList(pane);

        const castList = event.target.closest('[data-cast-list]')?.dataset.castList;
        if (castList) return openVoicePicker(pane, castList);

        const castPlay = event.target.closest('[data-cast-preview]')?.dataset.castPreview;
        if (castPlay) {
            const input = pane.querySelector(`[data-cast-voice="${CSS.escape(castPlay)}"]`);
            const btn = event.target.closest('[data-cast-preview]');
            return togglePreview(pane, btn, voiceOverride(input?.value.trim()), lineFor(castPlay));
        }

        const preview = event.target.closest('[data-preview]')?.dataset.preview;
        if (preview) return togglePreview(pane, event.target.closest('[data-preview]'), voiceOverride(preview));

        const del = event.target.closest('[data-cast-del]')?.dataset.castDel;
        if (del) {
            delete getRoleVoices()[del];
            saveSettings();
            return renderCast(pane);
        }

        const voice = event.target.closest('[data-voice]')?.dataset.voice;
        if (voice) pickVoice(pane, castFocus, voice);
    });

    document.addEventListener('xvoice:settings-changed', () => {
        refreshers.forEach((fn) => fn());
        renderCast(pane);
        syncVisibility(pane);
    });
    // 换角色卡后，角色配音表跟着切
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => renderCast(pane));
    }
    syncVisibility(pane);
}
