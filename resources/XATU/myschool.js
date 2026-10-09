// 西安工业大学(http://jwgl2018.xatu.edu.cn) 拾光课程表适配脚本，基于天津农学院适配脚本
// 本校开发者适配，出现问题请提issues或者提交pr更改,这更加快速
//感谢XingHeYuZhuan、aryunm、jursin...等的帮助，感谢trae的辅助

function powerSplit(paramsRaw) {
    const args = [];
    let current = "";
    let depth = 0; 
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < paramsRaw.length; i++) {
        let char = paramsRaw[i];
        if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== '\\')) {
            if (!inQuote) { inQuote = true; quoteChar = char; }
            else if (char === quoteChar) { inQuote = false; }
        }
        if (!inQuote) {
            if (char === '(' || char === '[' || char === '{') depth++;
            if (char === ')' || char === ']' || char === '}') depth--;
        }
        if (char === ',' && depth === 0 && !inQuote) {
            args.push(cleanArg(current));
            current = "";
        } else {
            current += char;
        }
    }
    args.push(cleanArg(current)); 
    return args;
}

function cleanArg(s) {
    s = s.trim();
    if (s === "null") return null;
    return s.replace(/^["']|["']$/g, "");
}

/**
 * 全局课程合并逻辑
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    // 1. 建立基于 (课程名|教师|地点|星期几) 的分组
    const groups = {};
    lessons.forEach(l => {
        const key = `${l.courseSequence || ""}|${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                isTeachingBuilding3: l.isTeachingBuilding3,
                credit: l.credit,
                // 假设大学最多 50 周，构建一个：第 N 周对应哪些节次的矩阵
                weeksMatrix: Array.from({ length: 50 }, () => new Set())
            };
        }
        // 将系统传来的凌乱数据彻底打散，按“周”填入对应的“节”中，Set自动去重
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                if (w >= 0 && w < 50) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[w].add(s);
                    }
                }
            });
        }
    });

    const merged = [];

    // 2. 根据矩阵重新组装绝对精确的课程块
    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;
        
        // 用于记录相同的“连续节次块”分布在哪些周次
        // 例如 blockMap["1-2"] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
        // 例如 blockMap["2-2"] = [10]
        const blockMap = {};

        for (let w = 0; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            // 寻找当前周的连续节次块
            let start = sections[0];
            let prev = sections[0];

            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr; // 节次连续，继续延伸
                } else {
                    // 节次断开，结算上一个块
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);
                    
                    // 开启新块
                    start = curr;
                    prev = curr;
                }
            }
            // 结算每周最后一个块
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }

        // 3. 将聚合好的 blockMap 转换为最终的 JSON 对象
        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey],
                isTeachingBuilding3: group.isTeachingBuilding3,
                ...(group.credit !== undefined ? { credit: group.credit } : {})
            });
        }
    }

    // 4. 排序以便输出整洁美观
    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

function isTeachingBuilding3(position) {
    return /教3/.test(position);
}

/** 从同一课表响应的课程列表中读取学分，按课程序号匹配，避免同名课程混淆。 */
function parseCourseCredits(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const credits = new Map();
    for (const table of doc.querySelectorAll("table")) {
        const header = Array.from(table.rows).find(row =>
            Array.from(row.cells).some(cell => cell.tagName === "TH" && cell.textContent.trim() === "学分"));
        if (!header) continue;
        const headers = Array.from(header.cells).map(cell => cell.textContent.trim());
        const creditIndex = headers.indexOf("学分");
        const sequenceIndex = headers.indexOf("课程序号");
        if (sequenceIndex < 0) continue;
        for (const row of table.rows) {
            if (row === header || row.closest("table") !== table) continue;
            const sequence = row.cells[sequenceIndex]?.textContent.trim();
            const text = row.cells[creditIndex]?.textContent.trim();
            if (!sequence || !text || !/^\d+(?:\.\d+)?$/.test(text)) continue;
            const credit = Number(text);
            if (!Number.isFinite(credit)) continue;
            // 同一序号出现矛盾值时不猜测；合法的 0 学分需要保留。
            if (credits.has(sequence) && credits.get(sequence) !== credit) credits.set(sequence, undefined);
            else if (!credits.has(sequence)) credits.set(sequence, credit);
        }
    }
    return credits;
}

function parseTaskActivities(html) {
    const credits = parseCourseCredits(html);
    const rawResults = [];
    const blocks = html.split(/var\s+teachers\s*=/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        let teacherName = "未知教师";
        const tMatch = block.match(/actTeachers\s*=\s*\[\s*\{[\s\S]*?name:\s*"(.*?)"/);
        if (tMatch) teacherName = tMatch[1];

        const activityMatch = block.match(/new\s+TaskActivity\(([\s\S]*?)\);/);
        if (!activityMatch) continue;

        const args = powerSplit(activityMatch[1]);
        const courseSequence = (args[2] || "").match(/\(([^()]*)\)$/)?.[1] || "";
        const credit = credits.get(courseSequence);
        const courseName = (args[3] || "未知课程").split('(')[0];
        const position = (args[5] || "未知地点").replace(/\(.*?\)/g, "");
        const weeksBitmap = args[6] || "";
        
        const weeks = [];
        for (let j = 0; j < weeksBitmap.length; j++) {
            if (weeksBitmap[j] === '1') weeks.push(j);
        }

        const unitCountMatch = html.match(/unitCount\s*=\s*(\d+)/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1]) : 14;

        const idxRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+);/g;
        let m;
        while ((m = idxRegex.exec(block)) !== null) {
            const day = parseInt(m[1]) + 1; 
            const section = parseInt(m[2]) + 1;

            rawResults.push({
                "name": courseName,
                "courseSequence": courseSequence,
                ...(credit !== undefined ? { credit } : {}),
                "teacher": teacherName,
                "position": position,
                "day": day,
                "startSection": section,
                "endSection": section,
                "weeks": weeks,
                "isTeachingBuilding3": isTeachingBuilding3(position)
            });
        }
    }

    // 执行全局合并逻辑
    return mergeContinuousLessons(rawResults);
}

async function requestResponse(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    if (!res.ok) throw new Error(`网络请求失败: ${res.status}`);
    return res;
}

async function request(url, options = {}) {
    return await (await requestResponse(url, options)).text();
}

/** 根据教务首页的当前教学周，推算第一教学周的周一（北京时间）。 */
function inferCurrentSemester(html, referenceTime) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const label = Array.from(doc.querySelectorAll("strong"))
        .find(el => el.textContent.trim() === "当前教学周");
    const weekText = label?.parentElement?.querySelector("span")?.textContent.trim();
    const totalMatch = label?.parentElement?.querySelector("i")?.textContent.match(/\/\s*(\d+)/);
    if (!weekText || !/^\d+$/.test(weekText) || !totalMatch) return null;

    const week = Number(weekText);
    const totalWeeks = Number(totalMatch[1]);
    if (week < 1 || week > totalWeeks || totalWeeks > 53 || !Number.isFinite(referenceTime)) return null;

    // 用 UTC 方法处理已平移到北京时间的日期，避免设备时区和夏令时影响。
    const start = new Date(referenceTime + 8 * 60 * 60 * 1000);
    start.setUTCHours(0, 0, 0, 0);
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday - (week - 1) * 7);

    // 学期选择器没有起止日期；按推算出的起始月份识别本校的秋季/春季学期。
    const isAutumn = start.getUTCMonth() >= 6;
    const schoolYearStart = start.getUTCFullYear() - (isAutumn ? 0 : 1);
    return {
        schoolYear: `${schoolYearStart}-${schoolYearStart + 1}`,
        term: isAutumn ? "1" : "2",
        semesterStartDate: start.toISOString().slice(0, 10),
        semesterTotalWeeks: totalWeeks
    };
}

