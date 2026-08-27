// 吉利学院(GUC) 拾光课程表适配脚本
// YETHAN以专教学信息服务平台
// 该教务系统带图片验证码，需用户在页面内手动登录，脚本基于已登录会话(Cookie)拉取课表
// 桥接 API 使用 v2：window.shiguangBridge(同步) / window.shiguangBridgePromise(异步)


//*****吐槽（>-<）*****
// ===== YETHAN 系统特性（适配脚本为何做了这么多特判） =====
// 1. 页面标题错乱：课表页 <title>="学生个人信息"、重修页="选课日志"（模板没改标题）
// 2. 无校历/学期开始日期字段——开学日期只能从"按周查课表"表头偷（且表头只有"03月02日"无年份，年份需页头学年/最近年份推算）
// 3. 课程数据脏：编号/课名/括号挤一行（如 "B1001 高等数学（4）"），全角括号混用、教师可能缺失、地点可为 NoRoom
// 4. 课表视图分裂：全部周次视图表头无日期，仅按周(weekNo=N)视图表头带日期
// 5. 学生年级/学历等字段经接口加密下发、无干净字段（故无法按学号可靠推算"大几"，只显示真实学年学期）
// 6. 功能集中在单 Action（CourseAction?setAction=...）按字符串分发，无 REST


// ==================== 常量 ====================

// 课表页面地址（selectTableType: ThisTerm=本学期, NextTerm=下学期）
const COURSE_TABLE_URL = "https://jw.guc.edu.cn/yethan/CourseAction?setAction=userCourseScheduleTable&viewType=studentCourseTableWeek&selectTableType=";

// 课表表单提交地址（"按周次查课表"用 POST 提交，weekNo=1 请求用于解析开学日期，复刻页面表单）
const COURSE_ACTION_URL = "https://jw.guc.edu.cn/yethan/CourseAction";

// 默认导入学期（用户在选择学期弹窗中取消时回退到本学期）
const SELECT_TABLE_TYPE = "ThisTerm";

// 拉取课表请求超时时间（毫秒）
const FETCH_TIMEOUT_MS = 15000;

// 吉利学院作息时间（第1节~第11节）
const TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:10", endTime: "09:55" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:00", endTime: "11:45" },
    { number: 5, startTime: "11:50", endTime: "12:35" },
    { number: 6, startTime: "14:20", endTime: "15:05" },
    { number: 7, startTime: "15:10", endTime: "15:55" },
    { number: 8, startTime: "16:10", endTime: "16:55" },
    { number: 9, startTime: "17:00", endTime: "17:45" },
    { number: 10, startTime: "19:00", endTime: "19:45" },
    { number: 11, startTime: "19:50", endTime: "20:35" }
];

// ==================== 工具函数 ====================

/**
 * 将周次字符串展开为数字数组。
 * 支持 "19周" -> [19]，"1-5,7-9,11-16周" -> [1,2,3,4,5,7,8,9,11,12,13,14,15,16]
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    // 去掉"周"及可能存在的(单)/(双)等标记（兼容全角/半角括号）
    const pureWeekData = weekStr.replace(/周/g, "").replace(/[（(].*$/, "");
    pureWeekData.split(",").forEach(seg => {
        seg = seg.trim();
        if (!seg) return;
        if (seg.includes("-")) {
            const [s, e] = seg.split("-").map(Number);
            if (!isNaN(s) && !isNaN(e) && s >= 1 && e >= s) {
                for (let i = s; i <= e; i++) weeks.push(i);
            }
        } else {
            const w = parseInt(seg, 10);
            if (!isNaN(w) && w >= 1) weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析一行课程文本，如 "B3001 体育与健康（4）（张睿）"（课名带版本号括号，教师为最后一个全角括号）。
 * 返回 { name, teacher }，无法解析时返回 null。
 * 兼容情况：
 *   - 未选课前课程可能无教师（如 "B1001 高等数学"），此时 teacher 为空串，课程保留；
 *   - 课名带版本号括号（如 "体育与健康（4）"）时，纯数字括号视为课名一部分，不会误认成教师。
 */
