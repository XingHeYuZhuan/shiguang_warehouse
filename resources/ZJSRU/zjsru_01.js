// 浙江树人学院（浙江树人大学）拾光课程表适配脚本
// 学校: 浙江树人学院 / 浙江树人大学 (zjsru.edu.cn, ZJSRU)
// 教务系统: xk.jwc.zjsru.edu.cn —— 正方教务 ASP.NET WebForms 版（xskbcx.aspx 学生个人课表）
// 登录方式: 统一身份认证 CAS (rz.zjsru.edu.cn)，教务首页 http://xk.jwc.zjsru.edu.cn/ 会自动跳转
//
// 适配要点:
//   1. 这是正方的 WebForms 版：课表由服务端渲染成 HTML 表格（table#Table1.schedule），
//      不是 SHUFEZJ / UJS 用的 JSON 接口（kbcx/xskbcx_cxXsKb.html -> kbList）。
//      单元格内用 <br> 分行：课程名 / 周X第N节{周次} / 教师 / 教室，
//      且同一个格子里可能并排多门课（如周三第6节同时排了多门实验课），需要按
//      「周X第N节」这一行作锚点切分。
//   2. 课表页的学年/学期是服务端控件（select#xnd / select#xqd），切换要 __doPostBack 回发，
//      所以这里读取下拉项后用 __EVENTTARGET=xnd 回发拿到目标学期的 HTML。
//   3. 软件是在用户点击「执行导入」时把脚本注入到 WebView 当前页面执行一次，
//      而 CAS 登录后一般停在教务首页(xs_main.aspx)，因此脚本会自己在同域内拉取课表页。
//   4. 作息时间取自学校官方校历底部印的《上课时间表》：
//        https://www.zjsru.edu.cn/info/1411/54428.htm
//      两个校区节次时刻不同，导入时由用户选择（见 CAMPUS_TIME_SLOTS）：
//        · 拱宸桥校区：第一节 08:10 起，共 12 节
//        · 杨汛桥校区：第一节 08:30 起，且不设第五节
//   5. 本适配器同时适用于校内直连与校外 WebVPN 通道：
//      WebVPN 下页面地址形如 /https/webvpn<hash>/xskbcx.aspx?...
//      （<hash> 由服务端按资源分配，无法推导），脚本的取数基址是从
//      location.pathname 推出来的，因此无需知道 hash 也能正确请求。
//
// 参考: 仓库内 SUDA（苏州大学）适配器 —— 同为 table#Table1.schedule 结构；
//       多校区作息参照 GDPU / HNSF 的写法
// Author: CagierAsh123

// ========================== 常量 ==========================

// 课表页里「周X第N节{周次}」这一行的形态
const ZJSRU_PERIOD_RE = /^周([一二三四五六日天])第([0-9]+(?:,[0-9]+)*)节(?:\{([^}]*)\})?$/;
const ZJSRU_DAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };
const ZJSRU_TERM_NAMES = { "1": "第1学期", "2": "第2学期", "3": "第3学期(短)" };
const ZJSRU_TABLE_SELECTOR = "table#Table1.schedule";
const ZJSRU_MIN_TOTAL_WEEKS = 18; // 学期总周数下限，避免个别短课表把学期截断