async function getCurrentSemesterConfig(semester) {
    try {
        const res = await requestResponse("http://jwgl2018.xatu.edu.cn/eams/homeExt!main.action?sf_request_type=ajax");
        const serverTime = Date.parse(res.headers.get("Date") || "");
        const current = inferCurrentSemester(await res.text(), Number.isFinite(serverTime) ? serverTime : Date.now());
        if (!current) throw new Error("未能识别当前教学周");
        if (semester.schoolYear !== current.schoolYear || semester.term !== current.term) {
            window.shiguangBridge.showToast("历史或其他学期开学日期请手动设置");
            return null;
        }
        return {
            semesterStartDate: current.semesterStartDate,
            semesterTotalWeeks: current.semesterTotalWeeks
        };
    } catch (e) {
        console.warn(`[开学日期推算] ${e.message}`);
        window.shiguangBridge.showToast("无法推算开学日期，请在导入后手动设置");
        return null;
    }
}

async function detectParameters() {
    const html = await request("http://jwgl2018.xatu.edu.cn/eams/courseTableForStd.action?sf_request_type=ajax");
    const idsMatch = html.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
    const tagIdMatch = html.match(/id="(semesterBar\d+Semester)"/);
    if (!idsMatch || !tagIdMatch) return null;
    return { ids: idsMatch[1], tagId: tagIdMatch[1] };
}

async function getSelectedSemester(tagId) {
    const raw = await request(`http://jwgl2018.xatu.edu.cn/eams/dataQuery.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar`
    });
    const data = Function(`return (${raw});`)();
    const list = [];
    for (let key in data.semesters) {
        data.semesters[key].forEach(s => list.push({
            id: s.id,
            schoolYear: s.schoolYear,
            term: String(s.name),
            name: `${s.schoolYear} ${s.name}学期`
        }));
    }
    const idx = await window.shiguangBridgePromise.showSingleSelection("选择学期", JSON.stringify(list.map(s => s.name)), -1);
    return idx !== null ? list[idx] : null;
}

