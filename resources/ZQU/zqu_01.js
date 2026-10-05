// 肇庆学院(zqu.edu.cn) 拾光课程表适配脚本
// 教务系统：URP 系（Struts2，形如 xxx!yyy.action）
// 适用范围：本脚本为【WebVPN 校外访问】版本；校内直连版本另行提交
// 维护者：NoobLLiu
//
// 数据来源说明：
// 课表页（课表查询 → 我的课表）用的是 entss_Calendar 组件异步取数，
// 页面网格与「列表展示」背后是同一个接口，因此本脚本不做 HTML 表格解析，
// 而是直接请求后台 JSON 接口：
//     GET xsgrkbcx!getKbRq.action?xnxqdm=<学年学期>&zc=<周次>&xsdm=
// 返回 [课程数组, 日期数组]，字段完整、稳定，不受页面改版影响。
//
// 使用前提：用户已在弹窗打开的网页中登录 WebVPN 并进入教务系统，
// 停留在教务系统内的任意页面即可（脚本会自行定位站点根路径）。

// ---------------------------------------------------------------- 常量

const KB_MAIN = 'xsgrkbcx!xsgrkbMain.action'; // 课表查询主页（含学期/周次下拉框）
const KB_DATA = 'xsgrkbcx!getKbRq.action';    // 课表数据接口（返回 JSON）

// 深信服 WebVPN 在直接请求后台接口时，部分部署要求带上目标主机标记。
// 若实测接口返回的不是 JSON（例如返回登录页 HTML），把这里改成
// 'vpn-12-o2-jwgl.zqu.edu.cn' 后再试。留空表示不带标记。
const WEBVPN_HOST_MARKER = '';

// 肇庆学院作息时间（每天 14 节），依据学校实际作息表。
// 仅在无法从教务系统读到作息时作为保底使用。
const PRESET_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:40' },
    { number: 2, startTime: '08:50', endTime: '09:30' },
    { number: 3, startTime: '09:50', endTime: '10:30' },
    { number: 4, startTime: '10:40', endTime: '11:20' },
    { number: 5, startTime: '11:30', endTime: '12:10' },
    { number: 6, startTime: '14:30', endTime: '15:10' },
    { number: 7, startTime: '15:20', endTime: '16:00' },
    { number: 8, startTime: '16:15', endTime: '16:55' },
    { number: 9, startTime: '17:05', endTime: '17:45' },
    { number: 10, startTime: '17:55', endTime: '18:35' },
    { number: 11, startTime: '19:00', endTime: '19:40' },
    { number: 12, startTime: '19:50', endTime: '20:30' },
    { number: 13, startTime: '20:40', endTime: '21:20' },
    { number: 14, startTime: '21:30', endTime: '22:10' }
];

// 教室待定时使用的占位文本（教务系统已排课但教室尚未分配）
const PENDING_POSITION = '教室待定';

// ---------------------------------------------------------------- 工具函数

/**
 * 推算教务系统的站点根路径。
 *
 * WebVPN 下页面地址形如：
 *   https://webvpn.zqu.edu.cn/https/<加密串>/xsgrkbcx!xsgrkbMain.action
 * 校内直连下形如：
 *   https://jwgl.zqu.edu.cn/xsgrkbcx!xsgrkbMain.action
 * 取到 <加密串>/ 这一层，后续所有接口都基于它拼接。
 */
