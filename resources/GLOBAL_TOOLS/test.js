// ===================== 工具函数 =====================

/**
 * 解析周次字符串，例如 "1-16周"、"1-8周,10-16周"、"1-16周(单)" 等。
 * @param {string} weekStr - 周次描述字符串
 * @returns {number[]} 周次数字数组（升序）
 */
function parseWeeks(weekStr) {
    if (!weekStr || typeof weekStr !== 'string') return [];

    let cleanStr = weekStr.replace(/周/g, '').replace(/\s+/g, '');

    let oddOnly = false, evenOnly = false;
    if (/单/.test(cleanStr)) oddOnly = true;
    if (/双/.test(cleanStr)) evenOnly = true;
    cleanStr = cleanStr.replace(/\(单\)|\(双\)|单|双/g, '');

    const weeks = new Set();
    const parts = cleanStr.split(',');

    for (let part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let w = start; w <= end; w++) {
                    if (oddOnly && w % 2 !== 1) continue;
                    if (evenOnly && w % 2 !== 0) continue;
                    weeks.add(w);
                }
            }
        } else {
            const w = Number(part);
            if (!isNaN(w)) {
                if (oddOnly && w % 2 !== 1) continue;
                if (evenOnly && w % 2 !== 0) continue;
                weeks.add(w);
            }
        }
    }

    return Array.from(weeks).sort((a, b) => a - b);
}

/**
 * 解析 API 返回的 JSON 数据。
 * @param {Object} jsonData - 教务系统返回的 JSON 对象
 * @returns {Array} 解析后的课程数组
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

// ===================== 全局验证函数 =====================

function validateYearInput(input) {
    console.log("JS: validateYearInput 被调用，输入: " + input);
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    } else {
        return "请输入四位数字的学年喵~";
    }
}

function validateDateInput(input) {
    if (input.trim() === '') {
        return false;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
        return false;
    }
    return "日期格式应为 YYYY-MM-DD，例如 2026-08-30";
}

// ===================== 与原生交互的异步封装 =====================

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    console.log("JS: 提示用户输入学年。");
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年喵~",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    console.log("JS: 提示用户选择学期。");
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期喵~",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

async function selectArea() {
    const areas = ["东校区-西校区-北校区", "白云校区", "河源校区"];
    console.log("JS: 提示用户选择校区。");
    const areaIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区喵~",
        JSON.stringify(areas),
        0
    );
    return areaIndex; 
}

async function getSemesterStartDate() {
    console.log("JS: 提示用户输入学期开始日期（可留空跳过）。");
    const input = await window.shiguangBridgePromise.showPrompt(
        "学期开始日期（可选）",
        "请输入学期第一天的日期（YYYY-MM-DD），留空则自动留空：",
        "",
        "validateDateInput"
    );
    if (input === null) {
        console.log("JS: 用户取消了开始日期输入，继续流程。");
        return null;
    }
    if (input.trim() === '') {
        return null;
    }
    return input.trim();
}

function getSemesterCode(semesterIndex) {
    // 3 表示第一学期，12 表示第二学期
    return semesterIndex === 0 ? "3" : "12";
}

// ===================== 网络请求与课程解析 =====================

async function fetchAndParseCourses(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = `gnmkdm=N2151&xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;

    const targetUrls = [
        "https://jwglxt.gpnu.edu.cn/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151"
    ];

    for (const url of targetUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://jwglxt.gpnu.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default",
                    "Origin": "https://jwglxt.gpnu.edu.cn"
                },
                body: requestBody,
                credentials: "include"
            });

            if (response.ok) {
                const jsonText = await response.text();
                const jsonData = JSON.parse(jsonText);
                if (jsonData && jsonData.kbList) {
                    const parsedCourses = parseJsonData(jsonData);
                    if (parsedCourses.length > 0) {
                        const totalWeeks = inferTotalWeeks(parsedCourses);
                        return {
                            courses: parsedCourses,
                            config: {
                                semesterStartDate: null,
                                semesterTotalWeeks: totalWeeks
                            }
                        };
                    }
                }
            }
        } catch (e) {
            console.error(`Entry failed: ${url}`);
        }
    }

    window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
    return null;
}

function inferTotalWeeks(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        const weekNums = course.weeks;
        if (weekNums.length > 0) {
            maxWeek = Math.max(maxWeek, ...weekNums);
        }
    }
    return maxWeek || 20;
}

// ===================== 数据保存 =====================

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// ===================== 三个校区的时间表 =====================

// 东校区-西校区-北校区（统一）
const TimeSlots_one = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:10", endTime: "09:50" },
    { number: 3, startTime: "10:00", endTime: "10:40" },
    { number: 4, startTime: "10:50", endTime: "11:30" },
    { number: 5, startTime: "13:30", endTime: "14:10" },
    { number: 6, startTime: "14:20", endTime: "15:00" },
    { number: 7, startTime: "15:10", endTime: "15:50" },
    { number: 8, startTime: "16:00", endTime: "16:40" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:30", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:00" }
];

// 白云校区
const TimeSlots_two = [
    { number: 1, startTime: "08:30", endTime: "09:10" },
    { number: 2, startTime: "09:15", endTime: "09:55" },
    { number: 3, startTime: "10:05", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:30" },
    { number: 5, startTime: "13:30", endTime: "14:10" },
    { number: 6, startTime: "14:15", endTime: "14:55" },
    { number: 7, startTime: "15:05", endTime: "15:45" },
    { number: 8, startTime: "15:50", endTime: "16:30" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:25", endTime: "20:05" },
    { number: 11, startTime: "20:10", endTime: "20:50" }
];

// 河源校区
const TimeSlots_three = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:10", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "10:50" },
    { number: 4, startTime: "11:00", endTime: "11:40" },
    { number: 5, startTime: "13:50", endTime: "14:30" },
    { number: 6, startTime: "14:40", endTime: "15:20" },
    { number: 7, startTime: "15:40", endTime: "16:20" },
    { number: 8, startTime: "16:30", endTime: "17:10" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:30", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:00" }
];

// 根据校区索引获取对应时间表
function getTimeSlotsByAreaIndex(areaIndex) {
    if (areaIndex === 0) return TimeSlots_one;
    if (areaIndex === 1) return TimeSlots_two;
    if (areaIndex === 2) return TimeSlots_three;
    // 默认返回第一个
    return TimeSlots_one;
}

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

// ===================== 主流程 =====================

async function runImportFlow() {

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 获取学年失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 选择学期失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学期索引: ${semesterIndex}`);

    const areaIndex = await selectArea();
    if (areaIndex === null || areaIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 选择校区失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择校区索引: ${areaIndex}`);

    const startDate = await getSemesterStartDate();
    console.log(`JS: 学期开始日期输入结果: ${startDate}`);

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }

    result.config.semesterStartDate = startDate;
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }

    // 根据校区选择对应时间表并导入
    const timeSlots = getTimeSlotsByAreaIndex(areaIndex);
    await importPresetTimeSlots(timeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