async function fetchAndParseCourses(semesterId, ids) {
    const html = await request(`http://jwgl2018.xatu.edu.cn/eams/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `ignoreHead=1&setting.kind=std&semester.id=${semesterId}&ids=${ids}`
    });
    return parseTaskActivities(html);
}

/** 将已排定考试转换成单次自定义时间课程；未排定、无效或超出学期的记录不导入。 */
function parseExamCourses(html, config) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const startTime = Date.parse(`${config.semesterStartDate}T00:00:00Z`);
    const exams = [];
    const seen = new Set();
    let foundTable = false;
    for (const table of doc.querySelectorAll("table")) {
        const header = Array.from(table.rows).find(row =>
            Array.from(row.cells).some(cell => cell.tagName === "TH" && cell.textContent.trim() === "考试日期"));
        if (!header) continue;
        const headers = Array.from(header.cells).map(cell => cell.textContent.trim());
        const get = (row, name) => row.cells[headers.indexOf(name)]?.textContent.trim() || "";
        if (!["课程名称", "课程序号", "考试安排", "考试地点"].every(name => headers.includes(name))) continue;
        foundTable = true;
        for (const row of table.rows) {
            if (row === header || row.closest("table") !== table) continue;
            const dateText = get(row, "考试日期");
            const timeMatch = get(row, "考试安排").match(/^(\d{1,2}:\d{2})\s*[~～－-]\s*(\d{1,2}:\d{2})$/);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !timeMatch) continue;
            const date = new Date(`${dateText}T00:00:00Z`);
            if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) continue;
            const times = timeMatch.slice(1).map(time => time.padStart(5, "0"));
            if (!times.every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) || times[0] >= times[1]) continue;
            const week = Math.floor((date.getTime() - startTime) / (7 * 86400000)) + 1;
            const name = get(row, "课程名称");
            if (!name || !Number.isInteger(week) || week < 1 || week > config.semesterTotalWeeks) continue;
            const seat = get(row, "考场座位号");
            const room = get(row, "考试地点");
            const position = `${room === "无" ? "" : room}${seat ? `（座位 ${seat}）` : ""}`;
            const key = JSON.stringify([get(row, "课程序号"), dateText, times, position]);
            if (seen.has(key)) continue;
            seen.add(key);
            exams.push({
                name: `【考试】${name}`,
                teacher: "",
                position,
                day: date.getUTCDay() || 7,
                weeks: [week],
                isCustomTime: true,
                customStartTime: times[0],
                customEndTime: times[1]
            });
        }
    }
    if (!foundTable) throw new Error("未识别到考试安排表");
    return exams;
}

async function getOptionalExamCourses(semester, config) {
    // 历史学期没有可靠的开学日期，无法将考试日期换算成对应教学周。
    if (!config) return [];
    const choice = await window.shiguangBridgePromise.showSingleSelection(
        "是否同时导入考试安排", JSON.stringify(["仅导入课程", "同时导入已排定考试（单次课程）"]), 0);
    if (choice !== 1) return [];
    try {
        const html = await request(`http://jwgl2018.xatu.edu.cn/eams/stdExamTable!examTable.action?semester.id=${encodeURIComponent(semester.id)}&examBatch.id=0`);
        const exams = parseExamCourses(html, config);
        window.shiguangBridge.showToast(exams.length ? `已读取 ${exams.length} 场考试` : "当前学期暂无可导入的已排定考试");
        return exams;
    } catch (e) {
        console.warn(`[考试导入] ${e.message}`);
        window.shiguangBridge.showToast("考试安排读取失败，仅导入课程");
        return [];
    }
}

async function applyTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:20", "endTime": "09:05" }, 
        { "number": 2, "startTime": "09:15", "endTime": "10:00" },
        { "number": 3, "startTime": "10:20", "endTime": "11:05" },
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" }, 
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "18:10", "endTime": "18:55" }, 
        { "number": 10, "startTime": "19:05", "endTime": "19:50" },
        { "number": 11, "startTime": "20:00", "endTime": "20:45" },
        { "number": 12, "startTime": "20:55", "endTime": "21:40" },
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}


function adjustTeachingBuilding3Courses(courses) {
    return courses.map(course => {
        // 检查是否是教3楼且正好是第3-4节两节课
        if (course.isTeachingBuilding3 && 
            course.startSection === 3 && 
            course.endSection === 4) {
            // 设置为自定义时间模式
            course.isCustomTime = true;
            course.customStartTime = "10:10";
            course.customEndTime = "11:40";
        }
        return course;
    });
}

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始探测教务参数...");
        const params = await detectParameters();
        if (!params) throw new Error("未能识别教务参数，请确认已登录");

        const semester = await getSelectedSemester(params.tagId);
        if (!semester) return; 

        window.shiguangBridge.showToast("正在同步课表...");
        let courses = await fetchAndParseCourses(semester.id, params.ids);
        
        if (!courses || courses.length === 0) throw new Error("未解析到课程数据");

        // 调整教3楼课程时间
        courses = adjustTeachingBuilding3Courses(courses);

        const config = await getCurrentSemesterConfig(semester);
        const exams = await getOptionalExamCourses(semester, config);
        courses = courses.concat(exams);
        await applyTimeSlots();
        if (config) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            window.shiguangBridge.showToast(`已推算第一教学周周一为 ${config.semesterStartDate}`);
        }
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        if (saveResult) {
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程条目`);
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        console.error(`[异常] ${e.message}`);
        window.shiguangBridge.showToast(e.message);
    }
}

runImportFlow();
