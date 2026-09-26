import { getSettings, saveSettings } from '../core/settings.js';
import { renderFields, bindFields, escapeHtml } from './form.js';
import { listProviders, listVoices, checkReady } from '../tts/index.js';
import { Provider } from '../core/constants.js';
import { voiceOverride } from '../core/pipeline.js';
import { previewVoice, stopPreview } from './preview.js';
import { ICON } from './icons.js';

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
        ? `${list.length} / ${allVoices.length}` : '';
    box.innerHTML = list.length
        ? list.map((v) => voiceRow(v, selected)).join('')
        : `<p class="xvoice-hint">${allVoices.length ? '没有匹配的音色。' : '还没有拉取到音色。'}</p>`;
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
        if (!allVoices.length) {
            box.innerHTML = '<p class="xvoice-hint">当前供应商不支持在线拉取音色，请手动填写音色 id。</p>';
            return;
        }
        renderVoiceList(pane);
        status.classList.remove('xvoice-error');
    } catch (e) {
        box.innerHTML = `<p class="xvoice-hint xvoice-error">拉取失败：${escapeHtml(e.message)}</p>`;
    }
}

// ── 试听 ────────────────────────────────────────

let allVoices = [];
let previewBtn = null;

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
async function togglePreview(pane, btn, override) {
    const status = pane.querySelector('[data-xv-status]');
    const same = previewBtn === btn;
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

    status.classList.remove('xvoice-error');
    status.textContent = '试听中…';
    previewBtn = btn;
    btn.classList.add('xvoice-loading');
    btn.innerHTML = ICON.spinner;
    let played = false;
    let failed = false;
    try {
        played = await previewVoice(override, {
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
    const { roleVoices } = getSettings().director;
    const rows = Object.entries(roleVoices);
    if (!rows.length) {
        return '<p class="xvoice-hint">还没有角色配音。点播放器里的「AI 导演」拆一次台本就会自动生成。</p>';
    }
    return rows.map(([name, voice]) => `<div class="xvoice-cast" data-cast="${escapeHtml(name)}">
        <span class="xvoice-cast-name">${escapeHtml(name)}</span>
        <input class="text_pole xvoice-cast-voice" data-cast-voice="${escapeHtml(name)}"
            value="${escapeHtml(voice)}" placeholder="音色 id" autocomplete="off">
        <button type="button" class="xvoice-cast-play" data-cast-preview="${escapeHtml(name)}"
            title="试听这个角色的音色" aria-label="试听角色 ${escapeHtml(name)} 的音色">${ICON.preview}</button>
        <button type="button" class="xvoice-del" data-cast-del="${escapeHtml(name)}"
            title="删除" aria-label="删除角色 ${escapeHtml(name)}">${ICON.trash}</button>
    </div>`).join('');
}

function renderCast(pane) {
    pane.querySelector('[data-xv-cast]').innerHTML = castHtml();
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
            <div data-xv-cast></div>
            <small class="xvoice-hint">先在上面拉取音色列表，点某个音色可填给下面选中的角色输入框，也能直接粘贴音色 id。
            每个角色右侧的试听按钮可以直接听效果。</small>
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
    const { roleVoices } = getSettings().director;
    roleVoices[name] = voiceId;
    saveSettings();
    const input = pane.querySelector(`[data-cast-voice="${CSS.escape(name)}"]`);
    if (input) input.value = voiceId;
}

/** 点音色：刚在编辑某个角色就填给它，否则改当前供应商的默认音色。 */
function pickVoice(pane, state, voiceId) {
    if (state.active) setCastVoice(pane, state.active, voiceId);
    else applyPickedVoice(pane, voiceId);
}

export function mountVoiceTab(pane) {
    pane.innerHTML = paneHtml();
    renderCast(pane);

    const castFocus = { active: '' };
    const refreshers = [];
    const select = pane.querySelector('[data-xv-provider]');
    select.addEventListener('change', () => {
        getSettings().tts.provider = select.value;
        allVoices = [];
        pane.querySelector('[data-xv-voice-panel]').hidden = true;
        saveSettings();
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

        const castPlay = event.target.closest('[data-cast-preview]')?.dataset.castPreview;
        if (castPlay) {
            const input = pane.querySelector(`[data-cast-voice="${CSS.escape(castPlay)}"]`);
            const btn = event.target.closest('[data-cast-preview]');
            return togglePreview(pane, btn, voiceOverride(input?.value.trim()));
        }

        const preview = event.target.closest('[data-preview]')?.dataset.preview;
        if (preview) return togglePreview(pane, event.target.closest('[data-preview]'), voiceOverride(preview));

        const del = event.target.closest('[data-cast-del]')?.dataset.castDel;
        if (del) {
            delete getSettings().director.roleVoices[del];
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
    syncVisibility(pane);
}
