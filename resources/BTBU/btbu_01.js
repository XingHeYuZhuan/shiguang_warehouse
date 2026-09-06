// 北京工商大学(btbu.edu.cn) 拾光课程表适配脚本
// 教务系统：强智 · 特征：有效数据在 id='timetable' 内（同官方参考案例 HHTC）
// 使用流程：登录教务 → 培养管理 → 我的课表 → 学期理论课表 → 选择学期 → 点击一键导入
// 维护者：lztttt（出现解析问题请提交 issue 或 PR）
//
// 规范依据：
//   - 桥接 API 使用 v2 规范的 window.shiguangBridge / window.shiguangBridgePromise
//   - 星期几由表头(星期一~星期日)校准的列位置推导，不依赖单元格 id 的书写惯例
//   - 周次解析保留 (单)/(双) 标记并按单双周过滤
//   - 引入官方《课程合并与去重函数》处理 1-2节+3-4节 合并、单双周合并与去重

// =========================================================================
// 桥接封装（浏览器 Alpha 调试时自动降级为 alert/console）
// =========================================================================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[BTBU] ' + message);
    }
}

async function alertUser(title, message) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        return await window.shiguangBridgePromise.showAlert(title, message, '确定');
    }
    alert(title + '\n' + message);
    return true;
}

// showPrompt 的全局校验函数（规范要求：验证通过返回 false，失败返回错误文案）
window.validateSemesterStartDate = function (input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        const d = new Date(input + 'T00:00:00');
        if (!isNaN(d.getTime())) return false;
    }
    return '请输入 YYYY-MM-DD 格式的日期，例如 2025-09-01（学期第一周的周一）';
};

// =========================================================================
// 课表定位
// =========================================================================

function findScheduleDocument() {
    if (document.getElementById('timetable')) return document;

    const frames = Array.from(document.querySelectorAll('iframe'));
    for (const frame of frames) {
        try {
            const frameDoc = frame.contentDocument || frame.contentWindow.document;
            if (frameDoc && frameDoc.getElementById('timetable')) return frameDoc;
        } catch (e) { /* 跨域 iframe 忽略 */ }
    }

    return null;
}

// =========================================================================
// 课表解析：按行列位置定位星期（表头校准），不依赖 kbcontent 的 id 书写惯例
// 说明：强智新版课表单元格 id 的“星期/节次”顺序存在版本差异，官方参考适配
//      （HHTC/STCNCHU）均采用位置法，此处与其保持一致并增加表头校准与 colspan 兼容。
// =========================================================================

// 星期文本 → 数字（1=周一 … 7=周日），无法识别返回 0
function weekdayFromText(text) {
    const match = String(text || '').match(/(?:星期|周)\s*([一二三四五六日天])/);
    if (!match) return 0;
    return { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 }[match[1]];
}

// 扫描前几行表头，建立 “网格列号 → 星期几” 映射（考虑 colspan），至少命中 2 列才认为校准成功
function buildColumnDayMap(rows) {
    const map = {};
    for (let r = 0; r < Math.min(rows.length, 4); r++) {
        let col = 0;
        const headerCells = rows[r].querySelectorAll('th,td');
        for (let c = 0; c < headerCells.length; c++) {
            const span = parseInt(headerCells[c].getAttribute('colspan') || '1', 10) || 1;
            const day = weekdayFromText(headerCells[c].textContent);
            if (day >= 1 && day <= 7 && map[col] === undefined) map[col] = day;
            col += span;
        }
        if (Object.keys(map).length >= 2) break;
    }
    return map;
}

// 计算单元格在所在行中的网格列号（0 起，考虑 colspan）
function gridColumnIndexOf(cell) {
    const row = cell.parentElement;
    if (!row) return -1;
    let col = 0;
    for (let i = 0; i < row.children.length; i++) {
        if (row.children[i] === cell) return col;
        const span = parseInt(row.children[i].getAttribute('colspan') || '1', 10) || 1;
        col += span;
    }
    return -1;
}

