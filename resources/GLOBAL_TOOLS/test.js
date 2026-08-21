// ===================== 工具函数 =====================

/**
 * 解析周次字符串，例如 "1-16周"、"1-8周,10-16周"、"1-16周(单)" 等。
 * @param {string} weekStr - 周次描述字符串
 * @returns {number[]} 周次数字数组（升序）
 */
function parseWeeks(weekStr) {
    if (!weekStr || typeof weekStr !== 'string') return [];

    // 去除 "周" 字和空格
    let cleanStr = weekStr.replace(/周/g, '').replace(/\s+/g, '');

    // 检测单双周标记
    let oddOnly = false, evenOnly = false;
    if (/单/.test(cleanStr)) oddOnly = true;
    if (/双/.test(cleanStr)) evenOnly = true;
    // 移除括号和单双字
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
        // 关键字段检查
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        // 解析节次范围，例如 "1-2"
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj); // 1=周一 ... 7=周日

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
        return false; // 验证通过
    } else {
        return "请输入四位数字的学年！";
    }
}

// 日期验证：允许空或 YYYY-MM-DD 格式
function validateDateInput(input) {
    if (input.trim() === '') {
        return false; // 空值允许
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
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    console.log("JS: 提示用户选择学期。");
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex; // 可能是 -1 或 null
}

// 新增：获取可选开始日期
async function getSemesterStartDate() {
    console.log("JS: 提示用户输入学期开始日期（可留空跳过）。");
    const input = await window.shiguangBridgePromise.showPrompt(
        "学期开始日期（可选）",
        "请输入学期第一天的日期（YYYY-MM-DD），留空则自动留空：",
        "",
        "validateDateInput"
    );
    // 如果用户取消（返回 null），继续流程，开始日期为 null
    if (input === null) {
        console.log("JS: 用户取消了开始日期输入，继续流程。");
        return null;
    }
    // 如果用户输入空字符串，也视为 null
    if (input.trim() === '') {
        return null;
    }
    return input.trim();
}

/**
 * 将选择索引转换为 API 所需的学期码。
 */
function getSemesterCode(semesterIndex) {
    // 3 表示第一学期，12 表示第二学期（广师大确认）
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
                        // 自动推断总周数
                        const totalWeeks = inferTotalWeeks(parsedCourses);
                        return {
                            courses: parsedCourses,
                            config: {
                                semesterStartDate: null, // 稍后填充
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

/**
 * 从课程周次中推断学期总周数（取最大周次）。
 * @param {Array} courses - 课程数组
 * @returns {number} 总周数
 */
function inferTotalWeeks(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        const weekNums = course.weeks;
        if (weekNums.length > 0) {
            maxWeek = Math.max(maxWeek, ...weekNums);
        }
    }
    return maxWeek || 20; // 若推断失败则默认20
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

// 统一作息时间（需确认广师大实际时间）
const TimeSlots = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:25", endTime: "11:10" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:40", endTime: "15:25" },
    { number: 6, startTime: "15:30", endTime: "16:15" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:20", endTime: "18:05" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:20", endTime: "21:05" },
];

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

    // 新增：获取可选开始日期
    const startDate = await getSemesterStartDate();
    console.log(`JS: 学期开始日期输入结果: ${startDate}`);

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }

    // 将开始日期填入 config
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

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
