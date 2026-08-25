// 中山大学教务系统课表导入器
// 功能：选择学年/学期 -> 获取教务系统课表 -> 转换 -> 导入时光课程表

const API_URL = "/jwxt/timetable-search/stuTimeTabPrint/studentQuery";

let ACAD_YEAR = "2026-1";


// ==================== 学年 / 学期 ====================

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(String(input).trim())) {
        return false;
    }

    return "请输入四位数字的学年！";
}

async function getAcademicYear() {
    const [defaultYear] = ACAD_YEAR.split("-");

    return await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的学年（如 2026）：",
        defaultYear || "2026",
        "validateYearInput"
    );
}

async function selectSemester() {
    if (
        !window.AndroidBridgePromise ||
        typeof window.AndroidBridgePromise.showPrompt !== "function"
    ) {
        throw new Error(
            "AndroidBridgePromise.showPrompt 不可用，请在时光课程表 App 内运行此适配器。"
        );
    }

    if (
        typeof window.AndroidBridgePromise.showSingleSelection !== "function"
    ) {
        throw new Error(
            "AndroidBridgePromise.showSingleSelection 不可用，请在时光课程表 App 内运行此适配器。"
        );
    }

    const yearSelection = await getAcademicYear();

    if (yearSelection === null) {
        return null;
    }

    const year = String(yearSelection).trim();

    const semesters = [
        "1（第一学期）",
        "2（第二学期）"
    ];

    const [, defaultSemester] = ACAD_YEAR.split("-");

    const semesterIndex =
        await window.AndroidBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesters),
            defaultSemester === "2" ? 1 : 0
        );

    if (
        semesterIndex === null ||
        semesterIndex < 0 ||
        semesterIndex >= semesters.length
    ) {
        return null;
    }

    ACAD_YEAR = `${year}-${semesterIndex + 1}`;

    return ACAD_YEAR;
}


// ==================== 时间段 ====================

const TIME_SLOTS = [
    {
        number: 1,
        startTime: "08:00",
        endTime: "08:45"
    },
    {
        number: 2,
        startTime: "08:55",
        endTime: "09:40"
    },
    {
        number: 3,
        startTime: "10:10",
        endTime: "10:55"
    },
    {
        number: 4,
        startTime: "11:05",
        endTime: "11:50"
    },
    {
        number: 5,
        startTime: "14:20",
        endTime: "15:05"
    },
    {
        number: 6,
        startTime: "15:15",
        endTime: "16:00"
    },
    {
        number: 7,
        startTime: "16:30",
        endTime: "17:15"
    },
    {
        number: 8,
        startTime: "17:25",
        endTime: "18:10"
    },
    {
        number: 9,
        startTime: "19:00",
        endTime: "19:45"
    },
    {
        number: 10,
        startTime: "19:55",
        endTime: "20:40"
    },
    {
        number: 11,
        startTime: "20:50",
        endTime: "21:35"
    }
];


// ==================== 课表配置 ====================

const CONFIG_BASE = {
    semesterTotalWeeks: 20,
    defaultClassDuration: 45,
    defaultBreakDuration: 10
};

function getSemesterStartDate() {
    const [yearText, semesterText] = ACAD_YEAR.split("-");
    const year = Number(yearText);
    const semester = Number(semesterText);

    if (!Number.isInteger(year) || !Number.isInteger(semester)) {
        throw new Error("学年学期格式错误。请重新选择学年和学期。");
    }

    // 第一学期：当年 9 月 7 日
    if (semester === 1) {
        return `${year}-09-07`;
    }

    // 第二学期：次年 3 月 2 日
    if (semester === 2) {
        return `${year + 1}-03-02`;
    }

    throw new Error("不支持的学期：" + semester);
}


// ==================== 获取课程 ====================

async function fetchCourses() {
    const response = await fetch(
        `${API_URL}?_t=${Date.now()}`,
        {
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
        }
    );

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            `API 请求失败：HTTP ${response.status}`
        );
    }

    let json;

    try {
        json = JSON.parse(responseText);
    } catch {
        throw new Error("教务系统返回的数据不是有效 JSON。");
    }

    if (json?.code !== 200) {
        throw new Error(
            `API 返回异常 code：${json?.code}`
        );
    }

    const timetable = json?.data?.timetable;

    if (
        !timetable ||
        typeof timetable !== "object" ||
        Array.isArray(timetable)
    ) {
        throw new Error(
            "教务系统返回中不存在有效的课程表数据。"
        );
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

    return {
        courses,
        timeSlots: TIME_SLOTS,
        config: {
            ...CONFIG_BASE,
            semesterStartDate: getSemesterStartDate()
        }
    };
}


