/**
 * MiniMax 多 Key 轮询。
 *
 * MiniMax 按 Key 限 RPM，撞上就返回 base_resp.status_code=1002。
 * 这里只做「撞到就冷却、换下一个」，不做本地配额预占——
 * 本地计数和服务端窗口永远对不齐，维护成本远大于收益。
 */

const COOLDOWN_MS = 60_000;

/** key -> 冷却结束时间戳 */
const cooldowns = new Map();

function isAvailable(key, now) {
    return (cooldowns.get(key) ?? 0) <= now;
}

/** 取一个当前可用的 key；全部处于冷却中时返回 null。 */
export function pickKey(keys) {
    const now = Date.now();
    return keys.find((k) => isAvailable(k, now)) ?? null;
}

export function markRateLimited(key) {
    cooldowns.set(key, Date.now() + COOLDOWN_MS);
}

/** 冷却到期最早的 key 还要等多久（毫秒）。用于给用户一个明确的等待时间。 */
export function nextAvailableIn(keys) {
    const now = Date.now();
    const waits = keys.map((k) => Math.max(0, (cooldowns.get(k) ?? 0) - now));
    return waits.length ? Math.min(...waits) : 0;
}

export function getPoolStatus(keys) {
    const now = Date.now();
    return keys.map((key) => ({
        tag: key.slice(0, 6) + '…' + key.slice(-4),
        available: isAvailable(key, now),
        cooldownMs: Math.max(0, (cooldowns.get(key) ?? 0) - now),
    }));
}

export function resetPool() {
    cooldowns.clear();
}