// ========================== 作息时间（来源：学校官方校历） ==========================
// https://www.zjsru.edu.cn/info/1411/54428.htm 底部《上课时间表》
// 注：杨汛桥校区不设第五节。软件的作息校验要求节次必须从 1 起连续编号
//     （validateTimeSlotsOrThrow），否则导入会直接报错；而教务系统给杨汛桥
//     学生排课时仍沿用全校统一的节次号（下午第一节叫「第六节」），
//     所以这里保留 5 号占位并用 alias 说明，以保证第六节仍然落在 6 号上。
const ZJSRU_CAMPUS_TIME_SLOTS = {
    gongchenqiao: {
        label: "拱宸桥校区",
        slots: [
            { number: 1, startTime: "08:10", endTime: "08:50" },
            { number: 2, startTime: "09:00", endTime: "09:40" },
            { number: 3, startTime: "09:55", endTime: "10:35" },
            { number: 4, startTime: "10:45", endTime: "11:25" },
            { number: 5, startTime: "11:35", endTime: "12:15" },
            { number: 6, startTime: "13:30", endTime: "14:10" },
            { number: 7, startTime: "14:20", endTime: "15:00" },
            { number: 8, startTime: "15:10", endTime: "15:50" },
            { number: 9, startTime: "16:00", endTime: "16:40" },
            { number: 10, startTime: "18:10", endTime: "18:50" },
            { number: 11, startTime: "19:00", endTime: "19:40" },
            { number: 12, startTime: "19:50", endTime: "20:30" }
        ]
    },
    yangxunqiao: {
        label: "杨汛桥校区",
        slots: [
            { number: 1, startTime: "08:30", endTime: "09:10" },
            { number: 2, startTime: "09:15", endTime: "09:55" },
            { number: 3, startTime: "10:10", endTime: "10:50" },
            { number: 4, startTime: "10:55", endTime: "11:35" },
            { number: 5, startTime: "11:35", endTime: "12:15", alias: "不设第五节" },
            { number: 6, startTime: "13:30", endTime: "14:10" },
            { number: 7, startTime: "14:15", endTime: "14:55" },
            { number: 8, startTime: "15:05", endTime: "15:45" },
            { number: 9, startTime: "15:50", endTime: "16:30" },
            { number: 10, startTime: "18:00", endTime: "18:40" },
            { number: 11, startTime: "18:45", endTime: "19:25" },
            { number: 12, startTime: "19:30", endTime: "20:10" }
        ]
    }
};

// ========================== 解析函数 ==========================

/**
 * 取出单元格的文本行。正方的课程信息用 <br> 分行，需要先把 <br> 还原成换行。
 */
