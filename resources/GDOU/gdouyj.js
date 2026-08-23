/**
 * 广东海洋大学阳江校区教务适配
 * @date 2026-7-30
 * @author Mccurtain (原始 GDOU 适配)
 * @adapted-by Yihe-ng (阳江校区作息与适配)
 * @version 1.1
 */

/**
 * 解析周次字符串，处理单双周和周次范围。
 * 兼容格式："1-16周"、"6周"、"1-8周(单)"、"1-10周(双)"、"1-5周,9周"
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const normalizedWeekStr = String(weekStr).replace(/，/g, ',');
    const weekSets = normalizedWeekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)\s*-\s*(\d+)\s*周?/);
        const singleMatch = trimmedSet.match(/^(\d+)\s*周?/); // 匹配单个周次

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) { // 范围, 如 "1-5周"
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) { // 单个周, 如 "6周"
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed && start >= 1 && end >= start) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析节次字符串，例如 "1-2"、"1-2节" 或单节 "3"。
 * 返回 null 表示接口返回了无法识别的节次格式。
 */
function parseSectionRange(sectionStr) {
    const sectionText = sectionStr == null ? '' : String(sectionStr);
    const sectionMatch = sectionText.match(/^\s*(?:第)?(\d+)\s*(?:-\s*(\d+))?\s*节?\s*$/);

    if (!sectionMatch) {
        return null;
    }

    const startSection = Number(sectionMatch[1]);
    const endSection = Number(sectionMatch[2] || sectionMatch[1]);

    if (!Number.isInteger(startSection) || !Number.isInteger(endSection) ||
        startSection < 1 || endSection < startSection) {
        return null;
    }

    return { startSection, endSection };
}

/**
 * 阳江校区其他场地（非慎思楼）的作息。
 * 只有第 3、4 节在校区作息表中是不同的连续时间块，使用自定义时间表示。
 */
const OTHER_VENUE_SECTION_3_4_TIME = { startTime: "10:10", endTime: "11:40" };

function getOtherVenueCustomTime(position, startSection, endSection) {
    const positionText = position == null ? '' : String(position);
    if (!positionText || positionText.includes("慎思楼")) {
        return null;
    }

    if (startSection !== 3 || endSection !== 4) {
        return null;
    }

    return OTHER_VENUE_SECTION_3_4_TIME;
}

/**
 * 解析正方 v9 课表查询接口返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    // 正方 v9 个人课表数据放在 kbList 字段中
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse || typeof rawCourse !== 'object') {
            continue;
        }

        // 课程名、星期、节次和周次是解析所必需的；教师或教室为空时仍保留课程。
        if (!rawCourse.kcmc || rawCourse.xqj == null ||
            rawCourse.jcs == null || rawCourse.zcd == null) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        const sectionRange = parseSectionRange(rawCourse.jcs);
        if (!sectionRange) {
            console.warn(`JS: 跳过无法解析节次的课程：${rawCourse.kcmc}`);
            continue;
        }

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
        if (isNaN(day) || day < 1 || day > 7) {
            continue;
        }

        const course = {
            name: String(rawCourse.kcmc).trim(),
            teacher: rawCourse.xm == null ? '' : String(rawCourse.xm).trim(),
            position: rawCourse.cdmc == null ? '' : String(rawCourse.cdmc).trim(),
            day: day,
            startSection: sectionRange.startSection,
            endSection: sectionRange.endSection,
            weeks: weeksArray
        };

        const customTime = getOtherVenueCustomTime(
            course.position,
            course.startSection,
            course.endSection
        );
        if (customTime) {
            course.isCustomTime = true;
            course.customStartTime = customTime.startTime;
            course.customEndTime = customTime.endTime;
        }

        finalCourseList.push(course);
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

/**
 * showPrompt 的校验函数：限定四位数字学年。
 */
function validateYearInput(input) {
    console.log("JS: validateYearInput 被调用，输入: " + input);
    if (/^[0-9]{4}$/.test(input)) {
        console.log("JS: validateYearInput 验证通过。");
        return false;
    } else {
        console.log("JS: validateYearInput 验证失败。");
        return "请输入四位数字的学年！";
    }
}

/**
 * 根据当前日期推断学年起始年份。
 * 中国高校通常在 9 月开始新学年，因此 1-8 月默认使用上一年。
 */
function getDefaultAcademicYear(date = new Date()) {
    const currentYear = date.getFullYear();
    const academicYearStart = date.getMonth() >= 8 ? currentYear : currentYear - 1;
    return academicYearStart.toString();
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "广东海洋大学阳江校区教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录广东海洋大学教务系统（jw.gdou.edu.cn）。\n本脚本将通过接口直接获取阳江校区课表，无需停留在特定页面。",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = getDefaultAcademicYear();
    console.log("JS: 提示用户输入学年。");
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入 2025）:",
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
    return semesterIndex;
}

/**
 * 将选择索引转换为正方教务接口所需的学期码。
 * 正方 v9：第一学期 = "3"，第二学期 = "12"
 */
function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 请求正方 v9 课表接口并解析课程数据。
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;

    // 广东海洋大学正方教务 v9 个人课表查询接口
    const targetUrl = "https://jw.gdou.edu.cn/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";

    try {
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: requestBody,
            credentials: "include"
        });

        if (!response.ok) {
            window.shiguangBridge.showToast(`课表请求失败：HTTP ${response.status}`);
            console.error(`JS: 接口返回非 200 状态码：${response.status}`);
            return null;
        }

        const jsonText = await response.text();
        const jsonData = JSON.parse(jsonText);

        if (!jsonData || !Array.isArray(jsonData.kbList) || jsonData.kbList.length === 0) {
            window.shiguangBridge.showToast("未查询到课表数据，请检查学年/学期是否选择正确，或确认已登录教务系统。");
            return null;
        }

        const parsedCourses = parseJsonData(jsonData);
        if (parsedCourses.length === 0) {
            window.shiguangBridge.showToast("课表数据为空或解析失败，请确认所选学年学期。");
            return null;
        }

        return {
            courses: parsedCourses,
            // CourseConfigJsonModel（wiki 1.3）：所有字段可选，未提供则用默认值。
            // GDOU 各节课间隔不统一，因此用 TimeSlot 节次表达时间，此处仅设置总周数。
            config: {
                semesterStartDate: null,       // 未提供校历日期，App 不会按日期计算当前周
                semesterTotalWeeks: 20          // 本学期总周数
            }
        };
    } catch (e) {
        console.error("JS: 获取课表失败:", e);
        window.shiguangBridge.showToast("获取课表失败，请确认已登录教务系统且网络可访问 jw.gdou.edu.cn。");
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// 阳江校区慎思楼上课时间（根据用户提供的校区作息表）
const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:05", endTime: "09:50" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:20", endTime: "17:05" },
    { number: 8, startTime: "17:10", endTime: "17:55" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

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

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
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
        return;
    }

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 脚本执行入口
runImportFlow();

