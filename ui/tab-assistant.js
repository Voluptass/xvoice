import { getActiveLlmProfile, saveSettings } from '../core/settings.js';
import { testConnection, listModels } from '../core/llm.js';
import { chat } from '../assistant/agent.js';
import { stripCalls } from '../assistant/protocol.js';
import { renderFields, bindFields, escapeHtml } from './form.js';
import { createFloatingPanel, isTouchDevice } from './floating.js';
import { icon } from './icons.js';

let modelPicker = null;
let availableModels = [];

const LLM_FIELDS = [
    { key: 'apiUrl', label: 'API 地址', type: 'text', hint: '需要带版本段，例如 https://api.openai.com/v1' },
    { key: 'apiKey', label: 'API Key', type: 'password' },
    { key: 'model', label: '模型', type: 'text', hint: '可手动填写模型 ID，或点击右侧按钮从已拉取列表选择' },
    { key: 'maxTokens', label: '最大输出长度', type: 'number', min: 256, max: 32000, step: 256, hint: '回答被截断时调大' },
    { key: 'stream', label: '流式输出', type: 'checkbox' },
    { key: 'bypassProxy', label: '绕过酒馆后端直连', type: 'checkbox', hint: '默认经酒馆转发，直连要求目标接口允许跨域' },
];

const history = [];
let busy = false;

// ── 对话 ────────────────────────────────────────

/** 还没有消息时显示的引导 + 快捷提问。 */
function emptyStateHtml() {
    return `<div class="xvoice-chat-empty" data-xv-empty>
        <p>我能帮你排查朗读没声音、配置正则、挑音色和模型。<br>不知道从哪开始，点下面的快捷入口就行。</p>
        <div class="xvoice-chips">
            <button type="button" class="xvoice-chip" data-as="diagnose">${icon('stethoscope')} 一键自检</button>
            <button type="button" class="xvoice-chip" data-chip="朗读没有声音，帮我按顺序排查一下可能的原因">朗读没声音</button>
            <button type="button" class="xvoice-chip" data-chip="帮我配一条去掉【】状态栏的正则规则">配去状态栏正则</button>
            <button type="button" class="xvoice-chip" data-chip="看一下我的音色配置有没有问题，给点建议">检查音色配置</button>
        </div>
    </div>`;
}

function bubble(pane, role, text = '') {
    const log = pane.querySelector('[data-xv-chat]');
    log.querySelector('[data-xv-empty]')?.remove();
    const el = document.createElement('div');
    el.className = `xvoice-msg xvoice-msg-${role}`;
    el.innerHTML = `<span class="xvoice-avatar" aria-hidden="true">${role === 'user' ? icon('user') : icon('wand-magic-sparkles')}</span>
        <div class="xvoice-bubble">
            <div class="xvoice-msg-body">${escapeHtml(text)}</div>
            <div class="xvoice-calls"></div>
        </div>`;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
}

/** 清空对话，回到引导状态。 */
function resetChat(pane) {
    history.length = 0;
    pane.querySelector('[data-xv-chat]').innerHTML = emptyStateHtml();
}

function showCall(el, { id, status, result }) {
    const box = el.querySelector('.xvoice-calls');
    const key = `call-${id}`;
    const existing = box.querySelector(`[data-call="${key}"]`);
    const label = status === 'running' ? `正在执行 ${id}…`
        : status === 'done' ? `✓ ${id}`
        : `✗ ${id}：${result?.error || '失败'}`;
    if (existing) existing.textContent = label;
    else box.insertAdjacentHTML('beforeend', `<span class="xvoice-call" data-call="${key}">${escapeHtml(label)}</span>`);
}

function setBusy(pane, on) {
    const send = pane.querySelector('[data-as="send"]');
    if (send) send.disabled = on;
}

async function send(pane, text) {
    if (busy || !text.trim()) return;
    busy = true;
    setBusy(pane, true);
    bubble(pane, 'user', text);
    const el = bubble(pane, 'assistant', '思考中…');
    const body = el.querySelector('.xvoice-msg-body');
    let raw = '';

    try {
        const { reply, messages } = await chat(text, history, {
            onDelta: (d) => {
                raw += d;
                body.textContent = stripCalls(raw) || '…';
                el.parentElement.scrollTop = el.parentElement.scrollHeight;
            },
            onCall: (info) => showCall(el, info),
        });
        body.textContent = reply || '（没有返回内容）';
        history.push(...messages);
    } catch (e) {
        body.textContent = `请求失败：${e.message}`;
        body.classList.add('xvoice-error');
    } finally {
        busy = false;
        setBusy(pane, false);
    }
}

// ── 模型配置 ────────────────────────────────────

/** 摘要行上的小圆点 + 当前模型名。 */
function syncConfig(pane) {
    const { profile } = getActiveLlmProfile();
    const configured = !!profile.apiUrl;
    const label = pane.querySelector('[data-xv-config-label]');
    if (label) {
        const model = profile.model ? `：${profile.model}` : '';
        label.textContent = `助手模型${model}${configured ? '' : '（未配置）'}`;
    }
    const dot = pane.querySelector('[data-xv-dot]');
    if (dot) {
        dot.classList.toggle('ok', configured);
        dot.classList.toggle('warn', !configured);
    }
}

