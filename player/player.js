/**
 * 分段播放器。
 *
 * 持有全部分段和当前位置，因此支持暂停/继续/跳段/重播，
 * 界面也能照着 chunks + index 把台词列出来并高亮当前句。
 *
 * 分段形如 { text, speaker }，speaker 为空表示不区分角色；
 * 合成回调据此为每个角色挑音色，导演台本因而能一段一个声音。
 *
 * 合成结果按段号缓存，跳回上一段不会重新掏钱。
 */

export const State = {
    IDLE: 'idle',
    LOADING: 'loading',
    PLAYING: 'playing',
    PAUSED: 'paused',
};

export class Player {
    #audio = new Audio();
    #chunks = [];
    #synthesize = null;
    #cache = new Map();
    #index = -1;
    #state = State.IDLE;
    #generation = 0;
    #onChange = null;
    #resolveCurrent = null;

    constructor(onChange) {
        this.#onChange = onChange;
        this.#audio.preload = 'auto';
    }

    get state() { return this.#state; }
    get index() { return this.#index; }
    get chunks() { return this.#chunks; }
    get active() { return this.#state !== State.IDLE; }

    setVolume(v) {
        this.#audio.volume = Math.min(1, Math.max(0, Number(v) || 0));
    }

    /** 载入一批分段，替换掉上一次的内容并停止播放。 */
    load(chunks, synthesize) {
        this.stop();
        this.#chunks = [...chunks];
        this.#synthesize = synthesize;
        this.#cache.clear();
        this.#emit();
    }

    play(from = 0) {
        if (!this.#chunks.length) return;
        this.#run(Math.max(0, Math.min(from, this.#chunks.length - 1)));
    }

    pause() {
        if (this.#state !== State.PLAYING) return;
        this.#audio.pause();
        this.#set(State.PAUSED, this.#index);
    }

    resume() {
        if (this.#state !== State.PAUSED) return;
        this.#set(State.PLAYING, this.#index);
        this.#audio.play().catch(() => this.#finishCurrent());
    }

    /** 播放中则暂停，暂停中则继续，停止状态则从头播。 */
    toggle() {
        if (this.#state === State.PLAYING) return this.pause();
        if (this.#state === State.PAUSED) return this.resume();
        this.play(this.#index >= 0 ? this.#index : 0);
    }

    stop() {
        this.#generation += 1;
        this.#audio.pause();
        this.#audio.removeAttribute('src');
        this.#finishCurrent();
        this.#set(State.IDLE, -1);
    }

    seek(index) {
        if (index < 0 || index >= this.#chunks.length) return;
        this.play(index);
    }

    next() { this.seek(this.#index + 1); }

    prev() { this.seek(this.#index - 1); }

    restart() { this.play(0); }

    // ── 内部 ────────────────────────────────────────

    #emit() {
        this.#onChange?.({
            state: this.#state,
            index: this.#index,
            chunks: this.#chunks,
        });
    }

    #set(state, index) {
        this.#state = state;
        this.#index = index;
        this.#emit();
    }

    /** 结束当前那段的等待，避免 stop / 跳段时 Promise 悬着不释放。 */
    #finishCurrent() {
        const resolve = this.#resolveCurrent;
        this.#resolveCurrent = null;
        resolve?.(false);
    }

    #fetch(i) {
        if (!this.#cache.has(i)) {
            this.#cache.set(i, this.#synthesize(this.#chunks[i]));
        }
        return this.#cache.get(i);
    }

    /** 提前合成下一段，消除段与段之间的静音间隔。 */
    #prefetch(i) {
        if (i >= this.#chunks.length) return;
        this.#fetch(i).catch(() => this.#cache.delete(i));
    }

    async #run(from) {
        const gen = ++this.#generation;
        this.#finishCurrent();
        for (let i = from; i < this.#chunks.length; i++) {
            this.#set(State.LOADING, i);
            let blob;
            try {
                blob = await this.#fetch(i);
            } catch (e) {
                this.#cache.delete(i);
                if (gen === this.#generation) this.#fail(e);
                return;
            }
            if (gen !== this.#generation) return;
            this.#prefetch(i + 1);
            this.#set(State.PLAYING, i);
            if (!await this.#playBlob(blob, gen)) return;
        }
        if (gen === this.#generation) this.#set(State.IDLE, -1);
    }

    #fail(error) {
        this.#set(State.IDLE, -1);
        this.#onChange?.({ state: State.IDLE, index: -1, chunks: this.#chunks, error });
    }

    /** @returns {Promise<boolean>} 是否完整播完（被打断返回 false） */
    #playBlob(blob, gen) {
        const url = URL.createObjectURL(blob);
        this.#audio.src = url;
        return new Promise((resolve) => {
            this.#resolveCurrent = resolve;
            const done = (ok) => {
                if (this.#resolveCurrent !== resolve) return;
                this.#resolveCurrent = null;
                this.#audio.onended = null;
                this.#audio.onerror = null;
                URL.revokeObjectURL(url);
                resolve(ok && gen === this.#generation);
            };
            this.#audio.onended = () => done(true);
            this.#audio.onerror = () => done(false);
            this.#audio.play().catch(() => done(false));
        });
    }
}