// ==================== 课程转换 ====================

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

    const weeks = parseWeeks(
        item.timeDetail,
        startWeek
    );

    if (
        !name ||
        !day ||
        !startSection ||
        !endSection ||
        weeks.length === 0
    ) {
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

    // 去掉中山大学 API 返回的课程类别前缀
    // 例如：
    // 本(专必)高等数学一（I）
    // ->
    // 高等数学一（I）
    return text
        .replace(/^本\([^)]*\)/, "")
        .trim();
}


function parseWeeks(timeDetail, startWeek = 1) {
    const text = cleanText(timeDetail);

    if (!text) {
        return startWeek ? [startWeek] : [];
    }

    // 例如：
    // 1-17每周
    const rangeMatch = text.match(
        /(\d+)\s*-\s*(\d+)/
    );

    if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);

        if (
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            end >= start
        ) {
            return Array.from(
                {
                    length: end - start + 1
                },
                (_, index) => start + index
            );
        }
    }

    // 兼容：
    // 1,3,5周
    // 1、3、5周
    const numbers =
        text
            .match(/\d+/g)
            ?.map(Number)
            .filter(Number.isFinite) || [];

    if (numbers.length > 0) {
        return [
            ...new Set(numbers)
        ].sort((a, b) => a - b);
    }

    return startWeek ? [startWeek] : [];
}


function cleanText(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/\/+$/g, "")
        .trim();
}


function toNumber(value) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}


// ==================== 课程颜色 ====================

function getCourseColor(name) {
    const colorCount = 8;

    let hash = 0;

    for (let i = 0; i < name.length; i++) {
        hash =
            ((hash << 5) - hash) +
            name.charCodeAt(i);

        hash |= 0;
    }

    return Math.abs(hash) % colorCount + 1;
}


// ==================== 导入 ====================

async function runImportFlow() {
    try {
        if (
            window.AndroidBridge &&
            typeof window.AndroidBridge.showToast === "function"
        ) {
            window.AndroidBridge.showToast(
                "请选择要导入的学期..."
            );
        }

        const selectedSemester =
            await selectSemester();

        if (!selectedSemester) {
            if (
                window.AndroidBridge &&
                typeof window.AndroidBridge.showToast === "function"
            ) {
                window.AndroidBridge.showToast(
                    "已取消导入。"
                );
            }

            return;
        }

        const data = await fetchCourses();

        if (
            !data ||
            !Array.isArray(data.courses)
        ) {
            throw new Error(
                "课程数据为空或格式不正确。"
            );
        }

        // 保留给调试/适配器测试使用，
        // 不主动输出任何 console 日志。
        window.__SYSU_COURSE_JSON__ = data;
        window.__SYSU_COURSES__ = data.courses;

        if (!window.AndroidBridgePromise) {
            throw new Error(
                "AndroidBridgePromise 不可用，请在时光课程表 App 内运行此适配器。"
            );
        }

        if (
            typeof window.AndroidBridgePromise
                .saveImportedCourses !== "function"
        ) {
            throw new Error(
                "saveImportedCourses API 不可用。"
            );
        }

        if (
            typeof window.AndroidBridgePromise
                .savePresetTimeSlots !== "function"
        ) {
            throw new Error(
                "savePresetTimeSlots API 不可用。"
            );
        }

        if (
            typeof window.AndroidBridgePromise
                .saveCourseConfig !== "function"
        ) {
            throw new Error(
                "saveCourseConfig API 不可用。"
            );
        }

        if (
            window.AndroidBridge &&
            typeof window.AndroidBridge.showToast === "function"
        ) {
            window.AndroidBridge.showToast(
                `正在导入 ${data.courses.length} 条课程记录...`
            );
        }

        await window.AndroidBridgePromise
            .saveImportedCourses(
                JSON.stringify(data.courses)
            );

        await window.AndroidBridgePromise
            .savePresetTimeSlots(
                JSON.stringify(data.timeSlots)
            );

        await window.AndroidBridgePromise
            .saveCourseConfig(
                JSON.stringify(data.config)
            );

        if (
            window.AndroidBridge &&
            typeof window.AndroidBridge.showToast === "function"
        ) {
            window.AndroidBridge.showToast(
                `成功导入 ${data.courses.length} 条课程记录！`
            );
        }

        if (
            window.AndroidBridge &&
            typeof window.AndroidBridge
                .notifyTaskCompletion === "function"
        ) {
            window.AndroidBridge.notifyTaskCompletion();
        }

    } catch (error) {
        if (
            window.AndroidBridge &&
            typeof window.AndroidBridge.showToast === "function"
        ) {
            window.AndroidBridge.showToast(
                `导入失败：${error.message}`
            );
        }
    }
}


runImportFlow();