function parseCourseLine(line) {
    const text = line.trim();
    if (!text) return null;
    // 教师为最后一个全角括号内的内容；纯数字括号（如 （4））视为课名版本号而非教师
    const teacherMatch = text.match(/（([^（）]+)）$/);
    let teacher = "";
    let name = text;
    if (teacherMatch) {
        const candidate = teacherMatch[1].trim();
        if (!/^\d+$/.test(candidate)) {
            teacher = candidate;
            name = text.substring(0, text.length - teacherMatch[0].length).trim();
        }
    }
    // 去除课程编号前缀（如 B2344），仅当首词形如"字母+数字"时去除
    const tokens = name.split(/\s+/);
    if (tokens.length > 1 && /^[A-Za-z]*\d+$/.test(tokens[0])) {
        tokens.shift();
    }
    name = tokens.join(" ").trim();
    if (!name) return null;
    return { name, teacher };
}

/**
 * 节次与周次合并去重函数（官方参考实现，来自拾光课程表 wiki《课程合并与去重函数》）
 * - 节次合并：名称、教师、地点、星期、周次完全相同的连续节次（1-2 + 3-4 -> 1-4）
 * - 完全去重：删除完全重复的记录
 * - 周次合并：同节次的单双周/分段周次合并（[15] + [16] -> [15,16]）
 * - 周次排序去重：weeks 自动升序并去重
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

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
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
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
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
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/**
 * 解析课表 HTML，返回表格的所有行（<tr> 数组）。找不到表格返回空数组。
 * 供解析课程/作息/开学日期复用，统一课表表格入口。
 */
function getTableRows(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table.table_border");
    return table ? Array.from(table.querySelectorAll("tr")) : [];
}

/**
 * 解析课表 HTML 表格为课程模型数组。
 */
function parseTimetableToCourses(html) {
    const rows = getTableRows(html);
    if (rows.length === 0) return [];

    const results = [];

    for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 9) continue;

        const section = parseInt(cells[0].textContent.trim(), 10);
        if (isNaN(section) || section < 1) continue;

        // cells[0]=节次, cells[1]=上课时间, cells[2..8]=星期一~星期日
        for (let col = 2; col <= 8; col++) {
            const day = col - 1; // 1=周一, 7=周日

            // 将单元格中的 <br> 转为换行，保留纯文本
            const clone = cells[col].cloneNode(true);
            clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
            const raw = (clone.textContent || "").replace(/\u00A0/g, " ");
            const segments = raw.split("\n").map(s => s.trim()).filter(s => s.length > 0);

            // 课程块形如 [课程行, 周次地点行] 成对出现。
            // 逐段消费：仅当"本段是课程行且下一段形如 '…周 …' 的周次地点行"才配对，
            // 避免教务改版导致段落错位时漏课或串位
            for (let j = 0; j < segments.length; j++) {
                const courseInfo = parseCourseLine(segments[j]);
                if (!courseInfo) continue;
                if (j + 1 >= segments.length) continue;

                // 周次地点行，形如 "1-5,7-9,11-16周 L255极简型智慧教室"
                const timePlace = segments[j + 1];
                const match = timePlace.match(/^(.+?)周\s*(.*)$/);
                if (!match) continue;
                const weeks = parseWeeks(match[1]);
                const position = (match[2] || "").trim();
                if (weeks.length === 0) continue;

                results.push({
                    name: courseInfo.name,
                    teacher: courseInfo.teacher,
                    position: position,
                    day: day,
                    startSection: section,
                    endSection: section,
                    weeks: weeks
                });
                j++; // 已消费周次地点行
            }
        }
    }

    return mergeAndDistinctCourses(results);
}