function siteBase() {
    try {
        const u = new URL(window.location.href);
        const path = u.pathname;
        const marks = ['xsgrkbcx!', 'desktop!', 'login!', 'framework!', 'index!'];
        for (const m of marks) {
            const i = path.indexOf(m);
            if (i > 0) return u.origin + path.slice(0, i);
        }
        const i = path.lastIndexOf('/');
        return u.origin + (i > 0 ? path.slice(0, i + 1) : '/');
    } catch (e) {
        const href = window.location.href.split(/[?#]/)[0];
        const i = href.lastIndexOf('/');
        return i > 0 ? href.slice(0, i + 1) : href;
    }
}

/**
 * 拼装接口地址；WEBVPN_HOST_MARKER 非空时插入目标主机标记。
 */
function apiUrl(base, action, params) {
    const qs = Object.keys(params)
        .map(k => k + '=' + encodeURIComponent(params[k]))
        .join('&');
    const marker = WEBVPN_HOST_MARKER ? WEBVPN_HOST_MARKER + '&' : '';
    return base + action + '?' + marker + qs;
}

/**
 * 从教务页面中读取下拉框选项。
 * @returns {{cur: string, opts: Array<{value: string, text: string}>}|null}
 */
function readSelectOptions(doc, id) {
    const sel = doc.querySelector('#' + id);
    if (!sel) return null;
    const opts = Array.from(sel.options)
        .filter(o => String(o.value).trim() !== '')
        .map(o => ({ value: String(o.value).trim(), text: (o.textContent || '').trim() }));
    if (opts.length === 0) return null;
    return { cur: String(sel.value).trim(), opts: opts };
}

/**
 * 解析节次字段，返回节号数组。
 * jcdm2 形如 "01,02,03"；jcdm 形如 "0102"（连写）。
 */
function parseSections(jcdm2, jcdm) {
    const txt = String(jcdm2 || jcdm || '').trim();
    const nums = [];
    const push = n => { if (n > 0 && nums.indexOf(n) === -1) nums.push(n); };
    for (const raw of txt.split(/[,\s]+/)) {
        const part = raw.trim();
        if (!part || !/^\d+$/.test(part)) continue;
        if (part.length <= 2) {
            push(parseInt(part, 10));
        } else {
            for (let i = 0; i < part.length; i += 2) {
                push(parseInt(part.slice(i, i + 2), 10));
            }
        }
    }
    return nums.sort((a, b) => a - b);
}

/**
 * 由 "YYYY-MM-DD" 推前 n 天，返回同样的字符串。
 */
function shiftDate(dateStr, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    dt.setUTCDate(dt.getUTCDate() + days);
    const pad = n => (n < 10 ? '0' + n : '' + n);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
}

/**
 * 节次与周次合并去重函数（摘自拾光课程表官方 wiki 的参考实现）。
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
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
            current.teacher === next.teacher &&
            current.position === next.position &&
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

    // 阶段 2：合并同节次的周次
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

// ---------------------------------------------------------------- 数据获取

/**
 * 读取课表查询页的学期与周次下拉框。
 * 直接在返回的 HTML 上做 DOMParser，避免受 iframe 层级影响。
 */
async function fetchTermAndWeekOptions(base) {
    const resp = await fetch(base + KB_MAIN, { method: 'GET', credentials: 'include' });
    if (!resp.ok) throw new Error('课表查询页返回 HTTP ' + resp.status);

    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const terms = readSelectOptions(doc, 'xnxqdm');
    const weeksRaw = readSelectOptions(doc, 'zc');

    if (!terms) throw new Error('未在课表查询页找到学期下拉框（#xnxqdm）');

    const weekNumbers = weeksRaw
        ? weeksRaw.opts
            .map(o => parseInt(o.value, 10))
            .filter(n => Number.isInteger(n) && n > 0)
            .sort((a, b) => a - b)
        : [];

    return { terms: terms, weekNumbers: Array.from(new Set(weekNumbers)) };
}

/**
 * 请求某一周的课表原始数据。
 * @returns {{courses: Array, dates: Array}|null}
 */
async function fetchWeekData(base, termCode, week) {
    const url = apiUrl(base, KB_DATA, { xnxqdm: termCode, zc: String(week), xsdm: '' });
    const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!resp.ok) return null;

    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        // 未登录/被 WebVPN 拦截时会返回 HTML，交由上层统一提示
        return null;
    }
    if (!Array.isArray(data) || data.length < 2) return null;
    return { courses: data[0] || [], dates: data[1] || [] };
}

/**
 * 遍历所有周次，聚合成拾光课程表需要的课程数组。
 * 同一门课在每一周都会返回一条记录，因此这里按
 * 「课程名+教师+教室+星期+起止节次」聚合出 weeks 数组。
 */
