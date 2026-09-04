import { registerAll } from '../registry.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { prepare, emptyReason } from '../../core/pipeline.js';

const FIELDS = ['quotedOnly', 'stripEmoji', 'stripUrl', 'volume', 'chunkSize', 'autoRead'];

const SAMPLE = '<think>盘算中</think>“你终于来了。”她放下杯子，*望向窗外*。【好感度+3】';

registerAll([
    {
        id: 'playback.status',
        summary: '查看朗读设置（是否只念引号内对白、是否过滤表情与网址、音量、分段长度、自动朗读）',
        handler: () => getSettings().playback,
    },
    {
        id: 'playback.configure',
        summary: '修改朗读设置。用户说「只念对白」「别念旁白和动作」时把 quotedOnly 设为 true 即可，'
            + '这是内置开关，不要为此写正则',
        mutates: true,
        params: {
            quotedOnly: 'true 表示只朗读引号内的对白，忽略旁白与动作描写',
            stripEmoji: '是否过滤表情符号',
            stripUrl: '是否过滤网址',
            volume: '音量，0~1',
            chunkSize: '分段长度，越小越快出声',
            autoRead: '是否自动朗读角色新消息',
        },
        handler: (patch) => {
            const target = getSettings().playback;
            const applied = FIELDS.filter((k) => patch[k] !== undefined);
            if (!applied.length) throw new Error(`没有可修改的字段，可用：${FIELDS.join('、')}`);
            applied.forEach((k) => { target[k] = patch[k]; });
            saveSettings();
            return { applied, current: target };
        },
    },
    {
        id: 'playback.preview',
        summary: '用当前全部设置（正则 + 清洗 + 分段）处理一段文本，返回最终会被念出来的内容。'
            + '改完设置务必用它确认效果，不发声',
        params: { text: '要试的原文，留空则用内置样例' },
        handler: ({ text } = {}) => {
            const input = text || SAMPLE;
            const { chunks, cleaned, afterRegex, errors } = prepare(input);
            return {
                输入: input,
                过正则后: afterRegex,
                最终朗读: cleaned,
                分段数: chunks.length,
                正则错误: errors,
                提示: cleaned ? '' : emptyReason(),
            };
        },
    },
]);
