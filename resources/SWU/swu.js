// 西南大学(swu.edu.cn) 拾光课程表适配脚本
// 基于正方新一代教务系统接口适配
// 维护者：小漫君(xiaomanjun233)
// 出现问题请提issues或者提交pr更改,这更加快速
//
// 通过正方接口 xskbcx_cxXsgrkb 拉取个人课表 JSON（kbList），解析课程名、教师、教室、
// 星期、节次和周次（含单双周）；集中实践课（军训、毕业设计等）无星期节次，弹窗提示手动添加。
// 交互上依次询问学年与学期；导入课程、课表配置与西南大学 14 节节次时间。
//
// 使用方式：从办事大厅(i.swu.edu.cn)登录后进入教务系统(jw.swu.edu.cn/jwglxt)课表查询页面，再执行导入。

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/); // 匹配以数字周结束的

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

        if (processed) {
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
 * 拼接教务系统接口地址。
 * 西南大学教务（jw.swu.edu.cn）的正方新一代部署在 /jwglxt 子路径下，
 * 接口路径必须带上该前缀；校外经 WebVPN 访问时路径还带有 /http/<hex> 前缀，需保留。
 */
function buildApiUrl(path) {
    const prefixMatch = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    const webvpnPrefix = prefixMatch ? prefixMatch[0] : "";
    return window.location.origin + webvpnPrefix + "/jwglxt" + path;
}

/**
 * 拼装课程备注。
 * xm 只有姓名，kcmc 只有课程名，以下信息只存在于原始字段里，
 * 放进备注方便用户核对：重修标记、选课备注（体育项目、微专业等）、周次原文。
 */
function buildCourseRemark(rawCourse) {
    const parts = [];

    const retakeFlag = String(rawCourse.cxbjmc || "").trim();
    if (retakeFlag) {
        parts.push(retakeFlag);
    }

    const selectionNote = String(rawCourse.xkbz || "").trim();
    if (selectionNote) {
        parts.push(selectionNote);
    }

    const weekDesc = String(rawCourse.zcd || "").trim();
    if (weekDesc) {
        parts.push(weekDesc);
    }

    return parts.join(" | ");
}

/**
 * 解析集中实践课列表（sjkList）。
 * 这类课程（军事技能训练、毕业设计等）只有课程名、教师和起止周，
 * 没有星期和节次，无法映射到周课表，只能提示用户手动添加。
 */
function parsePracticeCourses(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.sjkList)) {
        return [];
    }

    return jsonData.sjkList
        .map((item) => ({
            name: String(item.kcmc || "").trim(),
            teacher: String(item.jsxm || "").trim(),
            weekDesc: String(item.qsjsz || "").trim()
        }))
        .filter((item) => item.name);
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    // 检查JSON结构：新的数据在 kbList 字段中
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 关键字段检查：只有 kcmc(课名), xqj(星期), jcs(节次范围), zcd(周次描述) 是排课必需的。
        // xm(教师) 与 cdmc(教室) 在实践课、线上课、未排地点的课程上可能为空，
        // 缺这两项不影响排课，不能因此丢弃整门课程。
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        // 解析节次范围，例如 "1-2"
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        const remark = buildCourseRemark(rawCourse);

        const course = {
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        };

        if (remark) {
            course.remark = remark;
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

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    }
    return "请输入四位数字的学年！";
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "西南大学课表导入",
        "导入前请确保您已从办事大厅(i.swu.edu.cn)登录并进入教务系统(jw.swu.edu.cn)课表查询页面。",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    const currentMonth = new Date().getMonth() + 1; // 月份从0开始，所以加1
    // 如果当前月份在8月或之后，默认学年是当前年份-下一年份，否则是上一年份-当前年份
    const defaultYear = currentMonth >= 8 ? currentYear : (Number(currentYear) - 1).toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（如2025-2026 应该填2025）:",
        defaultYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    const currentMonth = new Date().getMonth() + 1; // 月份从0开始，所以加1
    const defaultSemesterIndex = currentMonth >= 8 ? 0 : 1; // 如果当前月份在8月或之后，默认选择第一学期，否则选择第二学期
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        defaultSemesterIndex
    );
    return semesterIndex;
}

/**
 * 将选择索引转换为 API 所需的学期码。
 */
function getSemesterCode(semesterIndex) {
    // semesterIndex 3 (第一学期), 12 (第二学期)
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 获取教务系统当前学期的起止日期。
 * 首页日历区块的标题形如 "2026-2027学年1学期(2026-08-31至2027-02-21)"，
 * 其中起始日期就是第 1 周周一，正是 semesterStartDate 需要的值。
 * 注意：该接口忽略 xnm/xqm 参数，只返回当前学期，
 * 因此只有用户选择的学年学期与返回值一致时才能使用。
 */
async function fetchCurrentSemesterRange() {
    const url = buildApiUrl("/xtgl/index_cxAreaFive.html?localeKey=zh_CN&gnmkdm=index");

    try {
        const response = await fetch(url, {
            "headers": {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            "body": "",
            "method": "POST",
            "credentials": "include"
        });

        if (!response.ok) {
            throw new Error(`状态码 ${response.status}`);
        }

        const html = await response.text();
        const match = html.match(/(\d{4})-\d{4}学年(\d)学期\s*[（(](\d{4}-\d{2}-\d{2})至(\d{4}-\d{2}-\d{2})[）)]/);

        if (!match) {
            console.warn("JS: 未能从日历区块解析出学期起止日期。");
            return null;
        }

        const range = {
            academicYear: match[1],
            semesterIndex: Number(match[2]) - 1,
            startDate: match[3],
            endDate: match[4]
        };
        console.log("JS: 教务系统当前学期:", range);
        return range;

    } catch (error) {
        console.warn("JS: 获取学期起止日期失败:", error);
        return null;
    }
}

/**
 * 计算课表配置。
 *
 * 应用侧的 saveCourseConfig 是整体覆盖而非字段级合并：没有传入的字段会被写成模型默认值，
 * 其中 semesterStartDate 的默认值是 null，会把用户已经设置好的开学日期清空。
 * 所以拿不到真实开学日期时返回 null，由调用方跳过整个配置保存，宁可不写也不要写坏。
 */
function buildCourseConfig(courses, semesterRange, firstDayOfWeek) {
    if (!semesterRange) {
        return null;
    }

    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) {
                maxWeek = week;
            }
        }
    }

    return {
        semesterStartDate: semesterRange.startDate,
        // 只增不减：默认 20 周，课表里出现更大的周次时才扩展。
        semesterTotalWeeks: Math.max(maxWeek, 20),
        firstDayOfWeek: firstDayOfWeek
    };
}

