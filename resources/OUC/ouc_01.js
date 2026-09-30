// 中国海洋大学拾光课程表适配脚本 v2
// 基于强智教务系统适配

function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const isSingle = weekStr.includes('(单)');
    const isDouble = weekStr.includes('(双)');
    const clean = weekStr.replace(/\([单双]\)/g, '').replace(/周/g, '');
    const weeks = [];

    for (let part of clean.split(',')) {
        part = part.trim();
        if (!part) continue;

        let start, end;
        if (part.includes('-')) {
            const p = part.split('-');
            start = Number(p[0]);
            end = Number(p[1]);
        } else {
            start = end = Number(part);
        }
        if (isNaN(start) || isNaN(end)) continue;

        for (let w = start; w <= end; w++) {
            if (isSingle && w % 2 === 0) continue;
            if (isDouble && w % 2 !== 0) continue;
            weeks.push(w);
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseCourseItem(item, day) {
    const titleEl = item.querySelector('.qz-hasCourse-title');
    const name = titleEl ? titleEl.textContent.trim() : '';

    const detailText = item.textContent.replace(/\s+/g, '');

    const teacherMatch = detailText.match(/教师[：:]\s*([^0-9~一二三四五六日\[]+)/);
    const teacher = teacherMatch ? teacherMatch[1].trim() : '';

    const sectionMatch = detailText.match(/(\d+)[~-](\d+)节/) || detailText.match(/(\d+)节/);
    let startSection = 1;
    let endSection = 1;
    if (sectionMatch) {
        startSection = Number(sectionMatch[1]);
        endSection = sectionMatch[2] ? Number(sectionMatch[2]) : startSection;
    }

    const weekMatch = detailText.match(/\[([^\]]*周[^\]]*)\]/) || detailText.match(/\[([^\]]*)\]/);
    let weeks = [];
    if (weekMatch) {
        weeks = parseWeeks(weekMatch[1]);
    }

    const dayMatch = detailText.match(/星期[一二三四五六日]/);
    let position = '';
    if (dayMatch) {
        position = detailText.substring(dayMatch.index + dayMatch[0].length).trim();
    }

    if (weeks.length === 0) return [];
    return [{ name, teacher, position, day, startSection, endSection, weeks }];
}

function findTimetableTable(doc) {
    let table = doc.querySelector('table.qz-weeklyTable');
    if (table) return table;

    const iframes = doc.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            if (iframe.contentDocument) {
                table = findTimetableTable(iframe.contentDocument);
                if (table) return table;
            }
        } catch (e) {
            console.warn("无法访问 iframe:", e.message);
        }
    }
    return null;
}

async function waitForTimetable() {
    for (let i = 0; i < 75; i++) {
        const table = findTimetableTable(document);
        if (table) {
            const itemCount = table.querySelectorAll('.courselists-item').length;
            if (itemCount > 0) {
                return table;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return null;
}

function parseCourseDataFromDom(table) {
    const courses = [];
    const rows = table.querySelectorAll('tbody tr.qz-weeklyTable-tr');

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        for (let col = 1; col < cells.length; col++) {
            const day = col; // col 1=周一 ... col 7=周日
            cells[col].querySelectorAll('.courselists-item').forEach(item => {
                courses.push(...parseCourseItem(item, day));
            });
        }
    });

    return courses;
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "中国海洋大学课表导入",
        "导入前请确保您已打开学生课表页面并成功登录教务系统",
        "好的，开始导入"
    );
}

async function fetchAndParseCourses() {
    console.log("开始解析页面课程表...");

    const table = await waitForTimetable();
    if (!table) {
        window.shiguangBridge.showToast("未找到课程数据，请确认当前处于学生课表页面。");
        return null;
    }

    const courses = parseCourseDataFromDom(table);
    if (courses.length === 0) {
        window.shiguangBridge.showToast("已找到表格但未解析到课程数据。");
        return null;
    }

    console.log(`解析到 ${courses.length} 门课程。`);
    return {
        courses: courses,
        config: {
            semesterStartDate: null,
            semesterTotalWeeks: 17,
            defaultClassDuration: 50,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }
    };
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

// 崂山
const LAOSHAN_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "13:30", endTime: "14:20" },
    { number: 6, startTime: "14:30", endTime: "15:20" },
    { number: 7, startTime: "15:30", endTime: "16:20" },
    { number: 8, startTime: "16:30", endTime: "17:20" },
    { number: 9, startTime: "17:30", endTime: "18:20" },
    { number: 10, startTime: "18:30", endTime: "19:20" },
    { number: 11, startTime: "19:30", endTime: "20:20" },
    { number: 12, startTime: "20:30", endTime: "21:20" }
];
// 西海岸
const WEST_COAST_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:20" },
    { number: 2, startTime: "09:25", endTime: "10:15" },
    { number: 3, startTime: "10:30", endTime: "11:20" },
    { number: 4, startTime: "11:25", endTime: "12:15" },
    ...LAOSHAN_TIME_SLOTS.slice(4)
];

const SCHEDULE_OPTIONS = [
    { name: "崂山/鱼山校区", slots: LAOSHAN_TIME_SLOTS },
    { name: "西海岸校区", slots: WEST_COAST_TIME_SLOTS }
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return;
    }

    window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

async function runImportFlow() {
    window.shiguangBridge.showToast("课程导入流程即将开始...");

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const result = await fetchAndParseCourses();
    if (result === null) {
        return;
    }
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择校区作息表：",
        JSON.stringify(SCHEDULE_OPTIONS.map(option => option.name)),
        0
    );
    const scheduleIndex = Number(selectedIndex);
    const schedule = SCHEDULE_OPTIONS[
        Number.isInteger(scheduleIndex) && scheduleIndex >= 0 && scheduleIndex < SCHEDULE_OPTIONS.length
            ? scheduleIndex
            : 0
    ];
    await importPresetTimeSlots(schedule.slots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
