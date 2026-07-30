/**
 * 广东海洋大学教务适配
 * @date 2026-7-30
 * @author Mccurtain
 * @version 1.1
 */

/**
 * 解析周次字符串，处理单双周和周次范围。
 * 兼容格式："1-16周"、"6周"、"1-8周(单)"、"1-10周(双)"、"1-5周,9周"
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
        // 关键字段检查：kcmc(课名), xm(教师), cdmc(教室), xqj(星期), jcs(节次范围), zcd(周次描述)
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        // 解析节次范围，例如 "1-2" 或 "1-2节"（兼容带"节"字的情况）
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = parseInt(sectionParts[0].match(/\d+/)[0], 10);
        const endSection = parseInt(sectionParts[sectionParts.length - 1].match(/\d+/)[0], 10);

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
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

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.AndroidBridgePromise.showAlert(
        "广东海洋大学教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录广东海洋大学教务系统（jw.gdou.edu.cn）。\n本脚本将通过接口直接获取课表，无需停留在特定页面。",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    console.log("JS: 提示用户输入学年。");
    return await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入 2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    console.log("JS: 提示用户选择学期。");
    const semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
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
            AndroidBridge.showToast(`课表请求失败：HTTP ${response.status}`);
            console.error(`JS: 接口返回非 200 状态码：${response.status}`);
            return null;
        }

        const jsonText = await response.text();
        const jsonData = JSON.parse(jsonText);

        if (!jsonData || !Array.isArray(jsonData.kbList) || jsonData.kbList.length === 0) {
            AndroidBridge.showToast("未查询到课表数据，请检查学年/学期是否选择正确，或确认已登录教务系统。");
            return null;
        }

        const parsedCourses = parseJsonData(jsonData);
        if (parsedCourses.length === 0) {
            AndroidBridge.showToast("课表数据为空或解析失败，请确认所选学年学期。");
            return null;
        }

        return {
            courses: parsedCourses,
            // CourseConfigJsonModel（wiki 1.3）：所有字段可选，未提供则用默认值。
            // GDOU 各节课间隔不统一，因此用 TimeSlot 节次表达时间，此处仅设置总周数。
            config: {
                semesterStartDate: null,       // 不提供则由应用按校历校准
                semesterTotalWeeks: 20          // 本学期总周数
            }
        };
    } catch (e) {
        console.error("JS: 获取课表失败:", e);
        AndroidBridge.showToast("获取课表失败，请确认已登录教务系统且网络可访问 jw.gdou.edu.cn。");
        return null;
    }
}

async function saveCourses(parsedCourses) {
    AndroidBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        AndroidBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// 广东海洋大学上课时间（真实作息，仅供参考，可自行核对）
const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:00", endTime: "09:45" },
    { number: 3, startTime: "10:15", endTime: "11:00" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:20", endTime: "18:05" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);
    if (timeSlots.length > 0) {
        AndroidBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            AndroidBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            AndroidBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        AndroidBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        AndroidBridge.showToast("导入已取消。");
        console.log("JS: 获取学年失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        AndroidBridge.showToast("导入已取消。");
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
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        AndroidBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        AndroidBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }

    await importPresetTimeSlots(TimeSlots);

    AndroidBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    AndroidBridge.notifyTaskCompletion();
}

/**
 * 轮询等待宿主桥接对象就绪。
 * 脚本可能在宿主注入桥（AndroidBridge / AndroidBridgePromise）之前就被执行，
 * 若立即调用会导致 "Receiving end does not exist" 连接错误。此处等待桥挂载后再启动导入。
 */
function waitForBridge(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
            if (window.AndroidBridgePromise && window.AndroidBridge) {
                clearInterval(timer);
                resolve(true);
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(timer);
                reject(new Error("宿主桥接对象未就绪"));
            }
        }, 100);
    });
}

waitForBridge()
    .then(() => runImportFlow())
    .catch((e) => {
        console.error("JS: 桥接未就绪，导入未启动:", e);
        const tip = "导入失败：宿主桥接未连接。请在已登录的教务页面中，通过导入会话（app 内 webview 或测试插件）运行本脚本。";
        if (window.AndroidBridge) {
            AndroidBridge.showToast(tip);
        } else {
            alert(tip);
        }
    });
