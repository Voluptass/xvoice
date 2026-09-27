import { characters, this_chid, saveSettingsDebounced } from '../../../../../script.js';
import { getSettings } from './settings.js';

/**
 * 角色配音按「角色卡」分开存。
 *
 * SillyTavern 里同时只有一张角色卡/一个群聊在生效，但不同卡的配角往往是
 * 两拨人（镜宫、安辞 属于卡 A；心、露 属于卡 B）。全局一张表会互相污染，
 * 所以按卡隔离：单角色卡用头像文件名当 key（角色名可能重名，头像不会），
 * 群聊用群 id 当 key。
 */

const DEFAULT_KEY = '__default__';

/** 取 ST 上下文；老版本没有 globalThis.SillyTavern 时返回 null。 */
function context() {
    try {
        return globalThis.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

/** 当前聊天绑定的角色卡标识。 */
export function currentCardKey() {
    const ctx = context();
    if (ctx?.groupId) return `group:${ctx.groupId}`;
    const id = ctx?.characterId ?? this_chid;
    const card = (ctx?.characters ?? characters)?.[id];
    return card?.avatar ? `card:${card.avatar}` : DEFAULT_KEY;
}

/** 当前角色卡的可读名字，用于界面提示。 */
export function currentCardLabel() {
    const ctx = context();
    if (ctx?.groupId) {
        const group = (ctx.groups || []).find((g) => String(g.id) === String(ctx.groupId));
        return group?.name || '群聊';
    }
    const id = ctx?.characterId ?? this_chid;
    const card = (ctx?.characters ?? characters)?.[id];
    return card?.name || '';
}

let migrated = false;

/**
 * 老版本只有一张全局表 director.roleVoices。
 * 第一次确定当前角色卡时，把它整体迁到该卡的桶里，然后清空旧表——
 * 之后每张卡各管各的。
 */
function ensureMigrated() {
    if (migrated) return;
    const key = currentCardKey();
    if (key === DEFAULT_KEY) return; // 还没选角色卡，等下次再说
    migrated = true;

    const { director } = getSettings();
    if (!director.roleVoicesByCard) director.roleVoicesByCard = {};
    const legacy = director.roleVoices || {};
    const hasBuckets = Object.keys(director.roleVoicesByCard).length > 0;
    if (!hasBuckets && Object.keys(legacy).length) {
        director.roleVoicesByCard[key] = { ...legacy };
        director.roleVoices = {};
        saveSettingsDebounced();
    }
}

/** 当前角色卡的角色配音表（可直接改）。 */
export function getRoleVoices() {
    ensureMigrated();
    const { director } = getSettings();
    if (!director.roleVoicesByCard) director.roleVoicesByCard = {};
    const key = currentCardKey();
    if (!director.roleVoicesByCard[key]) director.roleVoicesByCard[key] = {};
    return director.roleVoicesByCard[key];
}

/** 某个角色当前用的音色 id；没配过返回空串。 */
export function roleVoiceFor(speaker) {
    if (!speaker) return '';
    return getRoleVoices()[speaker] || '';
}
