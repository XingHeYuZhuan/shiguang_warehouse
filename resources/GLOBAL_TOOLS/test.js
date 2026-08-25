// 中山大学教务系统课表导入器
// 功能：获取教务系统课表 -> 转换为目标数据 -> 通过 AndroidBridge 导入

const API_URL = "/jwxt/timetable-search/stuTimeTabPrint/studentQuery";
let ACAD_YEAR = "2026-1";

const AVAILABLE_YEARS = Array.from({ length: 20 }, (_, index) => 2026 + index);
const AVAILABLE_SEMESTERS = [1, 2];

// 中山大学各学期实际开课日期。
// 日期以中山大学官方校历为准；尚未公布的学期暂不填写，避免错误导入。
const SEMESTER_START_DATES = {};

function validateAcademicYear(input) {
    const year = String(input).trim();
    if (/^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2100) {
        return false;
    }
    return "请输入四位数字的学年。";
}

async function selectSemester() {
    if (!window.AndroidBridgePromise || typeof window.AndroidBridgePromise.showPrompt !== "function") {
        throw new Error("AndroidBridgePromise.showPrompt 不可用，请在时光课程表 App 内运行此适配器。");
    }

    const [defaultYear, defaultSemester] = ACAD_YEAR.split("-");

    const yearInput = await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入学年，例如：2026",
        defaultYear || "2026",
        "validateAcademicYear"
    );

    if (yearInput === null) {
        return null;
    }

    const year = String(yearInput).trim();

    if (typeof window.AndroidBridgePromise.showSingleSelection !== "function") {
        throw new Error("AndroidBridgePromise.showSingleSelection 不可用，请在时光课程表 App 内运行此适配器。");
    }

    const semesters = ["1（第一学期）", "2（第二学期）"];
    const defaultSemesterIndex = defaultSemester === "2" ? 1 : 0;

    const semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        defaultSemesterIndex
    );

    if (semesterIndex === null || semesterIndex < 0 || semesterIndex >= semesters.length) {
        return null;
    }

    ACAD_YEAR = `${year}-${semesterIndex + 1}`;
    return ACAD_YEAR;
}

// 目标课表时间段
const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:20", endTime: "15:05" },
    { number: 6, startTime: "15:15", endTime: "16:00" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
    { number: 11, startTime: "20:50", endTime: "21:35" }
];

// 课表配置（学期开始日期需要根据所选学期调整）
const CONFIG_BASE = {
    semesterTotalWeeks: 20,
    defaultClassDuration: 45,
    defaultBreakDuration: 10
};

function getSemesterStartDate() {
    const [yearText, semesterText] = ACAD_YEAR.split("-");
    const year = Number(yearText);
    const semester = Number(semesterText);

    const configuredDate = SEMESTER_START_DATES[ACAD_YEAR];
    if (configuredDate) {
        return configuredDate;
    }

    if (!Number.isInteger(year) || ![1, 2].includes(semester)) {
        throw new Error(`无效的学期：${ACAD_YEAR}`);
    }

    // 默认日期：第一学期 9 月 1 日，第二学期次年 3 月 20 日。
    // 如果之后取得中山大学官方校历，可在 SEMESTER_START_DATES 中覆盖具体学期。
    if (semester === 1) {
        return `${year}-09-01`;
    }

    return `${year + 1}-03-20`;
}

function buildCourseConfig() {
    return {
        semesterStartDate: getSemesterStartDate(),
        ...CONFIG_BASE
    };
}

