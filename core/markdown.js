/**
 * 极简 Markdown 渲染（助手气泡用）。
 *
 * 先整体转义 HTML，再按块 / 内联规则替换——顺序很关键：模型输出不可信，
 * 先转义就杜绝了 <script> 之类被当成标签执行。
 * 只覆盖对话里常见的语法：标题、列表、引用、代码、粗斜体、链接、分割线。
 */

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 只放行 http/https/mailto，挡掉 javascript: 之类。 */
function safeUrl(url) {
    const u = String(url || '').trim();
    return /^(https?:|mailto:)/i.test(u) ? u : '';
}

function inline(text) {
    let s = text;
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, '$1');   // 图片只留 alt 文本
    s = s.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (m, label, url) => {
        const href = safeUrl(url);
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
}

const QUOTE = /^\s*(?:&gt;|>)\s?/;
const BLOCK_START = /^(?:```|#{1,6}\s|\s*(?:&gt;|>)\s?|\s*[-*+]\s|\s*\d+[.)]\s|\s*([-*_])(?:\s*\1){2,}\s*$)/;

/**
 * @param {string} text Markdown 源文本
 * @returns {string} HTML
 */
export function renderMarkdown(text) {
    const lines = escapeHtml(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let list = null;
    let i = 0;

    const closeList = () => {
        if (list) { out.push(`</${list}>`); list = null; }
    };

    while (i < lines.length) {
        const line = lines[i];

        // 围栏代码块
        const fence = /^```(.*)$/.exec(line);
        if (fence) {
            closeList();
            const lang = fence[1].trim();
            const buf = [];
            i += 1;
            while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
            i += 1; // 跳过结束的 ```
            out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${buf.join('\n')}</code></pre>`);
            continue;
        }

        if (!line.trim()) { closeList(); i += 1; continue; }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeList(); out.push('<hr>'); i += 1; continue; }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i += 1;
            continue;
        }

        if (QUOTE.test(line)) {
            closeList();
            const buf = [];
            while (i < lines.length && QUOTE.test(lines[i])) {
                buf.push(lines[i].replace(QUOTE, ''));
                i += 1;
            }
            out.push(`<blockquote>${inline(buf.join('<br>'))}</blockquote>`);
            continue;
        }

        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
        const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (bullet || ordered) {
            const want = bullet ? 'ul' : 'ol';
            if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
            out.push(`<li>${inline((bullet || ordered)[1])}</li>`);
            i += 1;
            continue;
        }

        // 普通段落：把连续的非块级行并成一段
        closeList();
        const buf = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
            buf.push(lines[i]);
            i += 1;
        }
        out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }

    closeList();
    return out.join('');
}
