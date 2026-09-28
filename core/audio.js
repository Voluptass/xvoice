/**
 * 音频处理的纯函数部分：多声道混单声道、线性重采样、编码 16-bit PCM WAV。
 *
 * 只依赖 TypedArray，不碰浏览器 API，方便单测。
 * 录音（MediaRecorder / getUserMedia）在 ui/recorder.js 里，录完的解码结果
 * 就用这里的函数转成 MiniMax 接受的 wav。
 */

/** 多声道混成单声道。 */
export function mixToMono(channels) {
    if (!channels?.length) return new Float32Array(0);
    if (channels.length === 1) return channels[0];
    const length = Math.min(...channels.map((c) => c.length));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const channel of channels) sum += channel[i] || 0;
        out[i] = sum / channels.length;
    }
    return out;
}

/** 线性插值重采样。 */
export function resample(input, srcRate, dstRate) {
    if (!input?.length || !srcRate || !dstRate || srcRate === dstRate) return input;
    const ratio = srcRate / dstRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(i0 + 1, input.length - 1);
        const frac = pos - i0;
        out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
}

/**
 * 把 [-1,1] 的浮点采样编成 16-bit PCM 单声道 WAV。
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = (text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset++, text.charCodeAt(i));
    };
    const writeUint32 = (value) => { view.setUint32(offset, value, true); offset += 4; };
    const writeUint16 = (value) => { view.setUint16(offset, value, true); offset += 2; };
    const writeInt16 = (value) => { view.setInt16(offset, value, true); offset += 2; };

    writeString('RIFF');
    writeUint32(36 + dataSize);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);                          // fmt 块长度
    writeUint16(1);                           // PCM
    writeUint16(1);                           // 单声道
    writeUint32(sampleRate);
    writeUint32(sampleRate * bytesPerSample); // 字节率
    writeUint16(bytesPerSample);              // 块对齐
    writeUint16(16);                          // 位深
    writeString('data');
    writeUint32(dataSize);

    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        writeInt16(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff));
    }
    return new Uint8Array(buffer);
}