/**
 * 从课表 HTML 动态提取作息时间（节次 + 上课时间列，如 "08:20-09:05"）。
 * 返回 [{ number, startTime, endTime }]；无有效节次时返回 null（由调用方回退写死常量）。
 * 表头行（节次为"节"字）与 rowspan 跨节的空节次行经 parseInt 后自然跳过。
 */
function parseTimeSlots(html) {
    try {
        const rows = getTableRows(html);
        if (rows.length === 0) return null;
        const slots = [];
        for (const row of rows) {
            const cells = Array.from(row.querySelectorAll("td"));
            if (cells.length < 2) continue;
            const number = parseInt(cells[0].textContent.trim(), 10);
            if (isNaN(number) || number < 1) continue;
            const timeText = (cells[1].textContent || "").trim();
            const m = timeText.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
            if (!m) continue;
            slots.push({ number: number, startTime: m[1], endTime: m[2] });
        }
        if (slots.length === 0) return null;
        slots.sort((a, b) => a.number - b.number);
        return slots;
    } catch (e) {
        console.error("解析作息时间失败:", e);
        return null;
    }
}

// ==================== 网络请求 ====================

/**
 * 带超时的 fetch 封装：统一 AbortController 超时与登录会话 Cookie(credentials: "include")。
 * 超时/网络异常由调用方 catch 处理。
 */
async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, Object.assign({ credentials: "include" }, options, { signal: controller.signal }));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 拉取本学期课表页面并检测登录状态（一次请求完成）。
 * 返回：
 *   - { loggedIn: true, html }  成功
 *   - { error: "not_logged_in" }   未登录（页面含验证码输入框/登录表单）
 *   - { error: "network" }         网络异常或超时
 *   - { error: "request_failed" }  HTTP 请求失败（非 2xx）
 *   - { error: "no_table" }        已登录但页面无课表
 */
async function fetchTimetableOnce(semesterType) {
    try {
        const resp = await fetchWithTimeout(COURSE_TABLE_URL + semesterType + "&queryType=student");
        if (!resp.ok) return { error: "request_failed" };
        const html = await resp.text();
        if (html.includes('id="ranstring"') || html.includes("LoginForm")) return { error: "not_logged_in" };
        if (!html.includes("table_border")) return { error: "no_table" };
        return { loggedIn: true, html };
    } catch (e) {
        console.error("获取课表失败:", e);
        return { error: "network" };
    }
}

/**
 * 请求第 1 周课表（POST，复刻页面"查周课表"表单，weekNo=1）。
 * 第 1 周视图的表头带日期（如 "星期一<br>03月02日"），用于解析开学日期。
 * 成功返回响应 HTML；任何失败返回 null（不阻断主流程，开学日期缺失时 App 端可手动设置）。
 */
async function fetchWeek1Timetable(semesterType) {
    try {
        const resp = await fetchWithTimeout(COURSE_ACTION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: new URLSearchParams({
                setAction: "userCourseScheduleTable",
                viewType: "studentCourseTableWeek",
                selectTableType: semesterType,
                queryType: "student",
                weekNo: "1"
            }).toString()
        });
        if (!resp.ok) return null;
        return await resp.text();
    } catch (e) {
        console.error("获取第1周课表失败:", e);
        return null;
    }
}

/**
 * 从第 1 周课表 HTML 解析开学日期（第一周第一天 = 表头"星期一"的日期）。
 * 返回 "yyyy-MM-dd"（官方 CourseConfigJsonModel 格式）；解析失败返回 null。
 *
 * 年份策略（两步）：
 *   1) 优先页头学年解析："2025-2026第2学期" → 第1学期取学年首年(秋季)、第2学期取学年次年(春季)；
 *   2) 兜底：取 "MM月DD日" 距今天最近的年份（候选: 去年/今年/明年）。
 *      依据：教务系统仅显示本学期，开学日必然距今天不足半年，最近年份即正确年份。
 */