async function runTest(pane) {
    const status = pane.querySelector('[data-xv-llm-status]');
    status.textContent = '测试中…';
    const { ok, message } = await testConnection(getActiveLlmProfile().profile);
    status.textContent = message;
    status.classList.toggle('xvoice-error', !ok);
}

function renderModelPicker(body, filter = '') {
    const query = String(filter).trim().toLowerCase();
    const list = body.querySelector('[data-xv-model-list]');
    if (!list) return;
    const models = availableModels.filter((id) => !query || id.toLowerCase().includes(query));
    list.innerHTML = models.length
        ? models.map((id) => `<button type="button" class="xvoice-model-option" data-model="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('')
        : '<p class="xvoice-hint">没有匹配的模型。</p>';
}

function openModelPicker(pane) {
    if (!availableModels.length) return;
    modelPicker.open();
    renderModelPicker(modelPicker.body);
    if (!isTouchDevice()) modelPicker.body.querySelector('[data-xv-model-search]')?.focus();
}

function createModelPicker(pane) {
    return createFloatingPanel({
        title: '选择模型',
        onFirstOpen: (body) => {
            body.innerHTML = `<input class="text_pole xvoice-model-search" data-xv-model-search placeholder="搜索模型…" autocomplete="off">
                <div class="xvoice-model-list" data-xv-model-list></div>`;
            body.addEventListener('input', (event) => {
                if (event.target.matches('[data-xv-model-search]')) renderModelPicker(body, event.target.value);
            });
            body.addEventListener('click', (event) => {
                const option = event.target.closest('[data-model]');
                if (!option) return;
                const field = pane.querySelector('[data-xv-key="model"]');
                if (field) {
                    field.value = option.dataset.model;
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                }
                modelPicker.close();
            });
            renderModelPicker(body);
        },
    });
}

/** 拉取模型后放入独立选择窗口，避免原生 datalist 被主浮窗裁剪。 */
async function loadModels(pane) {
    const status = pane.querySelector('[data-xv-model-status]');
    status.textContent = '拉取中…';
    status.classList.remove('xvoice-error');
    try {
        const models = await listModels(getActiveLlmProfile().profile);
        availableModels = models.map(String).filter(Boolean);
        pane.querySelector('[data-as="pick-model"]').disabled = !availableModels.length;
        renderModelPicker(modelPicker.body);
        status.textContent = `已拉取 ${availableModels.length} 个模型，可打开独立窗口选择`;
        openModelPicker(pane);
    } catch (e) {
        status.textContent = e.message;
        status.classList.add('xvoice-error');
    }
}

// ── 页面 ────────────────────────────────────────

function paneHtml() {
    // 配好了就收起配置区，让对话和输入框第一眼可见；没配过则展开引导填写
    const configured = !!getActiveLlmProfile().profile.apiUrl;
    return `<details class="xvoice-llm-config"${configured ? '' : ' open'}>
            <summary>
                <span class="xvoice-status-dot ${configured ? 'ok' : 'warn'}" data-xv-dot></span>
                <span data-xv-config-label>助手模型</span>
            </summary>
            ${renderFields(LLM_FIELDS)}
            <div class="xvoice-row">
                <button class="menu_button" data-as="models">拉取模型列表</button>
                <button class="menu_button" data-as="pick-model" disabled>选择模型</button>
                <span class="xvoice-status" data-xv-model-status></span>
            </div>
            <div class="xvoice-row">
                <button class="menu_button" data-as="test">测试连接</button>
                <span class="xvoice-status" data-xv-llm-status></span>
            </div>
        </details>
        <div class="xvoice-chat-head">
            <span class="xvoice-chat-title">${icon('wand-magic-sparkles')} AI 助手</span>
            <button type="button" class="xvoice-icon-btn" data-as="clear"
                title="清空对话" aria-label="清空对话">${icon('broom')}</button>
        </div>
        <div class="xvoice-chat" data-xv-chat></div>
        <div class="xvoice-composer">
            <textarea class="text_pole" data-xv-input data-autofocus rows="1"
                aria-label="给助手发消息"></textarea>
            <button type="button" class="xvoice-send" data-as="send"
                title="发送" aria-label="发送">${icon('paper-plane')}</button>
        </div>`;
}

export function mountAssistantTab(pane) {
    pane.innerHTML = paneHtml();
    modelPicker = createModelPicker(pane);
    const refresh = bindFields(pane, LLM_FIELDS, () => getActiveLlmProfile().profile, saveSettings);
    document.addEventListener('xvoice:settings-changed', () => {
        refresh();
        syncConfig(pane);
    });
    syncConfig(pane);
    resetChat(pane);

    const input = pane.querySelector('[data-xv-input]');

    const submit = async () => {
        const text = input.value;
        input.value = '';
        input.style.height = '';
        await send(pane, text);
    };

    // 输入框随内容长高，最多到 8 行左右，再多就内部滚动
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    });

    pane.addEventListener('click', async (event) => {
        const chip = event.target.closest('[data-chip]')?.dataset.chip;
        if (chip) return send(pane, chip);

        const act = event.target.closest('[data-as]')?.dataset.as;
        if (act === 'test') return runTest(pane);
        if (act === 'models') return loadModels(pane);
        if (act === 'pick-model') return openModelPicker(pane);
        if (act === 'diagnose') return send(pane, '帮我做一次完整自检，说明当前配置有什么问题、怎么修。');
        if (act === 'clear') return resetChat(pane);
        if (act === 'send') return submit();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        submit();
    });
}