/**
 * 请求和解析课程数据。
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const semesterCode = getSemesterCode(semesterIndex);

    // API URL 和请求体
    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const url = buildApiUrl("/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151");

    console.log(`JS: 发送请求到 ${url}, body: ${xnmXqmBody}`);

    const requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        "body": xnmXqmBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
        }

        const jsonText = await response.text();
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error('JS: JSON 解析失败:', e);
            window.shiguangBridge.showToast("数据返回格式错误，请确认已进入教务系统(jw.swu.edu.cn)课表查询页面（而非停留在办事大厅门户页），且登录状态有效。");
            return null;
        }

        const courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);

        // 集中实践课（军训、毕业设计等）没有星期和节次，无法排进周课表，单独取出用于提示。
        const practiceCourses = parsePracticeCourses(jsonData);
        if (practiceCourses.length > 0) {
            console.log(`JS: 检测到 ${practiceCourses.length} 门集中实践课，无法自动导入。`);
        }

        // qsxqj: 教务系统设置的一周起始星期几，缺失时按周一处理。
        const rawFirstDay = Number(jsonData.qsxqj);
        const firstDayOfWeek = (rawFirstDay >= 1 && rawFirstDay <= 7) ? rawFirstDay : 1;

        return {
            courses: courses,
            practiceCourses: practiceCourses,
            firstDayOfWeek: firstDayOfWeek
        };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

/**
 * 只在能拿到真实开学日期时写入课表配置。
 * 拿不到就完全不调用 saveCourseConfig —— 应用侧是整体覆盖，
 * 传入不含 semesterStartDate 的配置会把用户已设置的开学日期清空。
 */
async function saveCourseConfigIfPossible(courses, academicYear, semesterIndex, firstDayOfWeek) {
    const semesterRange = await fetchCurrentSemesterRange();

    let usableRange = null;
    if (semesterRange) {
        const sameYear = semesterRange.academicYear === String(academicYear);
        const sameSemester = semesterRange.semesterIndex === semesterIndex;

        if (sameYear && sameSemester) {
            usableRange = semesterRange;
        } else {
            console.log(
                `JS: 所选学年学期(${academicYear}/第${semesterIndex + 1}学期)` +
                `不是教务系统当前学期(${semesterRange.academicYear}/第${semesterRange.semesterIndex + 1}学期)，跳过开学日期写入。`
            );
        }
    }

    const config = buildCourseConfig(courses, usableRange, firstDayOfWeek);

    if (!config) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表配置，请在应用内手动设置开学日期。");
        console.log("JS: 无可用开学日期，跳过 saveCourseConfig 以保留用户现有配置。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            `课表配置更新成功！开学日期 ${config.semesterStartDate}，总周数 ${config.semesterTotalWeeks} 周。`
        );
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }
}

// 西南大学统一作息时间（14 节，第 5 节 12:10 从中午开始，傍晚 17:50 后为第 11 节）
const SWU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "12:10", endTime: "12:55" },
    { number: 6, startTime: "13:05", endTime: "13:50" },
    { number: 7, startTime: "14:00", endTime: "14:45" },
    { number: 8, startTime: "14:55", endTime: "15:40" },
    { number: 9, startTime: "15:50", endTime: "16:35" },
    { number: 10, startTime: "16:55", endTime: "17:40" },
    { number: 11, startTime: "17:50", endTime: "18:35" },
    { number: 12, startTime: "19:20", endTime: "20:05" },
    { number: 13, startTime: "20:15", endTime: "21:00" },
    { number: 14, startTime: "21:10", endTime: "21:55" },
];

async function importPresetTimeSlots(timeSlots) {
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
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    console.log(`JS: 已选择学期索引: ${semesterIndex}`);

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses, practiceCourses, firstDayOfWeek } = result;

    // 集中实践课（军训、毕业设计等）没有星期和节次，无法排进周课表，提示手动添加。
    if (practiceCourses.length > 0) {
        const practiceList = practiceCourses
            .map((item) => {
                const teacher = item.teacher ? `（${item.teacher}）` : "";
                const weekDesc = item.weekDesc ? ` ${item.weekDesc}` : "";
                return `· ${item.name}${teacher}${weekDesc}`;
            })
            .join("\n");

        console.log("JS: 集中实践课列表:", practiceCourses);
        await window.shiguangBridgePromise.showAlert(
            "集中实践课需手动添加",
            `本学期有 ${practiceCourses.length} 门集中实践课，教务系统未给出星期和节次，无法自动导入：\n\n` +
            practiceList +
            "\n\n请按实际安排在应用内手动添加。",
            "我知道了"
        );
    }

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    await saveCourseConfigIfPossible(courses, academicYear, semesterIndex, firstDayOfWeek);

    await importPresetTimeSlots(SWU_TIME_SLOTS);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
