import { speak, stop } from '../core/pipeline.js';
import { speakHandy } from './hotkey.js';

const SCRIPTS = '../../../../slash-commands';

async function registerModern() {
    const { SlashCommandParser } = await import(`${SCRIPTS}/SlashCommandParser.js`);
    const { SlashCommand } = await import(`${SCRIPTS}/SlashCommand.js`);
    const { SlashCommandArgument, ARGUMENT_TYPE } = await import(`${SCRIPTS}/SlashCommandArgument.js`);

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'xvoice',
        callback: (_args, value) => { speak(String(value ?? '')); return ''; },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: '要朗读的文本',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: '用 xvoice 朗读指定文本',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'xvoice-last',
        callback: () => { speakHandy(); return ''; },
        helpString: '朗读最新一条角色消息；选中了文本则朗读选中内容',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'xvoice-stop',
        callback: () => { stop(); return ''; },
        helpString: '停止 xvoice 朗读',
    }));
}

async function registerLegacy() {
    const { registerSlashCommand } = await import('../../../../slash-commands.js');
    registerSlashCommand('xvoice', (_args, value) => { speak(String(value ?? '')); return ''; },
        [], '用 xvoice 朗读指定文本', true, true);
    registerSlashCommand('xvoice-last', () => { speakHandy(); return ''; },
        [], '朗读最新一条角色消息', true, true);
    registerSlashCommand('xvoice-stop', () => { stop(); return ''; },
        [], '停止 xvoice 朗读', true, true);
}

/** 新版 API 不可用时回落到旧版，跨 ST 版本都能注册上。 */
export async function initSlashCommands() {
    try {
        await registerModern();
    } catch (e) {
        try {
            await registerLegacy();
        } catch (err) {
            console.warn('[xvoice] slash 命令注册失败:', e, err);
        }
    }
}