function parseSemesterStartDate(html) {
    try {
        const rows = getTableRows(html);
        if (rows.length === 0) return null;
        const headerRow = rows[0];
        const cells = headerRow ? Array.from(headerRow.querySelectorAll("td")) : [];
        // 表头：[0]=节, [1]=上课时间, [2]=星期一 ...
        if (cells.length < 3) return null;
        const mondayText = cells[2].textContent || ""; // 如 "星期一03月02日"
        const m = mondayText.match(/(\d{1,2})月(\d{1,2})日/);
        if (!m) return null;
        const month = parseInt(m[1], 10);
        const day = parseInt(m[2], 10);
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;

        // 年份：优先页头学年解析
        let year = null;
        const termMatch = html.match(/(20\d{2})\s*[-—]\s*(20\d{2})第?(\d)学期/);
        if (termMatch) {
            const y1 = parseInt(termMatch[1], 10);
            const y2 = parseInt(termMatch[2], 10);
            const termNo = parseInt(termMatch[3], 10);
            if (y2 === y1 + 1 && (termNo === 1 || termNo === 2)) {
                year = termNo === 2 ? y2 : y1; // 第1学期=首年(秋季)，第2学期=次年(春季)
            }
        }

        // 兜底：距今天最近的年份
        if (!year) {
            const now = new Date();
            const thisYear = now.getFullYear();
            let best = thisYear;
            let bestDiff = Infinity;
            for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
                const d = new Date(y, month - 1, day);
                const diff = Math.abs(d - now);
                if (diff < bestDiff) { bestDiff = diff; best = y; }
            }
            year = best;
        }

        const pad = n => String(n).padStart(2, "0");
        return `${year}-${pad(month)}-${pad(day)}`;
    } catch (e) {
        console.error("解析开学日期失败:", e);
        return null;
    }
}

// ==================== 学期选择 ====================

/**
 * 从选课页 HTML 解析真实学期名（如 "2025-2026第2学期"）。
 * 页头 userInfo 形如 "学号 姓名 <span>2025-2026第2学期</span> 课表"。
 * 解析失败返回 null（由调用方回退使用通用名）。
 */
function parseSemesterLabel(html) {
    const m = html.match(/(\d{4}-\d{4}第\d学期)/);
    return m ? m[1] : null;
}

/**
 * 探测指定学期的真实学期名。请求选课页(userCourseSchedule)拿页头学期标识；
 * 任何失败返回 null（调用方回退用通用名"本学期/下学期"）。
 */
async function fetchSemesterLabel(type) {
    try {
        const resp = await fetchWithTimeout(COURSE_ACTION_URL + "?setAction=userCourseSchedule&selectTableType=" + type);
        if (!resp.ok) return null;
        return parseSemesterLabel(await resp.text());
    } catch (e) {
        console.error("探测学期名失败(", type, "):", e);
        return null;
    }
}

/**
 * 让用户选择导入学期。用 showSingleSelection 显示两个学期的真实学期名
 * （如 "2025-2026第2学期" / "2026-2027第1学期"，比"本学期/下学期"更明确）；
 * 探测不到真实名时回退显示通用名。取消返回默认本学期(ThisTerm)。
 */
async function selectSemester() {
    const kinds = [
        { value: "ThisTerm", label: "本学期" },
        { value: "NextTerm", label: "下学期" }
    ];
    const labels = await Promise.all(kinds.map(k => fetchSemesterLabel(k.value)));
    const names = kinds.map((k, i) => labels[i] || k.label);
    const idx = await window.shiguangBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(names), 0);
    if (idx == null || idx === undefined || idx === -1) return SELECT_TABLE_TYPE;
    return (kinds[idx] || kinds[0]).value;
}

/**
 * 构造课表配置：学期总周数（取课程最大周）+ 开学日期（可选）。
 * 开学日期：请求第 1 周课表，取表头"星期一"日期作为第一周第一天（"yyyy-MM-dd"，官方格式）；
 * 请求失败或解析失败时不设置该字段（App 端可手动设置），不影响课程导入。
 */
