import { getActiveLlmProfile, saveSettings } from '../core/settings.js';
import { testConnection, listModels } from '../core/llm.js';
import { chat } from '../assistant/agent.js';
import { stripCalls } from '../assistant/protocol.js';
import { renderFields, bindFields, escapeHtml } from './form.js';

const MODEL_LIST_ID = 'xvoice-model-options';

const LLM_FIELDS = [
    { key: 'apiUrl', label: 'API 地址', type: 'text', hint: '需要带版本段，例如 https://api.openai.com/v1' },
    { key: 'apiKey', label: 'API Key', type: 'password' },
    { key: 'model', label: '模型', type: 'text', datalist: MODEL_LIST_ID, hint: '拉取后点输入框可直接选，也能输入关键字过滤' },
    { key: 'maxTokens', label: '最大输出长度', type: 'number', min: 256, max: 32000, step: 256, hint: '回答被截断时调大' },
    { key: 'stream', label: '流式输出', type: 'checkbox' },
    { key: 'bypassProxy', label: '绕过酒馆后端直连', type: 'checkbox', hint: '默认经酒馆转发，直连要求目标接口允许跨域' },
];

const history = [];
let busy = false;

function bubble(pane, role, text = '') {
    const el = document.createElement('div');
    el.className = `xvoice-msg xvoice-msg-${role}`;
    el.innerHTML = `<div class="xvoice-msg-body">${escapeHtml(text)}</div><div class="xvoice-calls"></div>`;
    const log = pane.querySelector('[data-xv-chat]');
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
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

async function send(pane, text) {
    if (busy || !text.trim()) return;
    busy = true;
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
    }
}

async function runTest(pane) {
    const status = pane.querySelector('[data-xv-llm-status]');
    status.textContent = '测试中…';
    const { ok, message } = await testConnection(getActiveLlmProfile().profile);
    status.textContent = message;
    status.classList.toggle('xvoice-error', !ok);
}

/** 拉取模型灌进 datalist，输入框随即获得原生下拉与过滤。 */
async function loadModels(pane) {
    const status = pane.querySelector('[data-xv-model-status]');
    status.textContent = '拉取中…';
    status.classList.remove('xvoice-error');
    try {
        const models = await listModels(getActiveLlmProfile().profile);
        pane.querySelector(`#${MODEL_LIST_ID}`).innerHTML = models
            .map((id) => `<option value="${escapeHtml(id)}"></option>`).join('');
        status.textContent = `已拉取 ${models.length} 个模型，点模型输入框选择`;
    } catch (e) {
        status.textContent = e.message;
        status.classList.add('xvoice-error');
    }
}

function paneHtml() {
    // 配好了就收起配置区，让对话和输入框第一眼可见；没配过则展开引导填写
    const configured = !!getActiveLlmProfile().profile.apiUrl;
    return `<details class="xvoice-llm-config"${configured ? '' : ' open'}>
            <summary>助手使用的模型${configured ? '' : '（请先填写）'}</summary>
            ${renderFields(LLM_FIELDS)}
            <datalist id="${MODEL_LIST_ID}"></datalist>
            <div class="xvoice-row">
                <button class="menu_button" data-as="models">拉取模型列表</button>
                <span class="xvoice-status" data-xv-model-status></span>
            </div>
            <div class="xvoice-row">
                <button class="menu_button" data-as="test">测试连接</button>
                <span class="xvoice-status" data-xv-llm-status></span>
            </div>
        </details>
        <div class="xvoice-chat" data-xv-chat></div>
        <div class="xvoice-row">
            <button class="menu_button" data-as="diagnose">一键自检</button>
        </div>
        <div class="xvoice-input-row">
            <textarea class="text_pole" data-xv-input data-autofocus rows="2" placeholder="描述你遇到的问题，例如：朗读没有声音 / 帮我配个去掉状态栏的正则"></textarea>
            <button class="menu_button" data-as="send">发送</button>
        </div>`;
}

const WELCOME = '我能帮你排查朗读没声音、配置正则、挑音色和模型。\n'
    + '不知道从哪开始就点「一键自检」——我会读取你的真实配置，再告诉你问题出在哪。';

export function mountAssistantTab(pane) {
    pane.innerHTML = paneHtml();
    const refresh = bindFields(pane, LLM_FIELDS, () => getActiveLlmProfile().profile, saveSettings);
    document.addEventListener('xvoice:settings-changed', refresh);
    bubble(pane, 'assistant', WELCOME);

    const input = pane.querySelector('[data-xv-input]');
    pane.addEventListener('click', async (event) => {
        const act = event.target.closest('[data-as]')?.dataset.as;
        if (act === 'test') return runTest(pane);
        if (act === 'models') return loadModels(pane);
        if (act === 'diagnose') return send(pane, '帮我做一次完整自检，说明当前配置有什么问题、怎么修。');
        if (act === 'send') {
            const text = input.value;
            input.value = '';
            await send(pane, text);
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        const text = input.value;
        input.value = '';
        send(pane, text);
    });
}
