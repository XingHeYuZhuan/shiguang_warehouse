// 中山大学教务系统课表导入器
// 功能：获取教务系统课表 -> 转换为目标 JSON -> 自动下载

const API_URL = "/jwxt/timetable-search/stuTimeTabPrint/studentQuery";
let ACAD_YEAR = "2026-1";

const AVAILABLE_YEARS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037, 2038, 2039, 2040, 2041, 2042, 2043, 2044, 2045, 2046, 2047, 2048, 2049, 2050, 2051, 2052, 2053, 2054, 2055, 2056, 2057, 2058, 2059, 2060,2061, 2062, 2063, 2064, 2065, 2066, 2067, 2068, 2069, 2070, 2071, 2072, 2073, 2074, 2075, 2076, 2077, 2078, 2079, 2080, 2081, 2082, 2083, 2084, 2085, 2086, 2087, 2088, 2089, 2090, 2091, 2092, 2093, 2094, 2095, 2096, 2097, 2098, 2099];
const AVAILABLE_SEMESTERS = [1, 2];

function selectSemester() {
    return new Promise(resolve => {
        const existing = document.getElementById("sysu-semester-selector");
        if (existing) {
            existing.remove();
        }

        const overlay = document.createElement("div");
        overlay.id = "sysu-semester-selector";
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.45);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            width: 360px;
            padding: 24px;
            border-radius: 16px;
            background: #fff;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
            color: #222;
        `;

        const title = document.createElement("div");
        title.textContent = "选择学期";
        title.style.cssText = "font-size: 20px; font-weight: 600; margin-bottom: 20px; text-align: center;";

        const subtitle = document.createElement("div");
        subtitle.textContent = "选择后将自动请求对应学期课表并生成 JSON";
        subtitle.style.cssText = "font-size: 13px; color: #777; margin-bottom: 18px; text-align: center;";

        const selectors = document.createElement("div");
        selectors.style.cssText = "display: flex; gap: 12px; justify-content: center; align-items: center;";

        const yearSelect = document.createElement("select");
        yearSelect.setAttribute("aria-label", "学年");
        yearSelect.style.cssText = `
            width: 130px;
            height: 44px;
            padding: 0 12px;
            border: 1px solid #ccc;
            border-radius: 8px;
            font-size: 16px;
            background: #fff;
        `;

        AVAILABLE_YEARS.forEach(year => {
            const option = document.createElement("option");
            option.value = String(year);
            option.textContent = `${year} 年`;
            yearSelect.appendChild(option);
        });

        const semesterSelect = document.createElement("select");
        semesterSelect.setAttribute("aria-label", "学期");
        semesterSelect.style.cssText = `
            width: 110px;
            height: 44px;
            padding: 0 12px;
            border: 1px solid #ccc;
            border-radius: 8px;
            font-size: 16px;
            background: #fff;
        `;

        AVAILABLE_SEMESTERS.forEach(semester => {
            const option = document.createElement("option");
            option.value = String(semester);
            option.textContent = `第 ${semester} 学期`;
            semesterSelect.appendChild(option);
        });

        const [defaultYear, defaultSemester] = ACAD_YEAR.split("-").map(Number);
        if (AVAILABLE_YEARS.includes(defaultYear)) {
            yearSelect.value = String(defaultYear);
        }
        if (AVAILABLE_SEMESTERS.includes(defaultSemester)) {
            semesterSelect.value = String(defaultSemester);
        }

        selectors.appendChild(yearSelect);
        selectors.appendChild(semesterSelect);

        const preview = document.createElement("div");
        preview.style.cssText = "margin-top: 16px; text-align: center; font-size: 14px; color: #555;";

        const updatePreview = () => {
            preview.textContent = `将请求：${yearSelect.value}-${semesterSelect.value}`;
        };
        yearSelect.addEventListener("change", updatePreview);
        semesterSelect.addEventListener("change", updatePreview);
        updatePreview();

        const buttons = document.createElement("div");
        buttons.style.cssText = "display: flex; gap: 10px; margin-top: 22px;";

        const cancelButton = document.createElement("button");
        cancelButton.textContent = "取消";
        cancelButton.style.cssText = `
            flex: 1;
            height: 42px;
            border: 1px solid #ccc;
            border-radius: 8px;
            background: #fff;
            cursor: pointer;
            font-size: 15px;
        `;

        const confirmButton = document.createElement("button");
        confirmButton.textContent = "获取课表并下载";
        confirmButton.style.cssText = `
            flex: 1.5;
            height: 42px;
            border: 0;
            border-radius: 8px;
            background: #1677ff;
            color: #fff;
            cursor: pointer;
            font-size: 15px;
        `;

        cancelButton.onclick = () => {
            overlay.remove();
            resolve(null);
        };

        confirmButton.onclick = () => {
            const year = Number(yearSelect.value);
            const semester = Number(semesterSelect.value);
            ACAD_YEAR = `${year}-${semester}`;
            overlay.remove();
            resolve(ACAD_YEAR);
        };

        buttons.appendChild(cancelButton);
        buttons.appendChild(confirmButton);

        panel.appendChild(title);
        panel.appendChild(subtitle);
        panel.appendChild(selectors);
        panel.appendChild(preview);
        panel.appendChild(buttons);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    });
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

// 2026-1 学期配置
const CONFIG = {
    semesterStartDate: "2026-03-02",
    semesterTotalWeeks: 20,
    defaultClassDuration: 45,
    defaultBreakDuration: 10
};

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
        config: CONFIG
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

function downloadCoursesJson(data) {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], {
        type: "application/json;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `sysu-${ACAD_YEAR}.json`;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log("========================================");
    console.log(`JSON 下载完成：sysu-${ACAD_YEAR}.json`);
    console.log(`课程数量：${data.courses.length}`);
    console.log(`时间段数量：${data.timeSlots.length}`);
    console.log(`学期总周数：${data.config.semesterTotalWeeks}`);
    console.log("========================================");
}

selectSemester()
    .then(selectedSemester => {
        if (!selectedSemester) {
            console.log("用户取消了学期选择，未请求课表。");
            return null;
        }

        console.log(`已选择学期：${ACAD_YEAR}`);
        return fetchCourses();
    })
    .then(data => {
        if (!data) {
            return;
        }

        // 暴露最终 JSON，方便控制台检查。
        window.__SYSU_COURSE_JSON__ = data;
        window.__SYSU_COURSES__ = data.courses;

        console.log("window.__SYSU_COURSE_JSON__ 已更新。");
        console.log("可以执行 JSON.stringify(window.__SYSU_COURSE_JSON__, null, 2) 查看完整 JSON。");

        if (data.courses.length > 0) {
            downloadCoursesJson(data);
        } else {
            console.warn("没有可下载的课程数据，因此未生成 JSON 文件。");
        }
    })
    .catch(error => {
        console.error("========================================");
        console.error("中山大学课表获取失败：", error);
        console.error(error.stack);
        console.error("========================================");
    });
