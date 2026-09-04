import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { EXT_NAME, Provider } from './constants.js';

/** 单个 LLM 预设的默认值。maxTokens 给足，避免 JSON 输出被截断。 */
export const DEFAULT_LLM_PROFILE = {
    apiUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    stream: false,
    bypassProxy: false,
    mergeSystemUser: true,
};

const DEFAULTS = {
    version: 1,
    llm: {
        profiles: { 默认: { ...DEFAULT_LLM_PROFILE } },
        active: '默认',
    },
    tts: {
        provider: Provider.MINIMAX,
        cacheEnabled: true,
        minimax: {
            apiKeys: [],
            platform: 'cn',
            model: 'speech-2.8-hd',
            voiceId: 'male-qn-qingse',
            speed: 1.0,
            vol: 1.0,
            pitch: 0,
            emotion: '',
        },
        azure: {
            apiKey: '',
            region: 'eastasia',
            voice: 'zh-CN-XiaoxiaoNeural',
            rate: 0,
            pitch: 0,
        },
    },
    regex: {
        entries: [],
        testMode: false,
    },
    playback: {
        volume: 1.0,
        autoRead: false,
        chunkSize: 200,
        stripEmoji: true,
        stripUrl: true,
        quotedOnly: false,
    },
    assistant: {
        sessions: [],
    },
    director: {
        voiceMode: 'ai',
        roleVoices: {},
    },
};

/** 递归补齐缺失字段，保留用户已有值。数组整体替换，不逐项合并。 */
function fillDefaults(target, defaults) {
    for (const [key, def] of Object.entries(defaults)) {
        if (target[key] === undefined) {
            target[key] = structuredClone(def);
        } else if (isPlainObject(def) && isPlainObject(target[key])) {
            fillDefaults(target[key], def);
        }
    }
    return target;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 读取配置，首次调用时初始化并补齐默认值。 */
export function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(DEFAULTS);
    }
    return fillDefaults(extension_settings[EXT_NAME], DEFAULTS);
}

/** 保存并广播变更，UI 与助手改配置后界面能自动同步。 */
export function saveSettings() {
    saveSettingsDebounced();
    document.dispatchEvent(new CustomEvent('xvoice:settings-changed'));
}

/**
 * 取当前生效的 LLM 预设。
 * 绑定的预设不存在时回落到第一个，并通过返回值告知调用方，由 UI 显式提示。
 * @returns {{profile: object, name: string, fellBack: boolean}}
 */
export function getActiveLlmProfile() {
    const { profiles, active } = getSettings().llm;
    if (profiles[active]) {
        return { profile: profiles[active], name: active, fellBack: false };
    }
    const first = Object.keys(profiles)[0];
    if (!first) {
        return { profile: { ...DEFAULT_LLM_PROFILE }, name: '', fellBack: true };
    }
    return { profile: profiles[first], name: first, fellBack: true };
}
