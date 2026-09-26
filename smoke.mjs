import { clean, split, parseDialogue } from './core/text.js';
import { applyAll } from './regex/apply.js';
import { inspect } from './regex/danger.js';
import { fromStFormat, toStFormat, createEntry, BUILTIN_ENTRIES } from './regex/entry.js';
import { parseCalls, stripCalls, formatResults } from './assistant/protocol.js';
import { hexToBlob } from './tts/provider.js';

let pass = 0, fail = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + '\n       实际: ' + JSON.stringify(actual) + '\n       期望: ' + JSON.stringify(expected)); }
}
function checkThat(name, cond, note) {
    if (cond) { pass++; console.log('  OK   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); }
}

console.log('\n[文本清洗]');
check('剥离强调与标题',
    clean('# 标题\n**加粗**和*斜体*'), '标题\n加粗和斜体');
check('去掉代码块',
    clean('前```js\nlet a=1;\n```后'), '前 后');
check('去掉 HTML 标签',
    clean('<div class="x">你好</div>'), '你好');
check('链接保留文字去掉地址',
    clean('看[这里](https://a.com)'), '看这里');
check('过滤裸链接', clean('见 https://a.com/b 谢谢'), '见 谢谢');
check('只念引号内对白',
    clean('他说“你好啊”，然后*转身*。', { quotedOnly: true }), '你好啊');

console.log('\n[分片]');
const chunks = split('第一句。第二句！第三句？', 8);
checkThat('按句切分且不超长', chunks.every((c) => c.length <= 8), JSON.stringify(chunks));
checkThat('内容无丢失', chunks.join('') === '第一句。第二句！第三句？', JSON.stringify(chunks));
const long = split('这是一个非常长的句子里面完全没有任何句号所以必须被硬切开来处理', 10);
checkThat('超长单句被硬切', long.length > 1 && long.every((c) => c.length <= 10), JSON.stringify(long));

console.log('\n[本地对白提取]');
check('名字前缀', parseDialogue('爱丽丝：“你好。”她放下杯子。'), [{ speaker: '爱丽丝', text: '你好。' }]);
check('引号后置说话人', parseDialogue('“你终于来了。”爱丽丝说。'), [{ speaker: '爱丽丝', text: '你终于来了。' }]);
check('markdown 加粗 + 跨行说话人', parseDialogue('**爱丽丝**：\n“第一句。”\n“第二句。”'),
    [{ speaker: '爱丽丝', text: '第一句。' }, { speaker: '爱丽丝', text: '第二句。' }]);
check('说话人向后延续', parseDialogue('“A。”爱丽丝说。“B。”'),
    [{ speaker: '爱丽丝', text: 'A。' }, { speaker: '爱丽丝', text: 'B。' }]);
check('一行多个说话人', parseDialogue('“A。”爱丽丝说。“B。”鲍勃说。'),
    [{ speaker: '爱丽丝', text: 'A。' }, { speaker: '鲍勃', text: 'B。' }]);
check('无引号返回空', parseDialogue('旁白：这里没有任何引号。'), []);
check('无法判断时标“未知”', parseDialogue('“谁在说话？”'), [{ speaker: '未知', text: '谁在说话？' }]);
check('【状态栏】不会被当成说话人', parseDialogue('【好感度+3】“继续走。”'), [{ speaker: '未知', text: '继续走。' }]);
check('名字前有噪声也能认出', parseDialogue('他看起来有些紧张 爱丽丝：“你终于来了。”'),
    [{ speaker: '爱丽丝', text: '你终于来了。' }]);

console.log('\n[正则管线]');
const rules = [
    createEntry({ name: '去思维链', find: '/<think>[\\s\\S]*?<\\/think>/g', replace: '' }),
    createEntry({ name: '去状态栏', find: '/【[^】]*】/g', replace: '' }),
];
const raw = '<think>盘算中</think>“你终于来了。”【好感度+3】';
check('规则按序生效', applyAll(raw, rules).text, '“你终于来了。”');

const backref = [createEntry({ name: '反向引用', find: '/\\[(\\w+)\\]/g', replace: '$1' })];
check('$1 反向引用', applyAll('前[name]后', backref).text, '前name后');

const macro = [createEntry({ name: 'match 宏', find: '/\\d+/g', replace: '<{{match}}>' })];
check('{{match}} 宏', applyAll('a12b', macro).text, 'a<12>b');

const broken = [createEntry({ name: '坏规则', find: '/([/g' }), ...backref];
const result = applyAll('前[name]后', broken);
checkThat('坏规则不影响其他规则', result.text === '前name后', result.text);
checkThat('坏规则被记录', result.errors.length === 1, JSON.stringify(result.errors));

const disabled = [createEntry({ name: '停用', find: '/./g', replace: '', enabled: false })];
check('停用的规则被跳过', applyAll('abc', disabled).text, 'abc');

console.log('\n[内置清洗规则]');
checkThat('默认启用且启用替换为空',
    BUILTIN_ENTRIES.every((e) => e.enabled && e.find && e.replace === ''), JSON.stringify(BUILTIN_ENTRIES.map((e) => e.name)));
check('默认剥掉 <think> 思维链',
    applyAll('a<think>盘算一下</think>b', BUILTIN_ENTRIES).text, 'ab');
check('默认剥掉 <thinking> 思维链（含换行）',
    applyAll('前<thinking>很长\n的内容</thinking>后', BUILTIN_ENTRIES).text, '前后');
check('大小写不敏感', applyAll('<Think>x</Think>', BUILTIN_ENTRIES).text, '');
const onlyThink = BUILTIN_ENTRIES.filter((e) => e.name.includes('<think>'));
const onlyThinking = BUILTIN_ENTRIES.filter((e) => e.name.includes('<thinking>'));
check('<think> 规则不误伤 <thinking>',
    applyAll('<thinking>x</thinking>', onlyThink).text, '<thinking>x</thinking>');
check('<thinking> 规则不误伤 <think>',
    applyAll('<think>x</think>', onlyThinking).text, '<think>x</think>');

console.log('\n[危险正则]');
checkThat('嵌套量词被识别', !inspect('(a+)+').safe);
checkThat('连续通配被识别', !inspect('.*.*').safe);
checkThat('正常正则放行', inspect('/<think>[\\s\\S]*?<\\/think>/g').safe, JSON.stringify(inspect('/<think>[\\s\\S]*?<\\/think>/g').warnings));
checkThat('常见清洗规则放行', inspect('/【[^】]*】/g').safe);

console.log('\n[ST 格式互转]');
const st = { scriptName: '测试', findRegex: '/a/g', replaceString: 'b', disabled: true, placement: [2] };
const imported = fromStFormat(st);
check('导入保留匹配式', imported.find, '/a/g');
check('disabled 反转为 enabled', imported.enabled, false);
check('回转 ST 格式', toStFormat(imported).disabled, true);
check('非法输入返回 null', fromStFormat({ foo: 1 }), null);

console.log('\n[助手协议]');
const reply = '我看一下。<xv name="diagnose.run">{}</xv>顺便查正则<xv name="regex.list"></xv>';
check('解析出两个调用', parseCalls(reply).map((c) => c.id), ['diagnose.run', 'regex.list']);
check('去掉标签留自然语言', stripCalls(reply), '我看一下。顺便查正则');
check('坏 JSON 被标记', !!parseCalls('<xv name="a">{坏}</xv>')[0].error, true);
check('结果格式化', formatResults([{ ok: true, id: 'a', result: 1 }]), '<xv-result name="a">1</xv-result>');

console.log('\n[音频解码]');
const blob = hexToBlob('494433', 'audio/mpeg');
checkThat('hex 转 Blob 长度正确', blob.size === 3, 'size=' + blob.size);
let threw = false;
try { hexToBlob('abc', 'audio/mpeg'); } catch { threw = true; }
checkThat('奇数长度 hex 报错', threw);

console.log('\n' + (fail ? `失败 ${fail} 项，通过 ${pass} 项` : `全部 ${pass} 项通过`));
process.exit(fail ? 1 : 0);
