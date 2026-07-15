// 中国计量大学(cjlu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配

const COURSE_API_PATHS = [
    "/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151",
    "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151"
];

function req(url, method = "GET", body) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Accept", "*/*");
        if (method === "POST") {
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
        }
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
            } else {
                reject(new Error(`请求失败: ${xhr.status}`));
            }
        };
        xhr.onerror = function() {
            reject(new Error("网络请求失败"));
        };
        xhr.send(body || null);
    });
}

function isOnCjluJwxt() {
    return window.location.hostname === "jwxt.cjlu.edu.cn";
}

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
        const singleMatch = trimmedSet.match(/^(\d+)周?/);

        let start = 0;
        let end = 0;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
        } else {
            continue;
        }

        const isSingle = trimmedSet.includes('(单)');
        const isDouble = trimmedSet.includes('(双)');

        for (let w = start; w <= end; w++) {
            if (isSingle && w % 2 === 0) continue;
            if (isDouble && w % 2 !== 0) continue;
            weeks.push(w);
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const finalCourseList = [];

    for (const rawCourse of jsonData.kbList) {
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
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

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: (rawCourse.xm || "").trim(),
            position: (rawCourse.cdmc || "").trim(),
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
 * 构建课表配置，从课程数据中推断最大周次。
 */
function buildCourseConfig(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) {
                maxWeek = week;
            }
        }
    }
    return {
        semesterStartDate: null,
        semesterTotalWeeks: maxWeek || 20,
        firstDayOfWeek: 1
    };
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.AndroidBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录中国计量大学教务系统。",
        "好的，开始导入"
    );
}

function validateYearInput(input) {
    console.log("JS: validateYearInput 被调用，输入: " + input);
    if (/^[0-9]{4}$/.test(input)) {
        console.log("JS: validateYearInput 验证通过。");
        return false;
    }
    console.log("JS: validateYearInput 验证失败。");
    return "请输入四位数字的学年！";
}

async function getAcademicYear() {
    const defaultYear = new Date().getFullYear();
    console.log("JS: 提示用户输入学年。");
    return await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2026-2027 应输入2026）:",
        String(defaultYear),
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    console.log("JS: 提示用户选择学期。");
    return await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
}

function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 请求和解析课程数据。
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;
    let lastError = "";
    AndroidBridge.showToast("正在获取课表数据...");

    for (const url of COURSE_API_PATHS) {
        try {
            console.log(`JS: 正在请求课表接口: ${url}`);
            const jsonText = await req(url, "POST", requestBody);
            let jsonData;
            try {
                jsonData = JSON.parse(jsonText);
            } catch (parseError) {
                lastError = `${url} 返回内容不是 JSON`;
                console.warn(`JS: ${lastError}`, parseError);
                continue;
            }

            const parsedCourses = parseJsonData(jsonData);
            if (parsedCourses.length === 0) {
                lastError = `${url} 未返回有效课程`;
                console.warn(`JS: ${lastError}`);
                continue;
            }

            return {
                courses: parsedCourses,
                config: buildCourseConfig(parsedCourses)
            };
        } catch (error) {
            lastError = `${url} ${error.message}`;
            console.error(`JS: 课表接口异常: ${url}`, error);
        }
    }

    AndroidBridge.showToast("未能获取课表数据，请检查登录状态或学年学期。");
    await window.AndroidBridgePromise.showAlert(
        "导入失败",
        `未能获取课表数据。已使用同源相对路径尝试 /kbcx 和 /jwglxt/kbcx 接口。\n最后错误：${lastError || "未知错误"}`,
        "确定"
    );
    return null;
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

// 中国计量大学作息时间表
const TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "13:30", endTime: "14:15" },
    { number: 7, startTime: "14:20", endTime: "15:05" },
    { number: 8, startTime: "15:15", endTime: "16:00" },
    { number: 9, startTime: "16:05", endTime: "16:50" },
    { number: 10, startTime: "18:00", endTime: "18:45" },
    { number: 11, startTime: "18:50", endTime: "19:35" },
    { number: 12, startTime: "19:40", endTime: "20:25" },
    { number: 13, startTime: "20:35", endTime: "21:20" }
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        AndroidBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            AndroidBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            AndroidBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        return;
    }

    if (!isOnCjluJwxt()) {
        const msg = "当前页面不在中国计量大学教务系统域名内，请先打开并登录 https://jwxt.cjlu.edu.cn/jwglxt/ 后再导入。";
        AndroidBridge.showToast("请先进入中国计量大学教务系统。");
        await window.AndroidBridgePromise.showAlert("导入失败", msg, "确定");
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

runImportFlow();
