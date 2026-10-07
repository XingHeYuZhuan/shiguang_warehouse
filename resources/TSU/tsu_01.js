// ===== 作息时间 =====
// 夏令时（每年 5月1日–10月7日）：作为基础时间段（骨架）提交
const SUMMER_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:55", endTime: "09:40" },
    { number: 3,  startTime: "10:00", endTime: "10:45" },
    { number: 4,  startTime: "10:55", endTime: "11:40" },
    { number: 5,  startTime: "14:30", endTime: "15:15" },
    { number: 6,  startTime: "15:25", endTime: "16:10" },
    { number: 7,  startTime: "16:30", endTime: "17:15" },
    { number: 8,  startTime: "17:25", endTime: "18:10" },
    { number: 9,  startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

// 冬令时（每年 10月8日–次年4月30日）：上午 1–4 节与晚间 9–10 节和夏令时一致，
// 仅下午 5–8 节整体提前 30 分钟。借助差量合并机制，只提交与骨架不同的节次。
const WINTER_DIFF_SLOTS = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" }
];

// ===== 日期工具 =====
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// 推算夏/冬令时的生效区间：
//   夏令时：本年 5月1日 – 10月7日
//   冬令时：10月8日 – 次年 4月30日（1–4月导入时，冬令时自上一年 10月8日起算）
function buildComboDateRanges() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const winterStartYear = month <= 4 ? year - 1 : year;
    return {
        summer: { startDate: `${year}-05-01`, endDate: `${year}-10-07` },
        winter: { startDate: `${winterStartYear}-10-08`, endDate: `${winterStartYear + 1}-04-30` }
    };
}

// ===== 课表解析 =====
function parseWeeks(weekStr, parity) {
    const weeks = [];
    weekStr.split(',').forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            const w = parseInt(part);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    if (parity === '单') return weeks.filter(w => w % 2 === 1);
    if (parity === '双') return weeks.filter(w => w % 2 === 0);
    return weeks;
}

function findTable(win) {
    const t = Array.from(win.document.querySelectorAll('table'))
        .find(x => x.innerText.includes("星期一") && x.innerText.includes("["));
    if (t) return t;
    for (let i = 0; i < win.frames.length; i++) {
        try {
            const st = findTable(win.frames[i]);
            if (st) return st;
        } catch (e) {}
    }
    return null;
}

async function fetchAndParseCourses() {
    const table = findTable(window);
    if (!table) {
        throw new Error("未检测到课表数据，请确保已切换到显示课表的页面！");
    }

    const rawItems = [];
    Array.from(table.rows).forEach(row => {
        const cells = Array.from(row.cells);
        if (cells.length < 7) return;

        cells.forEach((cell, colIndex) => {
            const distanceToLast = cells.length - 1 - colIndex;
            if (distanceToLast > 6) return;
            const day = 7 - distanceToLast;
            const rawText = cell.innerText.trim();
            if (!rawText.includes('[')) return;

            // 过滤空行、清理隐藏的乱码字符
            const lines = rawText.split('\n').map(l => l.replace(/[\s\u200B-\u200D\uFEFF]/g, '').trim()).filter(l => l);

            // 找出所有时间的行号(锚点)
            const timeIndices = [];
            lines.forEach((line, index) => {
                if (/([\d\-,]+)\s*(?:单|双)?\s*\[(\d+)-(\d+)\]/.test(line)) {
                    timeIndices.push(index);
                }
            });

            timeIndices.forEach((currTimeIdx, k) => {
                const nextTimeIdx = (k + 1 < timeIndices.length) ? timeIndices[k + 1] : lines.length;
                const match = lines[currTimeIdx].match(/([\d\-,]+)\s*(单|双)?\s*\[(\d+)-(\d+)\]/);

                if (match) {
                    // 1. 抓取课名和老师
                    let name = "未知课程";
                    let teacher = "未知教师";
                    let nameTeacherLines = (k === 0) ? lines.slice(0, currTimeIdx) : lines.slice(timeIndices[k - 1] + 1, currTimeIdx);

                    if (nameTeacherLines.length > 2) {
                        nameTeacherLines = nameTeacherLines.slice(nameTeacherLines.length - 2);
                    }

                    if (nameTeacherLines.length >= 2) {
                        name = nameTeacherLines[0];
                        teacher = nameTeacherLines[1];
                    } else if (nameTeacherLines.length === 1) {
                        name = nameTeacherLines[0];
                        teacher = "";
                    }

                    // 2. 抓取地点
                    let position = "";
                    const gap = nextTimeIdx - currTimeIdx - 1;

                    if (k === timeIndices.length - 1) {
                        if (gap > 0) position = lines.slice(currTimeIdx + 1).join(' ');
                    } else {
                        if (gap === 3) {
                            position = lines[currTimeIdx + 1];
                        } else if (gap > 3) {
                            position = lines.slice(currTimeIdx + 1, nextTimeIdx - 2).join(' ');
                        } else {
                            position = "";
                        }
                    }

                    rawItems.push({
                        name: name,
                        teacher: teacher,
                        position: position,
                        day: day,
                        startSection: parseInt(match[3]),
                        endSection: parseInt(match[4]),
                        weeks: parseWeeks(match[1], match[2])
                    });
                }
            });
        });
    });

    const groupMap = new Map();
    rawItems.forEach(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
        if (!groupMap.has(key)) groupMap.set(key, {});
        const weekMap = groupMap.get(key);
        item.weeks.forEach(w => {
            if (!weekMap[w]) weekMap[w] = new Set();
            for (let s = item.startSection; s <= item.endSection; s++) {
                weekMap[w].add(s);
            }
        });
    });

    const finalCourses = [];
    groupMap.forEach((weekMap, key) => {
        const [name, teacher, position, day] = key.split('|');
        const patternMap = new Map();
        Object.keys(weekMap).forEach(w => {
            const week = parseInt(w);
            const sections = Array.from(weekMap[week]).sort((a, b) => a - b);
            if (sections.length === 0) return;
            let start = sections[0];
            for (let i = 0; i < sections.length; i++) {
                if (i === sections.length - 1 || sections[i+1] !== sections[i] + 1) {
                    const pKey = `${start}-${sections[i]}`;
                    if (!patternMap.has(pKey)) patternMap.set(pKey, []);
                    patternMap.get(pKey).push(week);
                    if (i < sections.length - 1) start = sections[i+1];
                }
            }
        });
        patternMap.forEach((weeks, pKey) => {
            const [sStart, sEnd] = pKey.split('-').map(Number);
            finalCourses.push({
                name, teacher, position,
                day: parseInt(day),
                startSection: sStart,
                endSection: sEnd,
                weeks: weeks.sort((a, b) => a - b)
            });
        });
    });
    return finalCourses;
}