/**
 * 解析“周次(节次)”文本 → { weeks: Number[], sections: Number[] }
 * 兼容格式：
 *   "1-16周[01-02节]"、"1-8,10-16(周)[03-04节]"、"5(周)[05-06节]"
 *   "1-15周(单)[01-02节]"、"2-16(双)[01-02节]" 等单双周写法
 */
function parseWeeksAndSections(text) {
    const result = { weeks: [], sections: [] };
    const str = String(text || '').trim();
    if (!str) return result;

    // 1) 单双周标记（不能随分隔符一起丢掉）
    let parity = 0; // 1=单周 2=双周
    if (/双/.test(str)) parity = 2;
    else if (/单/.test(str)) parity = 1;

    // 2) 周次部分：取节次方括号“[”之前的内容，剥掉全部括号标记（(周)/(单)/(双)）与“周”字
    const bracketIdx = str.indexOf('[');
    const weekPart = bracketIdx >= 0 ? str.slice(0, bracketIdx) : str;
    const cleaned = weekPart
        .replace(/第/g, '')
        .replace(/至|到/g, '-')
        .replace(/[（(][^（）()]*[）)]/g, '')
        .replace(/周/g, '');

    for (let seg of cleaned.split(/[,，、;；\s]+/)) {
        seg = seg.trim();
        if (!seg) continue;
        const range = seg.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
        if (range) {
            let a = parseInt(range[1], 10);
            let b = parseInt(range[2], 10);
            if (a > b) { const t = a; a = b; b = t; }
            for (let w = a; w <= b; w++) result.weeks.push(w);
        } else {
            const w = parseInt(seg, 10);
            if (!isNaN(w)) result.weeks.push(w);
        }
    }

    // 3) 应用单双周过滤并排序去重
    if (parity === 1) result.weeks = result.weeks.filter(w => w % 2 === 1);
    else if (parity === 2) result.weeks = result.weeks.filter(w => w % 2 === 0);
    result.weeks = Array.from(new Set(result.weeks)).sort((a, b) => a - b);

    // 4) 节次部分：“[01-02节]”→[1,2]，“[03-04-05节]”→[3,4,5]
    //    北工商存在三小节连排（如 03-04-05），直接提取方括号内全部数字
    const secMatch = str.match(/\[([^\]]*)\]/);
    if (secMatch) {
        const nums = secMatch[1].match(/\d+/g);
        if (nums) {
            for (let i = 0; i < nums.length; i++) {
                const s = parseInt(nums[i], 10);
                if (!isNaN(s)) result.sections.push(s);
            }
        }
    }

    return result;
}

