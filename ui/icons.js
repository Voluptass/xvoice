/**
 * 图标统一走 Font Awesome（酒馆自带），不再用 emoji。
 *
 * emoji 在不同系统上字重、基线和颜色各不相同，和界面其他部分对不齐；
 * 图标字体能继承文字颜色和字号，暗色主题下观感一致。
 */

/** @param {string} name FA6 名字，如 'play'、'volume-high' */
export function icon(name, extra = '') {
    return `<i class="fa-solid fa-${name}${extra ? ` ${extra}` : ''}" aria-hidden="true"></i>`;
}

export const ICON = {
    play: icon('play'),
    pause: icon('pause'),
    stop: icon('stop'),
    prev: icon('backward-step'),
    next: icon('forward-step'),
    restart: icon('rotate-left'),
    spinner: icon('spinner', 'fa-spin'),
    preview: icon('play'),
    previewing: icon('stop'),
    trash: icon('trash-can'),
    director: icon('clapperboard'),
    extract: icon('quote-left'),
    extractAi: icon('robot'),
};