// ===== 导入流程 =====
// 读取课表页自带的学年学期下拉框（值如 "2026-0"），确定当前导入的学期
async function getDisplayedXnxq() {
    let found = null;
    (function walk(win) {
        if (found) return;
        try {
            const sel = win.document.getElementById("xnxq");
            if (sel && sel.value) { found = sel.value; return; }
        } catch (e) {}
        for (let i = 0; i < win.frames.length; i++) { try { walk(win.frames[i]); } catch (e) {} }
    })(window);
    return found;
}

// 官方青果案例方案（同 WZZY）：教学安排表接口按教学周次出表，jxz=1 即第 1 周，
// 第 1 周视图周一列头的日期即开学日期。注意：泰山该接口返回 UTF-8（课表接口才是 GBK）
async function fetchSemesterStartDate(xn, xq) {
    const resp = await fetch(`${window.location.origin}/frame/desk/showLessonScheduleInfosV14.action?xn=${xn}&xq=${xq}&jxz=1`, {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
        credentials: "include"
    });
    const html = await resp.text();
    const match = html.match(/<br\s*\/?>\s*(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = xq === "1" ? String(parseInt(xn) + 1) : String(xn);
    return `${year}-${match[1]}-${match[2]}`;
}

async function saveSemesterStartDate(startDate) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: startDate
        }));
        window.shiguangBridge.showToast("开学日期已保存");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存开学日期失败: " + error.message);
        return false;
    }
}

async function importTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(SUMMER_TIME_SLOTS));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

async function importComboSchedule() {
    const ranges = buildComboDateRanges();
    const comboSchedule = {
        name: "泰山学院夏冬作息方案",
        publicSchedules: [
            {
                name: "夏令时",
                startDate: ranges.summer.startDate,
                endDate: ranges.summer.endDate,
                // 与基础时间段一致，空数组即全部由骨架补齐
                timeSlots: []
            },
            {
                name: "冬令时",
                startDate: ranges.winter.startDate,
                endDate: ranges.winter.endDate,
                // 仅提交下午 5–8 节，上午与晚间由骨架补齐
                timeSlots: WINTER_DIFF_SLOTS
            }
        ]
    };

    try {
        await window.shiguangBridgePromise.saveComboSchedule(JSON.stringify(comboSchedule));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("组合作息导入失败: " + error.message);
        return false;
    }
}

// 编排整个导入流程：任何一步取消或失败立即终止，
// notifyTaskCompletion() 只在成功后调用
async function runImportFlow() {
    // 1. 抓取并解析课表
    window.shiguangBridge.showToast("正在抓取课表数据...");
    let courses;
    try {
        courses = await fetchAndParseCourses();
    } catch (error) {
        window.shiguangBridge.showToast("导入失败：" + error.message);
        return;
    }
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未解析到课程数据，请确认当前页面显示的是课表");
        return;
    }

    // 2. 自动获取开学日期（官方青果案例方案），获取/保存失败均不阻断导入
    try {
        const xnxq = await getDisplayedXnxq();
        if (xnxq) {
            const [xn, xq] = xnxq.split("-");
            const apiStartDate = await fetchSemesterStartDate(xn, xq);
            if (apiStartDate) {
                await saveSemesterStartDate(apiStartDate);
            } else {
                window.shiguangBridge.showToast("开学日期获取失败，可在App内手动设置");
            }
        } else {
            window.shiguangBridge.showToast("开学日期获取失败，可在App内手动设置");
        }
    } catch (error) {
        window.shiguangBridge.showToast("开学日期获取失败，可在App内手动设置");
    }

    // 3. 保存课程，失败则终止
    try {
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saveResult !== true) {
            window.shiguangBridge.showToast("导入失败：课程数据未能保存");
            return;
        }
    } catch (error) {
        window.shiguangBridge.showToast("导入失败：" + error.message);
        return;
    }

    // 4. 导入基础时间段（夏令时），必须成功才能提交组合作息
    const timeSlotSaved = await importTimeSlots();

    // 5. 导入夏/冬组合作息；时间段失败时跳过，不阻断流程
    if (timeSlotSaved) {
        await importComboSchedule();
    } else {
        window.shiguangBridge.showToast("时间段导入失败，跳过组合作息。");
    }

    // 6. 流程完全成功，发送结束信号
    window.shiguangBridge.showToast(`导入成功，共 ${courses.length} 门课程，夏/冬令时将按日期自动切换`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
