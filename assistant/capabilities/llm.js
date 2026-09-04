import { registerAll } from '../registry.js';
import { getSettings, saveSettings, getActiveLlmProfile, DEFAULT_LLM_PROFILE } from '../../core/settings.js';
import { testConnection, suggestBaseFix, normalizeBase, listModels } from '../../core/llm.js';

const EDITABLE = ['apiUrl', 'model', 'temperature', 'topP', 'maxTokens', 'stream', 'bypassProxy', 'mergeSystemUser'];

function llmSettings() {
    return getSettings().llm;
}

/** 不回传 apiKey 明文，只说明填没填。 */
function safeView(profile) {
    const view = { ...profile, apiKey: profile.apiKey ? '已填写' : '' };
    return view;
}

registerAll([
    {
        id: 'llm.status',
        summary: '查看 LLM 预设列表、当前生效预设及其参数（不返回密钥明文）',
        handler: () => {
            const { profiles, active } = llmSettings();
            const { profile, name, fellBack } = getActiveLlmProfile();
            return {
                active: name,
                configured: active,
                fellBack,
                profiles: Object.keys(profiles),
                current: safeView(profile),
                baseUrlHint: suggestBaseFix(profile.apiUrl),
            };
        },
    },
    {
        id: 'llm.configure',
        summary: '修改当前 LLM 预设的参数。API 地址报 404 时通常是缺少 /v1 版本段，可用本能力修正',
        mutates: true,
        params: {
            apiUrl: 'API 基础地址，需含版本段，如 https://api.openai.com/v1',
            model: '模型名',
            maxTokens: '最大输出长度，输出被截断时调大',
            stream: '是否流式，布尔值',
            bypassProxy: '是否绕过酒馆后端直连，布尔值',
            temperature: '温度',
            apiKey: 'API 密钥',
        },
        handler: (patch) => {
            const { profile } = getActiveLlmProfile();
            const applied = [];
            for (const key of [...EDITABLE, 'apiKey']) {
                if (patch[key] === undefined) continue;
                profile[key] = key === 'apiUrl' ? normalizeBase(patch[key]) : patch[key];
                applied.push(key);
            }
            if (!applied.length) throw new Error('没有可修改的字段');
            saveSettings();
            return { applied, current: safeView(profile) };
        },
    },
    {
        id: 'llm.switchProfile',
        summary: '切换到另一个 LLM 预设',
        mutates: true,
        params: { name: '预设名称' },
        handler: ({ name }) => {
            const settings = llmSettings();
            if (!settings.profiles[name]) {
                throw new Error(`不存在的预设：${name}。现有：${Object.keys(settings.profiles).join('、')}`);
            }
            settings.active = name;
            saveSettings();
            return { active: name };
        },
    },
    {
        id: 'llm.createProfile',
        summary: '新建一个 LLM 预设并切换过去',
        mutates: true,
        params: { name: '预设名称', apiUrl: '可选', model: '可选', apiKey: '可选' },
        handler: ({ name, ...init }) => {
            if (!name) throw new Error('缺少预设名称');
            const settings = llmSettings();
            if (settings.profiles[name]) throw new Error(`预设「${name}」已存在`);
            settings.profiles[name] = { ...DEFAULT_LLM_PROFILE, ...init };
            settings.active = name;
            saveSettings();
            return { created: name };
        },
    },
    {
        id: 'llm.listModels',
        summary: '拉取当前 API 地址下实际可用的模型列表。用户不确定该填什么模型名、或模型名报错时调用',
        params: { keyword: '可选，按关键字过滤，如 gpt、claude、gemini' },
        handler: async ({ keyword } = {}) => {
            const { profile } = getActiveLlmProfile();
            const models = await listModels(profile);
            if (!keyword) return { total: models.length, models: models.slice(0, 100) };
            const kw = String(keyword).toLowerCase();
            const hit = models.filter((m) => m.toLowerCase().includes(kw));
            return { total: hit.length, models: hit.slice(0, 100) };
        },
    },
    {
        id: 'llm.test',
        summary: '用当前预设实际发一次最小请求，验证是否真的能连通',
        handler: async () => {
            const { profile } = getActiveLlmProfile();
            return testConnection(profile);
        },
    },
]);