function zjsruCellLines(cell) {
    const doc = cell.ownerDocument || document;
    const html = (cell.innerHTML || "").replace(/<br\s*\/?>/gi, "\n");
    const tmp = doc.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || "")
        .split("\n")
        .map(s => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

/**
 * 解析花括号里的周次，兼容：
 *   "第2-18周" / "第9-9周" / "第3-17周|单周" / "第2-18周|双周"
 *   "第1-5,7-9周"（多段）
 * 返回升序去重后的周次数组。
 */
function zjsruParseWeeks(brace) {
    if (!brace) return [];
    const weeks = new Set();
    // 单双周标记对整个花括号生效
    const odd = /\|?\s*单周/.test(brace);
    const even = /\|?\s*双周/.test(brace);
    // 只取「周」之前的部分，去掉 "单周/双周" 这类尾巴
    const body = brace.split("|")[0].replace(/第/g, "").replace(/周/g, "");
    for (const seg of body.split(",")) {
        const part = seg.trim();
        if (!part) continue;
        const range = part.match(/(\d+)\s*[-~－—]\s*(\d+)/);
        let start, end;
        if (range) {
            start = parseInt(range[1], 10);
            end = parseInt(range[2], 10);
        } else {
            const single = part.match(/(\d+)/);
            if (!single) continue;
            start = end = parseInt(single[1], 10);
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        if (start > end) [start, end] = [end, start];
        if (end > 60) end = 60; // 防御异常数据
        for (let w = start; w <= end; w++) {
            if (odd && w % 2 === 0) continue;
            if (even && w % 2 === 1) continue;
            weeks.add(w);
        }
    }
    return [...weeks].sort((a, b) => a - b);
}

/**
 * 解析一个单元格里的所有课程。
 * 结构: 课程名 / 周X第N节{周次} / 教师 / 教室 [/ 附加信息...]，多门课依次排列。
 * 星期取自课程自身的「周X」，不依赖表格列序，列布局变化也不会错位。
 */
function zjsruParseCell(cell) {
    const lines = zjsruCellLines(cell);
    const anchors = [];
    for (let i = 0; i < lines.length; i++) {
        if (ZJSRU_PERIOD_RE.test(lines[i])) anchors.push(i);
    }
    const courses = [];
    for (let a = 0; a < anchors.length; a++) {
        const k = anchors[a];
        const name = (lines[k - 1] || "").trim();
        if (!name) continue;
        const m = lines[k].match(ZJSRU_PERIOD_RE);
        if (!m) continue;
        const day = ZJSRU_DAY_MAP[m[1]];
        if (!day) continue;
        const sections = m[2].split(",").map(s => parseInt(s, 10)).filter(Number.isFinite);
        if (!sections.length) continue;
        const weeks = zjsruParseWeeks(m[3]);
        if (!weeks.length) continue;
        // 本门课的附加行：下一门课的课名行为界
        const stop = (a + 1 < anchors.length) ? anchors[a + 1] - 1 : lines.length;
        const rest = lines.slice(k + 1, stop);
        courses.push({
            name: name,
            teacher: (rest[0] || "").trim(),
            position: (rest[1] || "").trim(),
            day: day,
            startSection: Math.min(...sections),
            endSection: Math.max(...sections),
            weeks: weeks
        });
    }
    return courses;
}

/**
 * 解析整个课表表格。正方的 rowspan 单元格在 DOM 里只属于一行，
 * 直接遍历所有 td 不会重复；星期由每门课自己的「周X」决定。
 */
function zjsruParseTable(table) {
    const courses = [];
    for (const cell of table.querySelectorAll("td")) {
        for (const c of zjsruParseCell(cell)) courses.push(c);
    }
    return zjsruMergeAdjacent(zjsruDedupe(courses));
}

/**
 * 去重：同名、同教师、同地点、同星期、同节次、同周次视为同一条
 * （rowspan 或页面重复渲染可能产生重复条目）
 */
function zjsruDedupe(list) {
    const seen = new Set();
    return list.filter(c => {
        const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection,
            c.weeks.join(",")].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 合并同一门课在相邻节次上的分段（不同周次/地点不合并，单双周保持独立）
 */
function zjsruMergeAdjacent(list) {
    const groups = new Map();
    for (const c of list) {
        const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(",")].join("|");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }
    const merged = [];
    for (const entries of groups.values()) {
        entries.sort((a, b) => a.startSection - b.startSection);
        let cur = Object.assign({}, entries[0]);
        for (let i = 1; i < entries.length; i++) {
            const next = entries[i];
            if (next.startSection <= cur.endSection + 1) {
                cur.endSection = Math.max(cur.endSection, next.endSection);
            } else {
                merged.push(cur);
                cur = Object.assign({}, next);
            }
        }
        merged.push(cur);
    }
    return merged;
}

// ========================== 页面定位 ==========================

/**
 * 查找课表表格，兼容直接打开课表页与同源 iframe 嵌套
 */
function zjsruFindTable(doc) {
    doc = doc || document;
    let table = doc.querySelector(ZJSRU_TABLE_SELECTOR);
    if (table) return table;
    for (const iframe of doc.querySelectorAll("iframe")) {
        try {
            const inner = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (!inner) continue;
            table = inner.querySelector(ZJSRU_TABLE_SELECTOR);
            if (table) return table;
        } catch (_) { /* 跨域忽略 */ }
    }
    return null;
}

/**
 * 识别学号：优先取当前 URL 的 xh 参数，其次找教务首页菜单里的 xh=xxxx 链接。
 * 正方课表页需要 xh 参数，拿不到时兜底用不带 xh 的地址再试一次。
 */
function zjsruDetectStudentId(doc) {
    doc = doc || document;
    try {
        const fromUrl = new URLSearchParams(location.search).get("xh");
        if (fromUrl && /^\d{4,}$/.test(fromUrl.trim())) return fromUrl.trim();
    } catch (_) { /* ignore */ }
    for (const a of doc.querySelectorAll("a[href*='xh=']")) {
        const m = (a.getAttribute("href") || "").match(/[?&]xh=(\d{4,})/);
        if (m) return m[1];
    }
    const m2 = (doc.documentElement ? doc.documentElement.innerHTML : "").match(/[?&]xh=(\d{4,})/);
    return m2 ? m2[1] : "";
}

function zjsruScheduleUrl(studentId) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const qs = studentId ? ("?xh=" + encodeURIComponent(studentId) + "&type=1") : "?type=1";
    return new URL("xskbcx.aspx" + qs, base).toString();
}

async function zjsruFetchDoc(url) {
    const res = await fetch(url, { method: "GET", credentials: "include" });
    if (!res.ok) return null;
    const html = await res.text();
    return new DOMParser().parseFromString(html, "text/html");
}

/**
 * 读取课表页上的学年/学期下拉项，供用户选择要导入的学期
 */
function zjsruReadTermOptions(doc) {
    const yearSel = doc.querySelector("select#xnd");
    const termSel = doc.querySelector("select#xqd");
    if (!yearSel || !termSel) return null;
    const years = [...yearSel.options].map(o => o.value).filter(v => v);
    const terms = [...termSel.options].map(o => o.value).filter(v => v);
    if (!years.length || !terms.length) return null;
    const combos = [];
    for (const y of years) {
        for (const t of terms) combos.push({ year: y, term: t });
    }
    const current = combos.findIndex(c => c.year === yearSel.value && c.term === termSel.value);
    return { combos: combos, currentIndex: current < 0 ? 0 : current };
}

/**
 * 切换学年/学期：正方用 __EVENTTARGET 回发，必须带上当前页的 __VIEWSTATE
 */
async function zjsruFetchTermDoc(url, doc, year, term) {
    const pick = (name) => {
        const el = doc.querySelector("input[name='" + name + "']");
        return el ? el.value : "";
    };
    const body = new URLSearchParams();
    body.set("__EVENTTARGET", "xnd");
    body.set("__EVENTARGUMENT", "");
    body.set("__LASTFOCUS", "");
    body.set("__VIEWSTATE", pick("__VIEWSTATE"));
    body.set("__VIEWSTATEGENERATOR", pick("__VIEWSTATEGENERATOR"));
    body.set("xnd", year);
    body.set("xqd", term);
    const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
    });
    if (!res.ok) return null;
    const html = await res.text();
    return new DOMParser().parseFromString(html, "text/html");
}

