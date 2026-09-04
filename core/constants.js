// 全局常量。所有模块共用，避免各处硬编码字符串。

export const EXT_NAME = 'xvoice';
export const EXT_PATH = `scripts/extensions/third-party/${EXT_NAME}`;

/** TTS 供应商标识 */
export const Provider = {
    MINIMAX: 'minimax',
    AZURE: 'azure',
};

/** 正则作用位置（与 SillyTavern 正则脚本的 placement 兼容） */
export const Placement = {
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
};