async function fetchCourseConfig(semesterType, courses) {
    const maxWeek = courses.reduce((max, c) => Math.max(max, Math.max(...c.weeks)), 0);
    const config = { semesterTotalWeeks: Math.max(maxWeek, 1) };
    const week1Html = await fetchWeek1Timetable(semesterType);
    if (week1Html) {
        const semesterStartDate = parseSemesterStartDate(week1Html);
        if (semesterStartDate) {
            config.semesterStartDate = semesterStartDate;
            console.log("开学日期:", semesterStartDate);
        }
    }
    return config;
}

// ==================== 主流程 ====================

async function runImportFlow() {
    const BRIDGE = window.shiguangBridge;
    const BRIDGE_P = window.shiguangBridgePromise;
    if (!BRIDGE || !BRIDGE_P) {
        console.error("桥接 API 不可用（缺少 window.shiguangBridge / window.shiguangBridgePromise）");
        return;
    }

    BRIDGE.showToast("正在初始化吉利学院课表导入...");

    // 1. 前置提示
    const confirmed = await BRIDGE_P.showAlert(
        "教务系统课表导入",
        "请确认已在当前页面成功登录教务系统（输入学号、密码及验证码）。\n登录成功后点击“好的，开始导入”。",
        "好的，开始导入"
    );
    if (!confirmed) {
        BRIDGE.showToast("已取消导入");
        return;
    }

    // 2. 选择导入学期（默认本学期），并拉取该学期课表、检测登录状态
    const semesterType = await selectSemester();
    BRIDGE.showToast("正在获取课表数据...");
    const result = await fetchTimetableOnce(semesterType);
    if (result.error === "not_logged_in") {
        await BRIDGE_P.showAlert(
            "未检测到登录状态",
            "当前会话未登录，请先在页面中完成登录，之后重新发起导入。",
            "知道了"
        );
        BRIDGE.showToast("未登录，导入中止");
        return;
    }
    if (result.error === "network" || result.error === "request_failed") {
        BRIDGE.showToast("获取课表失败（网络异常或超时），请检查网络后重试");
        return;
    }
    if (result.error === "no_table" || !result.html) {
        BRIDGE.showToast("未获取到课表数据，请确认登录状态后重试");
        return;
    }
    const html = result.html;

    // 3. 解析课程（所选学期）
    const courses = parseTimetableToCourses(html);
    if (courses.length === 0) {
        BRIDGE.showToast("未解析到课程数据，请确认所选学期是否有课程");
        return;
    }
    console.log("解析到课程记录数:", courses.length, courses);

    // 4. 保存课程
    try {
        await BRIDGE_P.saveImportedCourses(JSON.stringify(courses));
        BRIDGE.showToast(`成功保存 ${courses.length} 条课程记录`);
    } catch (e) {
        BRIDGE.showToast("课程保存失败: " + e.message);
        return;
    }

    // 5. 保存作息时间（优先从课表"上课时间"列动态提取，学校调作息后无需改代码；提取失败回退写死常量）
    try {
        const timeSlots = parseTimeSlots(html) || TIME_SLOTS;
        await BRIDGE_P.savePresetTimeSlots(JSON.stringify(timeSlots));
        BRIDGE.showToast("作息时间保存成功");
    } catch (e) {
        BRIDGE.showToast("作息时间保存失败: " + e.message);
    }

    // 6. 保存课表配置（学期总周数 + 开学日期）
    try {
        const config = await fetchCourseConfig(semesterType, courses);
        await BRIDGE_P.saveCourseConfig(JSON.stringify(config));
    } catch (e) {
        BRIDGE.showToast("课表配置保存失败: " + e.message);
    }

    BRIDGE.showToast(`课表导入完成，共 ${courses.length} 条记录`);
    BRIDGE.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
