// 郑州航空工业管理学院 (zua.edu.cn) 拾光课程表适配脚本
// 复用 HFNU 的树维 EAMS 解析流程，并针对 ZUA 的课程名和教室格式做适配。

const BASE_URL = "http://jwglxt.zua.edu.cn";
const MAX_SUPPORTED_WEEK = 60;

function powerSplit(paramsRaw) {
    const args = [];
    let current = "";
    let depth = 0;
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < paramsRaw.length; i++) {
        const char = paramsRaw[i];
        if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== "\\")) {
            if (!inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inQuote = false;
            }
        }
        if (!inQuote) {
            if (char === "(" || char === "[" || char === "{") depth++;
            if (char === ")" || char === "]" || char === "}") depth--;
        }
        if (char === "," && depth === 0 && !inQuote) {
            args.push(cleanArg(current));
            current = "";
        } else {
            current += char;
        }
    }
    args.push(cleanArg(current));
    return args;
}

function cleanArg(value) {
    const trimmed = value.trim();
    if (trimmed === "null") return null;
    return trimmed.replace(/^["']|["']$/g, "");
}

function cleanCourseName(name) {
    return String(name || "未知课程").replace(/\([^()]*\)\s*$/, "").trim();
}

function cleanPosition(position) {
    return String(position || "未知地点").replace(/\s+/g, " ").trim();
}

function parseWeeksBitmap(bitmap) {
    const weeks = [];
    const value = String(bitmap || "");
    // 树维 EAMS 位图的下标就是周次，下标 0 是占位符；拾光使用 1 基周次。
    for (let week = 1; week < value.length; week++) {
        if (value[week] === "1") weeks.push(week);
    }
    return weeks;
}

/**
 * 沿用 HFNU 的按周次矩阵合并算法：只有课程名、教师、地点和星期均相同
 * 且在同一周内节次连续时才合并。remark 不参与分组，重复实验项会由 Set 去重。
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    const groups = {};
    lessons.forEach(lesson => {
        const key = `${lesson.name}|${lesson.teacher}|${lesson.position}|${lesson.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: lesson.name,
                teacher: lesson.teacher,
                position: lesson.position,
                day: lesson.day,
                weeksMatrix: Array.from({ length: MAX_SUPPORTED_WEEK + 1 }, () => new Set())
            };
        }

        if (Array.isArray(lesson.weeks)) {
            lesson.weeks.forEach(week => {
                if (Number.isInteger(week) && week > 0 && week <= MAX_SUPPORTED_WEEK) {
                    for (let section = lesson.startSection; section <= lesson.endSection; section++) {
                        groups[key].weeksMatrix[week].add(section);
                    }
                }
            });
        }
    });

    const merged = [];
    for (const key in groups) {
        const group = groups[key];
        const blockMap = {};

        for (let week = 1; week < group.weeksMatrix.length; week++) {
            const sections = Array.from(group.weeksMatrix[week]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            let start = sections[0];
            let previous = sections[0];
            for (let i = 1; i < sections.length; i++) {
                const current = sections[i];
                if (current === previous + 1) {
                    previous = current;
                } else {
                    const blockKey = `${start}-${previous}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(week);
                    start = current;
                    previous = current;
                }
            }

            const blockKey = `${start}-${previous}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(week);
        }

        for (const blockKey in blockMap) {
            const [startSection, endSection] = blockKey.split("-").map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection,
                endSection,
                weeks: blockMap[blockKey]
            });
        }
    }

    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return a.position.localeCompare(b.position);
    });
    return merged;
}

function parseTeacherName(block) {
    const teachersMatch = block.match(/actTeachers\s*=\s*\[([\s\S]*?)\]\s*;/);
    if (!teachersMatch) return "未知教师";

    const names = [];
    const nameRegex = /\bname\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = nameRegex.exec(teachersMatch[1])) !== null) {
        if (!names.includes(match[1])) names.push(match[1]);
    }
    return names.length > 0 ? names.join(",") : "未知教师";
}

function parseTaskActivities(html) {
    const rawResults = [];
    const unitCountMatch = html.match(/\bunitCount\s*=\s*(\d+)\s*;/);
    const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 14;
    const indexRegex = new RegExp(
        `index\\s*=\\s*(\\d+)\\s*\\*\\s*(?:unitCount|${unitCount})\\s*\\+\\s*(\\d+)\\s*;`,
        "g"
    );
    const blocks = html.split(/var\s+teachers\s*=/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const activityMatch = block.match(/new\s+TaskActivity\(([\s\S]*?)\)\s*;/);
        if (!activityMatch) continue;

        const args = powerSplit(activityMatch[1]);
        if (args.length < 7) continue;

        const name = cleanCourseName(args[3]);
        const teacher = parseTeacherName(block);
        const position = cleanPosition(args[5]);
        const weeks = parseWeeksBitmap(args[6]);
        if (weeks.length === 0) continue;

        indexRegex.lastIndex = 0;
        let indexMatch;
        while ((indexMatch = indexRegex.exec(block)) !== null) {
            const day = parseInt(indexMatch[1], 10) + 1;
            const section = parseInt(indexMatch[2], 10) + 1;
            rawResults.push({
                name,
                teacher,
                position,
                day,
                startSection: section,
                endSection: section,
                weeks: [...weeks]
            });
        }
    }

    return mergeContinuousLessons(rawResults);
}

function parseParameters(html) {
    const idsMatch = html.match(/bg\.form\.addInput\(\s*form\s*,\s*["']ids["']\s*,\s*["'](\d+)["']\s*\)/);
    const tagIdMatch = html.match(/id=["'](semesterBar\d+Semester)["']/);
    if (!idsMatch || !tagIdMatch) return null;

    const tagId = tagIdMatch[1];
    const escapedTagId = tagId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const elementMatch = html.match(new RegExp(`<[^>]*\\bid=["']${escapedTagId}["'][^>]*>`, "i"));
    const valueMatch = elementMatch ? elementMatch[0].match(/\bvalue=["'](\d+)["']/i) : null;

    return {
        ids: idsMatch[1],
        tagId,
        currentSemesterId: valueMatch ? valueMatch[1] : null
    };
}

function parseSemesterResponse(raw) {
    const data = Function(`return (${raw});`)();
    const semesters = [];

    for (const key of Object.keys(data.semesters || {})) {
        const entries = Array.isArray(data.semesters[key]) ? data.semesters[key] : [];
        entries.forEach(semester => {
            if (semester && semester.id !== undefined) {
                const term = String(semester.name || "").trim();
                const label = /^第.*学期$/.test(term) ? term : `第${term}学期`;
                semesters.push({
                    id: String(semester.id),
                    schoolYear: String(semester.schoolYear || ""),
                    term,
                    name: `${semester.schoolYear} ${label}`.trim()
                });
            }
        });
    }

    semesters.sort((a, b) => {
        const yearCompare = b.schoolYear.localeCompare(a.schoolYear);
        if (yearCompare !== 0) return yearCompare;
        return b.term.localeCompare(a.term, undefined, { numeric: true });
    });

    return {
        semesters,
        currentSemesterId: data.semesterId === undefined ? null : String(data.semesterId)
    };
}

async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "include", ...options });
    if (!response.ok) throw new Error(`网络请求失败: ${response.status}`);
    return await response.text();
}

async function detectParameters() {
    const html = await request(`${BASE_URL}/eams/courseTableForStd.action`);
    return parseParameters(html);
}

async function getSelectedSemester(tagId, currentSemesterId) {
    const form = new URLSearchParams();
    form.set("tagId", tagId);
    form.set("dataType", "semesterCalendar");
    if (currentSemesterId) form.set("value", currentSemesterId);
    form.set("empty", "false");

    const raw = await request(`${BASE_URL}/eams/dataQuery.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: form.toString()
    });
    const parsed = parseSemesterResponse(raw);
    if (parsed.semesters.length === 0) throw new Error("未获取到可选学期");

    const selectedId = currentSemesterId || parsed.currentSemesterId;
    const defaultIndex = parsed.semesters.findIndex(semester => semester.id === selectedId);
    const index = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(parsed.semesters.map(semester => semester.name)),
        defaultIndex
    );
    return Number.isInteger(index) && index >= 0 && index < parsed.semesters.length
        ? parsed.semesters[index]
        : null;
}

async function fetchAndParseCourses(semesterId, ids) {
    const form = new URLSearchParams();
    form.set("ignoreHead", "1");
    form.set("setting.kind", "std");
    form.set("startWeek", "");
    form.set("semester.id", String(semesterId));
    form.set("ids", String(ids));

    const html = await request(`${BASE_URL}/eams/courseTableForStd!courseTable.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: form.toString()
    });
    return parseTaskActivities(html);
}

async function runImportFlow() {
    try {
        AndroidBridge.showToast("开始探测郑航教务参数...");
        const params = await detectParameters();
        if (!params) throw new Error("未能识别教务参数，请确认已登录郑航教务系统");

        const semester = await getSelectedSemester(params.tagId, params.currentSemesterId);
        if (!semester) return;

        AndroidBridge.showToast("正在同步课表...");
        const courses = await fetchAndParseCourses(semester.id, params.ids);
        if (!courses || courses.length === 0) throw new Error("未解析到课程数据");

        const saveResult = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saveResult) {
            AndroidBridge.showToast(`成功导入 ${courses.length} 个课程条目，请按学校当前安排核对作息时间`);
            AndroidBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error(`[ZUA 课表导入异常] ${error.message}`);
        AndroidBridge.showToast(error.message);
    }
}

runImportFlow();
