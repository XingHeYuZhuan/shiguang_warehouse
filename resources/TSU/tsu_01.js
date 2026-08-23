const SECTION_TIMES = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:55", endTime: "09:40" },
    { number: 3,  startTime: "10:00", endTime: "10:45" },
    { number: 4,  startTime: "10:55", endTime: "11:40" },
    { number: 5,  startTime: "14:30", endTime: "15:15" },
    { number: 6,  startTime: "15:25", endTime: "16:10" },
    { number: 7,  startTime: "16:30", endTime: "17:15" },
    { number: 8,  startTime: "17:25", endTime: "18:10" },
    { number: 9,  startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
];

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

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("泰山学院引擎启动，抓取数据中...");
        const courses = await fetchAndParseCourses();
        if (!courses || courses.length === 0) {
            window.shiguangBridge.showToast("解析完成，但当前课表为空");
            window.shiguangBridge.notifyTaskCompletion();
            return;
        }

        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saveResult !== true) return;

        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(SECTION_TIMES));

        window.shiguangBridge.showToast(`导入大成功！合并生成 ${courses.length} 个课块`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("⚠️ " + error.message);
        window.shiguangBridge.notifyTaskCompletion();
    }
}

runImportFlow();