// 清理课程名称文本：剥离课程编号/课号前缀与后缀，返回纯课名（可能为空）
function cleanCourseName(text) {
    let name = String(text || '').trim();
    if (!name) return '';
    // “课程编号：XXX”（kchConfig 里的编号已在 DOM 层移除，这里兜底）
    name = name.replace(/课程编号\s*[:：]?\s*[A-Z0-9]+/gi, '');
    // 行首字母开头的短编码（如 CS101、GS140001），后随中文/空白/括号才剔除，
    // 避免误伤 “MATLAB程序设计” 等以字母开头的真实课名
    name = name.replace(/^[A-Za-z]{1,6}\d{2,10}[A-Za-z]?(?=[\u4e00-\u9fa5\s（(])\s*/, '');
    // 行首长编码（北工商形如 080901C4S2007：连续字母数字≥8位且含数字，后随中文/括号）
    name = name.replace(/^[A-Za-z0-9]{8,16}(?=[\u4e00-\u9fa5（(])/, function (m) {
        return /\d/.test(m) ? '' : m;
    });
    // 行首纯数字编码（如 “14000101高等数学”）
    name = name.replace(/^\d{5,12}(?=[\u4e00-\u9fa5\s（(])\s*/, '');
    // 行尾编码（如 “高等数学01110037”“高等数学（01110037）”）
    name = name.replace(/[（(][0-9A-Za-z]{5,16}[)）]\s*$/, '');
    name = name.replace(/([\u4e00-\u9fa5）)])(\d{5,12}[A-Za-z]?)\s*$/, '$1');
    return name.trim();
}

// 是否为“纯编号”文本（不含中文），兼容北工商形态 "080901C4S2007"、纯数字 "01110037"、"GS140001"
function isPureCourseCode(text) {
    if (/[\u4e00-\u9fa5]/.test(text)) return false;
    if (/^\d{6,16}$/.test(text)) return true;
    return /^[A-Z0-9]{6,16}$/.test(text) && /\d/.test(text) && /[A-Za-z]/.test(text);
}

// 解析一个课表格子（.kbcontent / .kbcontent1）内的课程信息，追加到 out
// 北工商真实结构（依据 samples/xskb_list.html 校准）：
//   课名 = 无 title 的外层 font，内嵌 <font class="kchConfig">（含 hint 与纯编号）+ <br> + 课名；
//   元数据 font 带 title：教师 / 周次(节次) / 教室 / 教学楼 / 通知单编号 / 班级 / 备注 / 课程二维码；
//   周次文本形如 “1-16(周)[01-02节]”“1-16(周)[03-04-05节]”“9(周)”；
//   教务渲染的隐藏 kbcontent1 与可见 kbcontent 内容重复，由 parseTimetable 负责跳过。
function parseCellInto(cellDiv, day, out, rowSections) {
    const allFonts = cellDiv.getElementsByTagName('font');
    const fonts = [];
    for (let i = 0; i < allFonts.length; i++) {
        // 跳过嵌套在另一个 font 内部的 font（kchConfig/hint 会随外层整体清理）
        if (allFonts[i].parentElement && allFonts[i].parentElement.tagName === 'FONT') continue;
        fonts.push(allFonts[i]);
    }

    let current = null;
    let pendingCode = null; // 尚未等到课名的纯编号

    const pushCurrent = function () {
        if (current) {
            // 无 [节次] 括号时，用所在行标签的节次范围兜底（如 “1~2节”）
            if (current.sections.length === 0 && rowSections) {
                for (let s = rowSections[0]; s <= rowSections[1]; s++) current.sections.push(s);
            }
            out.push(current);
            current = null;
        }
    };
    const startCourse = function (name) {
        pushCurrent();
        current = { name: name, position: '', teacher: '', weeks: [], day: day, sections: [] };
    };

    for (let j = 0; j < fonts.length; j++) {
        const f = fonts[j];
        const title = f.getAttribute('title') || '';

        if (!title) {
            const tempNode = f.cloneNode(true);
            const kchElements = tempNode.getElementsByClassName('kchConfig');
            while (kchElements.length > 0) kchElements[0].parentNode.removeChild(kchElements[0]);

            const text = tempNode.textContent.replace(/\u00a0/g, ' ').trim();
            if (!text || /^[-—\s]+$/.test(text)) {
                // 同格两门课之间的 “------” 分隔线：结算上一门
                pushCurrent();
                pendingCode = null;
                continue;
            }

            // 关键：用清理后的名字判断是否课名，避免 “课程编号：XXX” 被清成纯编号后误当成课名
            const name = cleanCourseName(text);
            if (name && /[\u4e00-\u9fa5]/.test(name)) {
                startCourse(name);
                pendingCode = null;
            } else if (name && isPureCourseCode(name)) {
                if (!current) pendingCode = name; // 编号在课名之前单独出现，先暂存
                // 课程已开始时出现的编号只是附加信息，忽略
            }
        } else if (title.indexOf('课程') !== -1 && title.indexOf('周次') === -1) {
            // title=“课程名称”（其他强智变体的结构）
            const name = cleanCourseName(f.textContent.trim());
            if (name) startCourse(name);
            pendingCode = null;
        } else {
            if (!current && pendingCode) {
                // 编号后直接跟元数据且始终无课名：以编号兜底建课，避免丢课
                startCourse(pendingCode);
            }
            pendingCode = null;
            if (current) {
                const text = f.textContent.trim();
                // title 兼容 “教师/老师” 两种强智写法
                if (title.indexOf('教师') !== -1 || title.indexOf('老师') !== -1) {
                    current.teacher = text;
                } else if (title.indexOf('周次') !== -1) {
                    const parsed = parseWeeksAndSections(text);
                    current.weeks = parsed.weeks;
                    current.sections = parsed.sections;
                } else if (title.indexOf('教室') !== -1) {
                    current.position = text;
                }
            }
        }
    }
    pushCurrent();
}

function parseTimetable(doc) {
    const table = doc.getElementById('timetable');
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr'));
    const colDayMap = buildColumnDayMap(rows);
    console.log('[BTBU] 表头校准（列号→星期）:', JSON.stringify(colDayMap));

    const result = [];
    for (let r = 0; r < rows.length; r++) {
        // 行标签里的节次范围（北工商形如 “1~2节 (01,02小节) 08:00-09:35”），作为无 [节次] 括号时的兜底
        const firstCell = rows[r].querySelector('th,td');
        const labelMatch = firstCell ? String(firstCell.textContent).match(/(\d+)\s*[~～]\s*(\d+)\s*节/) : null;
        const rowSections = labelMatch ? [parseInt(labelMatch[1], 10), parseInt(labelMatch[2], 10)] : null;

        const cells = rows[r].querySelectorAll('.kbcontent, .kbcontent1');
        if (cells.length === 0) continue;

        for (let i = 0; i < cells.length; i++) {
            const cellDiv = cells[i];
            // 北工商的 kbcontent1 是 display:none 的缩略副本，与同格 kbcontent 内容重复，跳过
            // （其他强智变体中可见的 kbcontent1 表示同格第二门课，不受影响）
            if (cellDiv.style && cellDiv.style.display === 'none') continue;

            const ownerCell = cellDiv.closest('td,th');
            if (!ownerCell) continue;

            const col = gridColumnIndexOf(ownerCell);
            if (col < 0) continue;

            // 优先使用表头校准结果；无表头时退化为“列号+1”（强智首列通常为节次标签列）
            const day = colDayMap[col] !== undefined ? colDayMap[col] : col + 1;
            if (day < 1 || day > 7) continue;

            parseCellInto(cellDiv, day, result, rowSections);
        }
    }
    return result;
}

// =========================================================================
// 数据结构转换与合并（官方推荐）
// =========================================================================

function convertCourses(rawCourses) {
    return rawCourses
        .map(function (item) {
            const sections = item.sections;
            return {
                name: item.name,
                teacher: item.teacher || '未知教师',
                position: item.position || '未知地点',
                day: item.day,
                startSection: sections[0],
                endSection: sections[sections.length - 1],
                weeks: item.weeks
            };
        })
        .filter(function (c) {
            return c.weeks.length > 0 &&
                Number.isInteger(c.startSection) && Number.isInteger(c.endSection);
        });
}

/**
 * 节次与周次合并去重函数
 * 来源：官方 Wiki《课程合并与去重函数》
 * https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
 * 功能：连续节次合并(1-2节+3-4节→1-4节)、同节次周次合并(单双周)、完全去重、周次排序
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
    // 北工商调整（官方允许按学校特殊情况修改）：同一门课跨大节时教师/教室可能不同
    // （如 JAVA核心编程 1-2节在工2-107、3-4节在工2-401机房），故合并条件放宽为
    // 名称+星期+周次一致且节次连续，教师与教室沿用第一段；完全重复的记录仍然去重。
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// =========================================================================
// 保存流程（顺序遵循规范参考：配置 → 课程 → 时间段；时间段失败不阻塞导入）
// =========================================================================

async function promptSemesterStartDate() {
    if (!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showPrompt === 'function')) {
        return null;
    }
    const input = await window.shiguangBridgePromise.showPrompt(
        '学期开始日期',
        '请输入本学期第一周的周一日期（YYYY-MM-DD），软件将据此校准当前周次。\n如不清楚可点击取消跳过，稍后可在软件内设置。',
        '',
        'validateSemesterStartDate'
    );
    return (input && String(input).trim()) ? String(input).trim() : null;
}

async function saveCourseConfig(rawCourses) {
    const allWeeks = rawCourses.flatMap(function (c) { return c.weeks; });
    const maxWeek = allWeeks.length > 0 ? Math.max.apply(null, allWeeks) : 20;

    const startDate = await promptSemesterStartDate();

    const config = {
        semesterTotalWeeks: maxWeek > 0 ? maxWeek : 20,
        firstDayOfWeek: 1,
        defaultBreakDuration: 5
    };
    if (startDate) {
        config.semesterStartDate = startDate;
    } else {
        toast('未设置学期开始日期，可稍后在软件内手动校准周次');
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        console.error('[BTBU] 保存课表配置失败:', error);
        toast('课表配置保存失败：' + (error && error.message ? error.message : error));
        return false;
    }
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        console.error('[BTBU] 保存课程失败:', error);
        toast('课程保存失败：' + (error && error.message ? error.message : error));
        return false;
    }
}

async function importPresetTimeSlots() {
    const timeSlots = [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:50', endTime: '09:35' },
        { number: 3, startTime: '09:50', endTime: '10:35' },
        { number: 4, startTime: '10:40', endTime: '11:25' },
        { number: 5, startTime: '11:30', endTime: '12:15' },
        { number: 6, startTime: '13:40', endTime: '14:25' },
        { number: 7, startTime: '14:30', endTime: '15:15' },
        { number: 8, startTime: '15:30', endTime: '16:15' },
        { number: 9, startTime: '16:20', endTime: '17:05' },
        { number: 10, startTime: '17:10', endTime: '17:55' },
        { number: 11, startTime: '18:45', endTime: '19:30' },
        { number: 12, startTime: '19:35', endTime: '20:20' },
        { number: 13, startTime: '20:25', endTime: '21:10' }
    ];

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return true;
    } catch (error) {
        // 规范：时间段导入失败通常不阻止最终流程完成
        console.warn('[BTBU] 时间段导入失败(不阻塞):', error);
        toast('作息时间导入失败，可稍后在软件内手动设置');
        return false;
    }
}

// =========================================================================
// 流程编排
// =========================================================================

/**
 * 编排整个课程导入流程。
 * 任何一步用户取消或失败都立即退出；notifyTaskCompletion 只在完全成功后调用。
 */
async function runImportFlow() {
    try {
        const doc = findScheduleDocument();
        if (!doc) {
            await alertUser(
                '未找到课表',
                '请不要在教务系统主页直接导入。请先进入培养管理-我的课表-学期理论课表页面，选择学期，并等待课表加载完成后再点击导入。'
            );
            return;
        }

        const confirmed = await alertUser(
            '北工商课表导入',
            '将解析当前页面显示的学期理论课表。\n请确认已选择正确的学期，且课表已加载完成。'
        );
        if (!confirmed) {
            toast('导入已取消');
            return;
        }

        toast('正在解析课表...');
        const rawCourses = parseTimetable(doc);
        if (rawCourses.length === 0) {
            await alertUser(
                '未解析到课程',
                '当前页面没有解析到有效课程。请确认停留在学期理论课表页面且课表中有课程信息。'
            );
            return;
        }

        // 1. 课表配置（含学期开始日期，可跳过）
        const configSaved = await saveCourseConfig(rawCourses);
        if (!configSaved) return;

        // 2. 课程数据（核心）
        const courses = mergeAndDistinctCourses(convertCourses(rawCourses));
        const saved = await saveCourses(courses);
        if (!saved) return;

        // 3. 预设作息时间段（失败不阻塞导入结果）
        await importPresetTimeSlots();

        toast('导入成功：共 ' + courses.length + ' 条课程时段');
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error('BTBU import failed:', error);
        await alertUser('导入失败', error && error.message ? error.message : String(error));
    }
}

// 启动导入流程
runImportFlow();
