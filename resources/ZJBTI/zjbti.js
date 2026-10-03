/**
 * 浙江工商职业技术学院 - 青果教务系统适配脚本
 * 支持首页 #lessonSchedule-content 全量抓取与通用表格降级抓取
 */

// 12 节课标准作息时间表
const TimeSlots = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:10", endTime: "11:55" },
    { number: 5, startTime: "13:10", endTime: "13:55" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "15:00", endTime: "15:45" },
    { number: 8, startTime: "15:50", endTime: "16:35" },
    { number: 9, startTime: "16:40", endTime: "17:25" },
    { number: 10, startTime: "18:20", endTime: "19:05" },
    { number: 11, startTime: "19:10", endTime: "19:55" },
    { number: 12, startTime: "20:00", endTime: "20:45" }
];

const DAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

/**
 * 解析周次范围，处理单双周
 */
function parseWeeks(weekStr, isSingle, isDouble) {
    const clean = String(weekStr).replace(/周/g, "").trim();
    const parts = clean.split(/[,，]/);
    const weeks = [];

    parts.forEach(part => {
        if (part.includes("-")) {
            const [start, end] = part.split("-").map(Number);
            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        } else {
            const w = Number(part);
            if (!isNaN(w) && w > 0) {
                if (isSingle && w % 2 === 0) return;
                if (isDouble && w % 2 !== 0) return;
                weeks.push(w);
            }
        }
    });

    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

/**
 * 递归在 window 及 frames 中寻找包含课表内容的 Document
 */
function findScheduleDocument(win) {
    try {
        if (win.document && (win.document.querySelector("#lessonSchedule-content") || win.document.querySelector(".weeklesson"))) {
            return win.document;
        }
    } catch (e) {}

    for (let i = 0; i < win.frames.length; i++) {
        try {
            const doc = findScheduleDocument(win.frames[i]);
            if (doc) return doc;
        } catch (e) {}
    }
    return null;
}

/**
 * 从首页 #lessonSchedule-content 解析全量课程
 */
function parseFromLessonScheduleContent(doc) {
    const uls = Array.from(doc.querySelectorAll("#lessonSchedule-content .weeklesson ul, .weeklesson ul"));
    if (uls.length === 0) return null;

    const courses = [];
    const seen = new Set();

    uls.forEach(ul => {
        const lis = Array.from(ul.querySelectorAll("li"));
        let cur = {};

        function commitCourse() {
            if (!cur.name || !cur.timeStr) return;
            const cleanTime = cur.timeStr.replace(/&nbsp;/g, " ").trim();
            // 匹配格式例如：[6-9,11-19周] 四[1-2节] 或 [14-18周](双) 二[5-8节]
            const m = cleanTime.match(/\[(.*?)\](?:\((单|双)\))?\s*([一二三四五六日天])\s*\[(\d+)(?:\s*-\s*(\d+))?节\]/);
            if (!m) return;

            const weeks = parseWeeks(m[1], m[2] === "单", m[2] === "双");
            const day = DAY_MAP[m[3]];
            const startSec = parseInt(m[4]);
            const endSec = m[5] ? parseInt(m[5]) : startSec;

            if (!day || isNaN(startSec) || weeks.length === 0) return;

            const key = `${cur.name}|${cur.teacher || ""}|${cur.position || ""}|${day}|${startSec}-${endSec}|${weeks.join(",")}`;
            if (!seen.has(key)) {
                seen.add(key);
                courses.push({
                    name: cur.name,
                    teacher: cur.teacher || "",
                    position: cur.position || "",
                    day: day,
                    startSection: startSec,
                    endSection: endSec,
                    weeks: weeks
                });
            }
        }

        lis.forEach(li => {
            const text = li.innerText.trim();
            if (text.startsWith("课程名称：")) {
                commitCourse();
                cur = { name: text.replace("课程名称：", "").trim() };
            } else if (text.startsWith("任课教师：")) {
                cur.teacher = text.replace("任课教师：", "").trim();
            } else if (text.startsWith("上课时间：")) {
                cur.timeStr = text.replace("上课时间：", "").trim();
            } else if (text.startsWith("上课地点：")) {
                cur.position = text.replace("上课地点：", "").trim();
            }
        });

        commitCourse();
    });

    return courses.length > 0 ? courses : null;
}

/**
 * 降级：从标准青果 table 网格抓取
 */
function parseFromTableFallback(doc) {
    const table = Array.from(doc.querySelectorAll("table")).find(t => t.innerText.includes("时段") && t.innerText.includes("节次"));
    if (!table) return null;

    const courses = [];
    const seen = new Set();

    Array.from(table.rows).forEach(row => {
        const cells = Array.from(row.cells);
        if (cells.length < 7) return;

        cells.forEach((cell, colIndex) => {
            const distanceToLast = cells.length - 1 - colIndex;
            if (distanceToLast > 6) return;
            const day = 7 - distanceToLast;

            const rawText = cell.innerText.trim();
            if (!rawText.includes("[")) return;

            const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
            lines.forEach((line, i) => {
                const match = line.match(/([\d\-,]+)\[(\d+)-(\d+)\]/);
                if (match) {
                    const name = i >= 2 ? lines[i - 2] : (i >= 1 ? lines[i - 1] : "未知课程");
                    const teacher = (i >= 1 && !lines[i - 1].includes("[")) ? lines[i - 1] : "";
                    const position = (i < lines.length - 1) ? lines[i + 1] : "";
                    const startSec = parseInt(match[2]);
                    const endSec = parseInt(match[3]);
                    const weeks = parseWeeks(match[1], false, false);

                    const key = `${name}|${teacher}|${position}|${day}|${startSec}-${endSec}|${weeks.join(",")}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        courses.push({
                            name: name.replace(/\s/g, ""),
                            teacher: teacher.replace(/\s/g, ""),
                            position: position.replace(/\s/g, ""),
                            day: day,
                            startSection: startSec,
                            endSection: endSec,
                            weeks: weeks
                        });
                    }
                }
            });
        });
    });

    return courses.length > 0 ? courses : null;
}

/**
 * 执行主导入流程
 */
async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("正在检测浙江工商职院课表结构...");

        const doc = findScheduleDocument(window);
        if (!doc) {
            await window.shiguangBridgePromise.showAlert(
                "未识别到课表",
                "请确认已登录教务系统并进入首页看板或学生课表页面",
                "确定"
            );
            return;
        }

        // 优先解析首页全量详情，未命中则降级为表格解析
        let courses = parseFromLessonScheduleContent(doc);
        if (!courses || courses.length === 0) {
            courses = parseFromTableFallback(doc);
        }

        if (!courses || courses.length === 0) {
            window.shiguangBridge.showToast("未检测到有效课程数据");
            return;
        }

        // 计算最大周次推导学期总周数
        let maxWeek = 20;
        courses.forEach(c => {
            c.weeks.forEach(w => {
                if (w > maxWeek) maxWeek = w;
            });
        });

        // 1. 保存课程数据
        window.shiguangBridge.showToast(`正在导入 ${courses.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        // 2. 注入 12 节课作息时间
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));
        } catch (e) {
            console.warn("作息时间表保存失败:", e);
        }

        // 3. 保存学期配置
        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
                semesterStartDate: null,
                semesterTotalWeeks: maxWeek,
                firstDayOfWeek: 1
            }));
        } catch (e) {
            console.warn("学期配置保存失败:", e);
        }

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程并同步作息时间！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("导入异常: " + error.message);
        console.error("ZJBTI Import Error:", error);
    }
}

runImportFlow();