// ========================== 主流程 ==========================

/**
 * 让用户选择所在校区（决定导入哪一套作息时间）
 */
async function zjsruSelectCampus() {
    const keys = Object.keys(ZJSRU_CAMPUS_TIME_SLOTS);
    const labels = keys.map(k => ZJSRU_CAMPUS_TIME_SLOTS[k].label);
    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择所在校区",
        JSON.stringify(labels),
        0
    );
    if (idx === null || idx === undefined || idx < 0 || idx >= keys.length) return null;
    return keys[idx];
}

/**
 * 导入所选校区的作息时间
 */
async function zjsruImportTimeSlots(campusKey) {
    const campus = ZJSRU_CAMPUS_TIME_SLOTS[campusKey];
    if (!campus) return;
    window.shiguangBridge.showToast("正在导入" + campus.label + "作息时间...");
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(campus.slots));
        console.log("JS: 已导入 " + campus.label + " 作息 " + campus.slots.length + " 节");
    } catch (error) {
        console.error("JS: 导入作息时间失败:", error);
        window.shiguangBridge.showToast("作息时间导入失败: " + error.message);
    }
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "浙江树人学院 · 教务导入",
        "请先在本页面完成统一身份认证（CAS）登录。\n\n"
        + "导入时会自动拉取「学生个人课表」，并识别可选的学年/学期供你选择，"
        + "不需要手动打开课表页。",
        "我已登录，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 1. 定位课表页：当前页就是课表页则直接用，否则在同域内拉取
    window.shiguangBridge.showToast("正在获取课表页面...");
    let doc = document;
    let url = "";
    let table = zjsruFindTable(doc);

    if (!table) {
        if (!/(^|\.)zjsru\.edu\.cn$/.test(location.hostname)) {
            window.shiguangBridge.showToast("当前不在浙江树人学院教务系统页面，请先登录教务系统。");
            return;
        }
        const studentId = zjsruDetectStudentId(document);
        url = zjsruScheduleUrl(studentId);
        doc = await zjsruFetchDoc(url);
        if (!doc) {
            window.shiguangBridge.showToast("课表页请求失败，请检查登录状态或网络环境。");
            return;
        }
        table = zjsruFindTable(doc);
        if (!table) {
            window.shiguangBridge.showToast("未获取到课表，请确认已登录统一身份认证（CAS）。");
            return;
        }
    }

    // 2. 让用户选择学年/学期（默认当前学期）
    const termInfo = zjsruReadTermOptions(doc);
    if (termInfo && termInfo.combos.length > 1) {
        const labels = termInfo.combos.map(c =>
            c.year + " 学年 " + (ZJSRU_TERM_NAMES[c.term] || ("第" + c.term + "学期")));
        const picked = await window.shiguangBridgePromise.showSingleSelection(
            "选择要导入的学期",
            JSON.stringify(labels),
            termInfo.currentIndex
        );
        if (picked === null || picked === undefined || picked < 0) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        const target = termInfo.combos[picked];
        const shownYear = (doc.querySelector("select#xnd") || {}).value;
        const shownTerm = (doc.querySelector("select#xqd") || {}).value;
        if (target.year !== shownYear || target.term !== shownTerm) {
            window.shiguangBridge.showToast("正在切换到 " + labels[picked] + "...");
            const pageUrl = url || (location.origin + location.pathname + location.search);
            const switched = await zjsruFetchTermDoc(pageUrl, doc, target.year, target.term);
            if (!switched) {
                window.shiguangBridge.showToast("切换学期失败，请稍后重试。");
                return;
            }
            const switchedTable = zjsruFindTable(switched);
            if (!switchedTable) {
                window.shiguangBridge.showToast("切换后的页面未包含课表，请稍后重试。");
                return;
            }
            doc = switched;
            table = switchedTable;
        }
    }

    // 3. 选择校区（决定导入哪一套作息时间；两个校区节次时刻不同）
    const campusKey = await zjsruSelectCampus();
    if (campusKey === null) {
        window.shiguangBridge.showToast("导入已取消，未选择校区。");
        return;
    }

    // 4. 解析课程
    window.shiguangBridge.showToast("正在解析课程数据...");
    const courses = zjsruParseTable(table);
    console.log("JS: 解析到 " + courses.length + " 条课程记录");
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到任何课程，该学期可能没有排课。");
        return;
    }

    // 5. 保存课程
    window.shiguangBridge.showToast("正在保存 " + courses.length + " 条课程...");
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return;
    }

    // 6. 保存课表配置（学期开始日期留空，由用户在软件内设置，避免周次整体偏移）
    try {
        const maxWeek = courses.reduce((mx, c) => Math.max(mx, ...c.weeks), 0);
        const config = {
            semesterStartDate: null,
            semesterTotalWeeks: Math.max(ZJSRU_MIN_TOTAL_WEEKS, maxWeek)
        };
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        console.error("JS: 保存课表配置失败:", error);
    }

    // 7. 导入所选校区的作息时间
    await zjsruImportTimeSlots(campusKey);

    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 条课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
