import { getSettings, saveSettings } from '../core/settings.js';
import { renderFields, bindFields, escapeHtml } from './form.js';
import { listProviders, listVoices, checkReady } from '../tts/index.js';
import { Provider } from '../core/constants.js';

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

/** 角色配音表：列出已配的角色，可改音色、可删。 */
function castHtml() {
    const { roleVoices } = getSettings().director;
    const rows = Object.entries(roleVoices);
    if (!rows.length) {
        return '<p class="xvoice-hint">还没有角色配音。点播放器里的「AI 导演」拆一次台本就会自动生成。</p>';
    }
    return rows.map(([name, voice]) => `<div class="xvoice-cast" data-cast="${escapeHtml(name)}">
        <span class="xvoice-cast-name">${escapeHtml(name)}</span>
        <input class="text_pole xvoice-cast-voice" data-cast-voice="${escapeHtml(name)}"
            value="${escapeHtml(voice)}" autocomplete="off">
        <button class="menu_button" data-cast-del="${escapeHtml(name)}" title="删除">✕</button>
    </div>`).join('');
}

function renderCast(pane) {
    pane.querySelector('[data-xv-cast]').innerHTML = castHtml();
}

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
            <span class="xvoice-status" data-xv-status></span>
        </div>
        <div class="xvoice-voice-list" data-xv-voice-list hidden></div>
        <details class="xvoice-cast-box" open>
            <summary>角色配音（AI 导演用）</summary>
            ${renderFields(DIRECTOR_FIELDS)}
            <div data-xv-cast></div>
            <small class="xvoice-hint">先在上面拉取音色列表，点某个音色可填给下面选中的角色输入框，也能直接粘贴音色 id。</small>
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

async function showVoiceList(pane) {
    const box = pane.querySelector('[data-xv-voice-list]');
    box.hidden = false;
    box.textContent = '正在拉取…';
    try {
        const voices = await listVoices();
        if (!voices.length) {
            box.textContent = '当前供应商不支持在线拉取音色，请手动填写音色 id。';
            return;
        }
        box.innerHTML = voices.slice(0, 200)
            .map((v) => `<div class="xvoice-voice" data-voice="${escapeHtml(v.id)}">${escapeHtml(v.name)}<code>${escapeHtml(v.id)}</code></div>`)
            .join('');
    } catch (e) {
        box.textContent = `拉取失败：${e.message}`;
    }
}

function applyPickedVoice(pane, voiceId) {
    const { tts } = getSettings();
    const field = VOICE_FIELD[tts.provider];
    tts[tts.provider][field] = voiceId;
    saveSettings();
    const input = pane.querySelector(`.xvoice-provider[data-provider="${tts.provider}"] [data-xv-key="${field}"]`);
    if (input) input.value = voiceId;
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
        saveSettings();
        syncVisibility(pane);
    });

    Object.entries(PROVIDER_FIELDS).forEach(([id, fields]) => {
        const block = pane.querySelector(`.xvoice-provider[data-provider="${id}"]`);
        refreshers.push(bindFields(block, fields, () => getSettings().tts[id], () => {
            saveSettings();
            syncVisibility(pane);
        }));
    });
    refreshers.push(bindFields(pane, DIRECTOR_FIELDS, () => getSettings().director, saveSettings));

    trackCastFocus(pane, castFocus);

    pane.addEventListener('change', (event) => {
        const name = event.target.closest('[data-cast-voice]')?.dataset.castVoice;
        if (name) setCastVoice(pane, name, event.target.value.trim());
    });

    pane.addEventListener('click', async (event) => {
        if (event.target.closest('[data-act="voices"]')) return showVoiceList(pane);

        const del = event.target.closest('[data-cast-del]')?.dataset.castDel;
        if (del) {
            delete getSettings().director.roleVoices[del];
            saveSettings();
            return renderCast(pane);
        }

        const voice = event.target.closest('.xvoice-voice')?.dataset.voice;
        if (voice) pickVoice(pane, castFocus, voice);
    });

    document.addEventListener('xvoice:settings-changed', () => {
        refreshers.forEach((fn) => fn());
        renderCast(pane);
        syncVisibility(pane);
    });
    syncVisibility(pane);
}
