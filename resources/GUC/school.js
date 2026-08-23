// 吉利学院(GUC) 拾光课程表适配脚本
// YETHAN以专教学信息服务平台
// 该教务系统带图片验证码，需用户在页面内手动登录，脚本基于已登录会话(Cookie)拉取课表
// 非该大学学生适配可能无法登录,出现问题请通过issues提交反馈
// 桥接 API 使用 v2：window.shiguangBridge(同步) / window.shiguangBridgePromise(异步)

// ==================== 常量 ====================

// 课表页面地址（selectTableType: ThisTerm=本学期, NextTerm=下学期）
const COURSE_TABLE_URL = "https://jw.guc.edu.cn/yethan/CourseAction?setAction=userCourseScheduleTable&viewType=studentCourseTableWeek&selectTableType=";

// 默认导入本学期；如需导入下学期请改为 "NextTerm"
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
 * 解析一行课程文本，如 "B4708 大学英语（4）（李博）"。
 * 返回 { name, teacher }，无法解析时返回 null。
 */
function parseCourseLine(line) {
    const text = line.trim();
    if (!text) return null;
    // 教师为最后一个全角括号内的内容（课程名本身也可能含括号，如 大学英语（4））
    const teacherMatch = text.match(/（([^（）]+)）$/);
    if (!teacherMatch) return null;
    const teacher = teacherMatch[1].trim();
    let name = text.substring(0, text.length - teacherMatch[0].length).trim();
    // 去除课程编号前缀（如 B2344），仅当首词形如"字母+数字"时去除
    const tokens = name.split(/\s+/);
    if (tokens.length > 1 && /^[A-Za-z]*\d+$/.test(tokens[0])) {
        tokens.shift();
    }
    name = tokens.join(" ").trim();
    if (!name || !teacher) return null;
    return { name, teacher };
}

/**
 * 合并同一天、课程信息与周次完全相同、且节次相邻的记录。
 * 教务系统把同一门课的多个相邻节次在表格中重复列出，合并后更接近真实课表。
 */
function mergeConsecutiveSections(courses) {
    if (courses.length <= 1) return courses;

    const groups = new Map();
    for (const c of courses) {
        const key = `${c.day}|${c.name}|${c.teacher}|${c.position}|${c.weeks.join(",")}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }

    const merged = [];
    for (const list of groups.values()) {
        list.sort((a, b) => a.startSection - b.startSection);
        let current = { ...list[0] };
        for (let i = 1; i < list.length; i++) {
            const next = list[i];
            if (next.startSection === current.endSection + 1) {
                current.endSection = next.endSection;
            } else {
                merged.push(current);
                current = { ...next };
            }
        }
        merged.push(current);
    }
    return merged;
}

/**
 * 解析课表 HTML 表格为课程模型数组。
 */
function parseTimetableToCourses(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table.table_border");
    if (!table) return [];

    const results = [];
    const rows = Array.from(table.querySelectorAll("tr"));

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

    return mergeConsecutiveSections(results);
}

// ==================== 网络请求 ====================

/**
 * 拉取本学期课表页面并检测登录状态（一次请求完成）。
 * 返回 { loggedIn, html }：
 *   - loggedIn=false：未登录（页面含验证码输入框/登录表单）
 *   - html 为 null：请求失败、超时或页面无课表
 */
async function fetchTimetableOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(COURSE_TABLE_URL + SELECT_TABLE_TYPE + "&queryType=student", {
            credentials: "include",
            signal: controller.signal
        });
        if (!resp.ok) return { loggedIn: false, html: null };
        const html = await resp.text();
        const loggedIn = !(html.includes('id="ranstring"') || html.includes("LoginForm"));
        if (!loggedIn || !html.includes("table_border")) return { loggedIn, html: null };
        return { loggedIn: true, html };
    } catch (e) {
        console.error("获取课表失败:", e);
        return { loggedIn: false, html: null };
    } finally {
        clearTimeout(timer);
    }
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

    // 2. 拉取本学期课表并检测登录状态
    BRIDGE.showToast("正在获取课表数据...");
    const { loggedIn, html } = await fetchTimetableOnce();
    if (!loggedIn) {
        await BRIDGE_P.showAlert(
            "未检测到登录状态",
            "当前会话未登录，请先在页面中完成登录，之后重新发起导入。",
            "知道了"
        );
        BRIDGE.showToast("未登录，导入中止");
        return;
    }
    if (!html) {
        BRIDGE.showToast("获取课表失败，请确认登录状态后重试");
        return;
    }

    // 3. 解析课程（默认本学期）
    const courses = parseTimetableToCourses(html);
    if (courses.length === 0) {
        BRIDGE.showToast("未解析到课程数据，请确认本学期是否有课程");
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

    // 5. 保存作息时间
    try {
        await BRIDGE_P.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        BRIDGE.showToast("作息时间保存成功");
    } catch (e) {
        BRIDGE.showToast("作息时间保存失败: " + e.message);
    }

    // 6. 保存课表配置（按课程数据中的最大周数设置学期总周数）
    try {
        const maxWeek = courses.reduce((max, c) => Math.max(max, Math.max(...c.weeks)), 0);
        const config = { semesterTotalWeeks: Math.max(maxWeek, 1) };
        await BRIDGE_P.saveCourseConfig(JSON.stringify(config));
    } catch (e) {
        BRIDGE.showToast("课表配置保存失败: " + e.message);
    }

    BRIDGE.showToast(`课表导入完成，共 ${courses.length} 条记录`);
    BRIDGE.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
