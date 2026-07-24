// 青岛理工大学 - 正方教务系统 课程表适配脚本

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(zcd) {
    if (!zcd) return [];

    var weekSets = zcd.split(',');
    var weeks = [];

    for (var i = 0; i < weekSets.length; i++) {
        var trimmedSet = weekSets[i].trim();

        var rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        var singleMatch = trimmedSet.match(/^(\d+)周/);

        var start = 0;
        var end = 0;
        var processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed) {
            var isSingle = trimmedSet.indexOf('(单)') !== -1;
            var isDouble = trimmedSet.indexOf('(双)') !== -1;

            for (var w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    var uniqueWeeks = [];
    var seen = {};
    for (var j = 0; j < weeks.length; j++) {
        if (!seen[weeks[j]]) {
            seen[weeks[j]] = true;
            uniqueWeeks.push(weeks[j]);
        }
    }
    uniqueWeeks.sort(function(a, b) { return a - b; });
    return uniqueWeeks;
}

/**
 * 清洗课程名称中的特殊字符
 */
function cleanCourseName(name) {
    return name.replace(/[★○●◇◆]/g, '').trim();
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

    var rawCourseList = jsonData.kbList;
    var finalCourseList = [];

    for (var i = 0; i < rawCourseList.length; i++) {
        var rawCourse = rawCourseList[i];
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        var weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        var sectionParts = rawCourse.jcs.split('-');
        var startSection = Number(sectionParts[0]);
        var endSection = Number(sectionParts[sectionParts.length - 1]);
        var day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        finalCourseList.push({
            name: cleanCourseName(rawCourse.kcmc),
            teacher: (rawCourse.xm || "").trim(),
            position: (rawCourse.cdmc || "未排地点").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    finalCourseList.sort(function(a, b) {
        return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });

    console.log("JS: JSON 数据解析完成，共找到 " + finalCourseList.length + " 门课程。");
    return finalCourseList;
}

/**
 * 构建课表配置，从课程数据中推断最大周次。
 */
function buildCourseConfig(courses) {
    var maxWeek = 0;
    for (var i = 0; i < courses.length; i++) {
        var course = courses[i];
        for (var j = 0; j < course.weeks.length; j++) {
            if (course.weeks[j] > maxWeek) {
                maxWeek = course.weeks[j];
            }
        }
    }
    return {
        semesterTotalWeeks: maxWeek || 20,
        firstDayOfWeek: 1
    };
}

/**
 * 检查是否在登录页面。
 */
function isLoginPage() {
    var url = window.location.href;
    var loginUrl = "http://jxgl.qut.edu.cn/jwglxt/xtgl/login_slogin.html";
    return url === loginUrl;
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

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.AndroidBridgePromise.showAlert(
        "青岛理工大学课表导入",
        "将从正方教务系统导入课程表。\n请确保已在教务系统中登录。",
        "开始导入"
    );
}

async function getAcademicYear() {
    var currentYear = new Date().getFullYear().toString();
    console.log("JS: 提示用户输入学年。");
    return await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2026-2027 应输入2026）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    var semesters = ["第一学期", "第二学期"];
    console.log("JS: 提示用户选择学期。");
    var semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 请求和解析课程数据。
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    AndroidBridge.showToast("正在获取课表数据...");

    var semesterCode = getSemesterCode(semesterIndex);
    var requestBody = "xnm=" + encodeURIComponent(academicYear) +
                      "&xqm=" + encodeURIComponent(semesterCode) +
                      "&kzlx=ck&xsdm=&kclbdm=&kclxdm=";
    var url = "http://jxgl.qut.edu.cn/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508";
    var refererUrl = "http://jxgl.qut.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default";

    console.log("JS: 发送请求到 " + url + ", body: " + requestBody);

    var requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": refererUrl
        },
        "body": requestBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        var response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error("网络请求失败。状态码: " + response.status + " (" + response.statusText + ")");
        }

        var jsonText = await response.text();

        var jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error('JS: JSON 解析失败，可能是会话过期:', e);
            AndroidBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        if (jsonText.indexOf("登录") !== -1 && jsonText.indexOf("密码") !== -1) {
            AndroidBridge.showToast("未登录或登录已过期，请先登录教务系统");
            return null;
        }

        var courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            AndroidBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log("JS: 课程数据解析成功，共找到 " + courses.length + " 门课程。");

        var config = buildCourseConfig(courses);

        return { courses: courses, config: config };

    } catch (error) {
        AndroidBridge.showToast("请求或解析失败: " + error.message);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    AndroidBridge.showToast("正在保存 " + parsedCourses.length + " 门课程...");
    console.log("JS: 尝试保存 " + parsedCourses.length + " 门课程...");
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        AndroidBridge.showToast("课程保存失败: " + error.message);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// 青岛理工大学统一作息时间
var TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:55", endTime: "16:40" },
    { number: 9, startTime: "16:45", endTime: "17:30" },
    { number: 10, startTime: "19:00", endTime: "19:45" }
];

async function importPresetTimeSlots(timeSlots) {
    console.log("JS: 准备导入 " + timeSlots.length + " 个预设时间段。");

    if (timeSlots.length > 0) {
        AndroidBridge.showToast("正在导入 " + timeSlots.length + " 个预设时间段...");
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
    if (isLoginPage()) {
        AndroidBridge.showToast("导入失败：请先登录教务系统！");
        console.log("JS: 检测到当前在登录页面，终止导入。");
        return;
    }

    AndroidBridge.showToast("拾光课程表 - 青岛理工大学适配");

    var alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    var academicYear = await getAcademicYear();
    if (academicYear === null) {
        AndroidBridge.showToast("导入已取消。");
        console.log("JS: 获取学年失败/取消，流程终止。");
        return;
    }
    console.log("JS: 已选择学年: " + academicYear);

    var semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        AndroidBridge.showToast("导入已取消。");
        console.log("JS: 选择学期失败/取消，流程终止。");
        return;
    }
    console.log("JS: 已选择学期索引: " + semesterIndex);

    var result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    var courses = result.courses;
    var config = result.config;

    var saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    try {
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        AndroidBridge.showToast("课表配置更新成功！总周数：" + config.semesterTotalWeeks + "周。");
    } catch (error) {
        AndroidBridge.showToast("课表配置保存失败: " + error.message);
        console.error('JS: Save Config Error:', error);
    }

    await importPresetTimeSlots(TimeSlots);

    AndroidBridge.showToast("成功导入 " + courses.length + " 门课程！");
    console.log("JS: 整个导入流程执行完毕并成功。");
    AndroidBridge.notifyTaskCompletion();
}

runImportFlow();
