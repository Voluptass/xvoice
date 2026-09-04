import { registerAll } from '../registry.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { direct, writeScript, castOf } from '../../core/director.js';
import { speakScript } from '../../core/pipeline.js';
import { lastCharacterMessage } from '../../core/chat-source.js';

const MODES = ['ai', 'manual'];

function directorSettings() {
    return getSettings().director;
}

registerAll([
    {
        id: 'director.run',
        summary: '把最近一条角色回复拆成台本并按角色分音色朗读。用户说「按角色朗读」「男女主分开读」时用它',
        mutates: true,
        params: { play: '可选，false 表示只出台本不播放，默认播放' },
        handler: async ({ play } = {}) => {
            const { lines, cast, roleVoices, missing, mode } = await direct();
            if (play !== false) speakScript(lines);
            return { mode, cast, 台词数: lines.length, roleVoices, 未配音色: missing, lines };
        },
    },
    {
        id: 'director.preview',
        summary: '只拆台本不朗读，用来确认角色和台词分得对不对',
        params: { text: '可选，要拆的正文，留空则取最近一条角色回复' },
        handler: async ({ text } = {}) => {
            const lines = await writeScript(text || lastCharacterMessage());
            return { cast: castOf(lines), 台词数: lines.length, lines };
        },
    },
    {
        id: 'director.status',
        summary: '查看导演的音色分配模式与已配好的角色音色表',
        handler: () => {
            const { voiceMode, roleVoices } = directorSettings();
            return { voiceMode, roleVoices, 已配角色数: Object.keys(roleVoices).length };
        },
    },
    {
        id: 'director.setVoiceMode',
        summary: '切换角色音色的分配方式：ai 为自动挑选，manual 为完全手动指定',
        mutates: true,
        params: { mode: 'ai 或 manual' },
        handler: ({ mode }) => {
            if (!MODES.includes(mode)) throw new Error(`模式只能是 ${MODES.join(' 或 ')}`);
            directorSettings().voiceMode = mode;
            saveSettings();
            return { voiceMode: mode };
        },
    },
    {
        id: 'director.setRoleVoice',
        summary: '手动指定某个角色用哪个音色。音色 id 需来自 tts.listVoices',
        mutates: true,
        params: { speaker: '角色名，如 男主 / 女主 / 旁白', voice: '音色 id' },
        handler: ({ speaker, voice }) => {
            if (!speaker || !voice) throw new Error('需要同时提供 speaker 和 voice');
            directorSettings().roleVoices[speaker] = voice;
            saveSettings();
            return { speaker, voice };
        },
    },
    {
        id: 'director.clearRoleVoices',
        summary: '清空角色音色表，让下次导演重新分配',
        mutates: true,
        handler: () => {
            const count = Object.keys(directorSettings().roleVoices).length;
            directorSettings().roleVoices = {};
            saveSettings();
            return { cleared: count };
        },
    },
]);
