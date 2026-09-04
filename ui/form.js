/**
 * 极简的数据驱动表单。
 *
 * 旧插件把每个设置项都写成独立的 html + js 文件，最后有 40 个文件、
 * 上千行重复的取值赋值代码。这里用字段描述生成界面并自动双向绑定，
 * 新增一个设置项只需要往数组里加一行。
 *
 * @typedef {object} FieldSpec
 * @property {string} key      配置对象上的属性名
 * @property {string} label
 * @property {'text'|'password'|'number'|'checkbox'|'select'|'textarea'|'list'} type
 * @property {Array<{value: string, label: string}>} [options] select 用
 * @property {string} [hint]   显示在输入框下方的说明
 * @property {string} [datalist] 关联的 datalist id，让输入框获得原生下拉与过滤
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 */

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inputHtml(spec) {
    const attr = `data-xv-key="${spec.key}" class="text_pole"`;
    switch (spec.type) {
        case 'select':
            return `<select ${attr}>${(spec.options || [])
                .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
                .join('')}</select>`;
        case 'checkbox':
            return `<input type="checkbox" data-xv-key="${spec.key}">`;
        case 'textarea':
        case 'list':
            return `<textarea ${attr} rows="${spec.rows || 3}"></textarea>`;
        case 'number':
            return `<input type="number" ${attr} min="${spec.min ?? ''}" max="${spec.max ?? ''}" step="${spec.step ?? 'any'}">`;
        default: {
            const list = spec.datalist ? ` list="${spec.datalist}"` : '';
            return `<input type="${spec.type}" ${attr}${list} autocomplete="off">`;
        }
    }
}

export function renderFields(specs) {
    return specs.map((spec) => {
        const hint = spec.hint ? `<small class="xvoice-hint">${escapeHtml(spec.hint)}</small>` : '';
        const row = spec.type === 'checkbox'
            ? `<label class="checkbox_label">${inputHtml(spec)}<span>${escapeHtml(spec.label)}</span></label>`
            : `<label>${escapeHtml(spec.label)}</label>${inputHtml(spec)}`;
        return `<div class="xvoice-field" data-xv-field="${spec.key}">${row}${hint}</div>`;
    }).join('');
}

function readElement(el, spec) {
    if (spec.type === 'checkbox') return el.checked;
    if (spec.type === 'number') return Number(el.value);
    if (spec.type === 'list') return el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    return el.value;
}

function writeElement(el, spec, value) {
    if (spec.type === 'checkbox') el.checked = !!value;
    else if (spec.type === 'list') el.value = (value || []).join('\n');
    else el.value = value ?? '';
}

/**
 * 把字段绑到配置对象上。返回 refresh()，配置被外部改动（例如 AI 助手改的）时调用。
 * @param {HTMLElement} root
 * @param {FieldSpec[]} specs
 * @param {() => object} getTarget 每次读写都重新取，以支持切换供应商等场景
 * @param {() => void} onChange
 */
export function bindFields(root, specs, getTarget, onChange) {
    const pairs = specs
        .map((spec) => ({ spec, el: root.querySelector(`[data-xv-key="${spec.key}"]`) }))
        .filter((p) => p.el);

    const refresh = () => {
        const target = getTarget();
        pairs.forEach(({ spec, el }) => writeElement(el, spec, target[spec.key]));
    };

    pairs.forEach(({ spec, el }) => {
        el.addEventListener('change', () => {
            getTarget()[spec.key] = readElement(el, spec);
            onChange?.();
        });
    });

    refresh();
    return refresh;
}