async function fetchCourses() {
    console.log("========================================");
    console.log("开始请求中山大学教务系统 API...");
    console.log("API:", API_URL);
    console.log("学期:", ACAD_YEAR);
    console.log("========================================");

    const response = await fetch(`${API_URL}?_t=${Date.now()}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
            acadYear: ACAD_YEAR,
            submitFlag: "1",
            nothroughCourseFlag: "1"
        })
    });

    console.log("HTTP 状态码:", response.status);

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(`API 请求失败：HTTP ${response.status}\n${responseText}`);
    }

    let json;
    try {
        json = JSON.parse(responseText);
    } catch (error) {
        console.error("响应不是合法 JSON：", error);
        console.error("原始响应：", responseText);
        return [];
    }

    if (json?.code !== 200) {
        throw new Error(`API 返回异常 code：${json?.code}`);
    }

    const timetable = json?.data?.timetable;

    if (!timetable || typeof timetable !== "object" || Array.isArray(timetable)) {
        throw new Error("API 返回中不存在有效的 data.timetable");
    }

    const courses = [];

    for (const entries of Object.values(timetable)) {
        if (!Array.isArray(entries) || entries.length === 0) {
            continue;
        }

        for (const item of entries) {
            const course = normalizeCourse(item);
            if (course) {
                courses.push(course);
            }
        }
    }

    const result = {
        courses,
        timeSlots: TIME_SLOTS,
        config: buildCourseConfig()
    };

    console.log("========================================");
    console.log(`课程转换完成，共 ${courses.length} 条记录`);
    console.log("最终 JSON：");
    console.log(result);
    console.table(courses);
    console.log("========================================");

    return result;
}

function normalizeCourse(item) {
    if (!item || typeof item !== "object") {
        return null;
    }

    const name = cleanCourseName(item.courseName);
    const teacher = cleanText(item.teachingStaffName);
    const position = cleanText(item.classPlace);
    const day = toNumber(item.week);
    const startSection = toNumber(item.startClassTimes);
    const endSection = toNumber(item.endClassTimes);
    const startWeek = toNumber(item.startWeek);
    const weeks = parseWeeks(item.timeDetail, startWeek);

    if (!name || !day || !startSection || !endSection || weeks.length === 0) {
        console.warn("跳过字段不完整的课程记录：", item);
        return null;
    }

    return {
        id: crypto.randomUUID(),
        name,
        teacher,
        position,
        day,
        startSection,
        endSection,
        color: getCourseColor(name),
        weeks
    };
}

function cleanCourseName(value) {
    const text = cleanText(value);

    // 去掉中山大学 API 返回的课程类别前缀：
    // "本(专必)高等数学一（I）" -> "高等数学一（I）"
    // "本(公必)劳动教育" -> "劳动教育"
    return text.replace(/^本\([^)]*\)/, "").trim();
}

function parseWeeks(timeDetail, startWeek = 1) {
    const text = cleanText(timeDetail);

    if (!text) {
        return startWeek ? [startWeek] : [];
    }

    // 例如："1-17每周"
    const rangeMatch = text.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);

        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            return Array.from(
                { length: end - start + 1 },
                (_, index) => start + index
            );
        }
    }

    // 兼容单双周或离散周次，例如："1,3,5周"、"1、3、5周"
    const numbers = text
        .match(/\d+/g)
        ?.map(Number)
        .filter(Number.isFinite) || [];

    if (numbers.length > 0) {
        return [...new Set(numbers)].sort((a, b) => a - b);
    }

    return startWeek ? [startWeek] : [];
}

function cleanText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/\/+$/g, "")
        .trim();
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

// 根据课程名称生成稳定的颜色编号，避免同一课程每次导出颜色变化。
function getCourseColor(name) {
    const colorCount = 8;
    let hash = 0;

    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash |= 0;
    }

    return Math.abs(hash) % colorCount + 1;
}

async function runImportFlow() {
    try {
        if (!window.AndroidBridgePromise || typeof window.AndroidBridgePromise.showAlert !== "function") {
            throw new Error("AndroidBridgePromise.showAlert 不可用，请在时光课程表 App 内运行此适配器。");
        }

        if (!confirmed) {
            if (window.AndroidBridge && typeof window.AndroidBridge.showToast === "function") {
                window.AndroidBridge.showToast("已取消导入。");
            }
            return;
        }

        const selectedSemester = await selectSemester();
        if (!selectedSemester) {
            if (window.AndroidBridge && typeof window.AndroidBridge.showToast === "function") {
                window.AndroidBridge.showToast("已取消导入。");
            }
            return;
        }

        console.log(`已选择学期：${ACAD_YEAR}`);
        console.log(`学期实际开课日期：${getSemesterStartDate()}`);

        const data = await fetchCourses();
        if (!data || !Array.isArray(data.courses)) {
            throw new Error("课程数据为空或格式不正确。");
        }

        window.__SYSU_COURSE_JSON__ = data;
        window.__SYSU_COURSES__ = data.courses;

        console.log("window.__SYSU_COURSE_JSON__ 已更新。");
        console.log("准备通过 AndroidBridgePromise 向应用提交数据。");

        if (!window.AndroidBridgePromise) {
            throw new Error("AndroidBridgePromise 不可用，请在时光课程表 App 内运行此适配器。");
        }

        if (typeof window.AndroidBridgePromise.saveImportedCourses !== "function") {
            throw new Error("saveImportedCourses API 不可用。");
        }
        if (typeof window.AndroidBridgePromise.savePresetTimeSlots !== "function") {
            throw new Error("savePresetTimeSlots API 不可用。");
        }
        if (typeof window.AndroidBridgePromise.saveCourseConfig !== "function") {
            throw new Error("saveCourseConfig API 不可用。");
        }

        if (window.AndroidBridge && typeof window.AndroidBridge.showToast === "function") {
            window.AndroidBridge.showToast(`正在导入 ${data.courses.length} 条课程记录...`);
        }

        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(data.courses));
        console.log("课程数据提交成功。");

        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(data.timeSlots));
        console.log("时间段数据提交成功。");

        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(data.config));
        console.log("课表配置提交成功。");

        if (window.AndroidBridge && typeof window.AndroidBridge.showToast === "function") {
            window.AndroidBridge.showToast(`成功导入 ${data.courses.length} 条课程记录！`);
        }

        if (window.AndroidBridge && typeof window.AndroidBridge.notifyTaskCompletion === "function") {
            window.AndroidBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error("========================================");
        console.error("中山大学课表导入失败：", error);
        console.error(error.stack);
        console.error("========================================");

        if (window.AndroidBridge && typeof window.AndroidBridge.showToast === "function") {
            window.AndroidBridge.showToast(`导入失败：${error.message}`);
        }
    }
}

runImportFlow();