async function collectCourses(base, termCode, weekNumbers) {
    const bucket = new Map();
    let startDateAnchor = null; // { week, weekday, date }

    for (let i = 0; i < weekNumbers.length; i++) {
        const w = weekNumbers[i];
        const data = await fetchWeekData(base, termCode, w);

        if (data) {
            for (const d of data.dates) {
                if (!d) continue;
                const wd = parseInt(d.xqmc, 10);
                const rq = String(d.rq || '').trim();
                if (!Number.isInteger(wd) || wd < 1 || wd > 7) continue;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(rq)) continue;
                if (startDateAnchor === null && wd === 1) {
                    startDateAnchor = { week: w, weekday: wd, date: rq };
                }
            }

            for (const c of data.courses) {
                if (!c || typeof c !== 'object') continue;

                const day = parseInt(c.xq, 10);
                if (!Number.isInteger(day) || day < 1 || day > 7) continue;

                const name = String(c.kcmc || '').trim();
                if (!name) continue;

                const sections = parseSections(c.jcdm2, c.jcdm);
                if (sections.length === 0) continue;

                const teacher = String(c.teaxms || '').trim();
                const position = String(c.jxcdmc || '').trim() || PENDING_POSITION;
                const startSection = sections[0];
                const endSection = sections[sections.length - 1];

                const key = [name, teacher, position, day, startSection, endSection].join('\u0001');
                let item = bucket.get(key);
                if (!item) {
                    item = { name, teacher, position, day, startSection, endSection, weeks: [] };
                    bucket.set(key, item);
                }
                if (item.weeks.indexOf(w) === -1) item.weeks.push(w);
            }
        }

        // 进度提示：每抓 5 周报一次，避免刷屏
        if (i === 0 || (i + 1) % 5 === 0 || i === weekNumbers.length - 1) {
            window.shiguangBridge.showToast('正在读取课表 ' + (i + 1) + '/' + weekNumbers.length + ' 周 ...');
        }
    }

    const courses = Array.from(bucket.values()).map(c => ({
        name: c.name,
        teacher: c.teacher,
        position: c.position,
        day: c.day,
        startSection: c.startSection,
        endSection: c.endSection,
        weeks: c.weeks.sort((a, b) => a - b)
    }));

    // 学期开始日期：用「某一周的周一」倒推第 1 周周一
    let semesterStartDate = null;
    if (startDateAnchor) {
        semesterStartDate = shiftDate(startDateAnchor.date, -(startDateAnchor.week - 1) * 7);
    }

    return { courses: mergeAndDistinctCourses(courses), semesterStartDate: semesterStartDate };
}

// ---------------------------------------------------------------- 交互

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        '肇庆学院课表导入',
        '导入前请确认：\n1) 已在当前网页登录 WebVPN；\n2) 已进入教务系统（停留在任意页面即可）。',
        '开始导入'
    );
}

async function selectTerm(terms) {
    const texts = terms.opts.map(o => o.text);
    let defIdx = terms.opts.findIndex(o => o.value === terms.cur);
    if (defIdx < 0) defIdx = 0;

    const idx = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期', JSON.stringify(texts), defIdx);
    if (idx === null || idx < 0 || idx >= terms.opts.length) return null;
    return terms.opts[idx];
}

async function importPresetTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        window.shiguangBridge.showToast('导入时间段失败: ' + error.message);
    }
}

// ---------------------------------------------------------------- 主流程

async function runImportFlow() {
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast('用户取消了导入。');
        return;
    }

    const base = siteBase();

    let options;
    try {
        window.shiguangBridge.showToast('正在读取学期与周次 ...');
        options = await fetchTermAndWeekOptions(base);
    } catch (error) {
        window.shiguangBridge.showToast('读取学期失败：' + error.message +
            '（请确认已登录并进入教务系统）');
        return;
    }

    const term = await selectTerm(options.terms);
    if (term === null) {
        window.shiguangBridge.showToast('未选择学期，导入流程终止。');
        return;
    }

    const weekNumbers = options.weekNumbers;
    if (weekNumbers.length === 0) {
        window.shiguangBridge.showToast('未读取到周次，导入流程终止。');
        return;
    }

    const result = await collectCourses(base, term.value, weekNumbers);
    if (result.courses.length === 0) {
        window.shiguangBridge.showToast('未获取到课表数据，请检查登录状态或稍后重试。');
        return;
    }

    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
    } catch (error) {
        window.shiguangBridge.showToast('课程保存失败: ' + error.message);
        return;
    }

    try {
        const config = { semesterTotalWeeks: weekNumbers.length };
        if (result.semesterStartDate) config.semesterStartDate = result.semesterStartDate;
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        window.shiguangBridge.showToast('课表配置保存失败: ' + error.message);
    }

    await importPresetTimeSlots(PRESET_TIME_SLOTS);

    window.shiguangBridge.showToast('导入完成，共 ' + result.courses.length + ' 个课程时段。');
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
