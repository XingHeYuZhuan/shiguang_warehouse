// 济宁医学院教务（乘方教务 · 旧版 .action 接口）适配器

const PRESET_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:40" },
    { number: 2, startTime: "08:50", endTime: "09:30" },
    { number: 3, startTime: "09:50", endTime: "10:30" },
    { number: 4, startTime: "10:40", endTime: "11:20" },
    { number: 5, startTime: "11:30", endTime: "12:10" },
    { number: 6, startTime: "14:30", endTime: "15:10" },
    { number: 7, startTime: "15:20", endTime: "16:00" },
    { number: 8, startTime: "16:20", endTime: "17:00" },
    { number: 9, startTime: "17:10", endTime: "17:50" },
    { number: 10, startTime: "18:00", endTime: "18:40" },
    { number: 11, startTime: "19:30", endTime: "20:10" },
    { number: 12, startTime: "20:20", endTime: "21:00" }
];

// 周次字符串 "10,7,8,9" → 去重排序的周数组
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = weekStr.split(",").map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w) && w > 0);
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 教室可能为空、含 "\\" 分隔的多教室（如 "B205\206教室"）或以 "," 分隔的多场地
function resolvePosition(raw) {
    const position = String(raw || "").replace(/\\/g, "/").trim();
    return position || "待定";
}

// kbxx 课程 JSON → 拾光课程格式（合并同 key 课程的周次）
function parseCourseList(kbxx) {
    if (!Array.isArray(kbxx)) throw new Error("课表接口返回格式不正确");
    const courseMap = new Map();
    kbxx.forEach(item => {
        const day = parseInt(item.xq, 10);
        const sections = String(item.jcdm2 || "").split(",")
            .map(s => parseInt(s.trim(), 10)).filter(s => !isNaN(s));
        const allWeeks = parseWeeks(item.zcs);
        if (!item.kcmc || sections.length === 0 || allWeeks.length === 0 || isNaN(day) || day < 1 || day > 7) return;

        const course = {
            name: item.kcmc.trim(),
            teacher: String(item.teaxms || "").trim() || "未知",
            position: resolvePosition(item.jxcdmcs),
            day,
            startSection: Math.min(...sections),
            endSection: Math.max(...sections),
            weeks: allWeeks
        };

        const key = [course.name, course.teacher, course.position, course.day,
            course.startSection, course.endSection].join("__");
        const existing = courseMap.get(key);
        if (existing) existing.weeks = [...new Set([...existing.weeks, ...course.weeks])].sort((a, b) => a - b);
        else courseMap.set(key, course);
    });
    return Array.from(courseMap.values()).sort((a, b) =>
        a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection || a.name.localeCompare(b.name)
    );
}

// 读取课表页中的学期下拉框
function extractSemesterOptions(doc) {
    const selectElem = doc.getElementById("xnxqdm");
    if (!selectElem) return null;
    const semesters = [];
    const semesterValues = [];
    let defaultIndex = 0;
    Array.from(selectElem.querySelectorAll("option")).forEach(option => {
        if (!option.value) return;
        semesters.push(option.innerText.trim());
        semesterValues.push(option.value);
        if (option.selected || option.hasAttribute("selected")) defaultIndex = semesters.length - 1;
    });
    if (semesters.length === 0) return null;

    const start = Math.max(0, defaultIndex - 1);
    const end = Math.min(semesters.length, defaultIndex + 10);
    return {
        semesters: semesters.slice(start, end),
        semesterValues: semesterValues.slice(start, end),
        defaultIndex: defaultIndex - start
    };
}

// 导入前提示先登录教务系统
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "济宁医学院教务导入",
        "请先确保已登录教务系统，再继续导入。",
        "我已登录"
    );
}

// 选择学期
async function selectSemester(semesterOptions) {
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.semesters),
        semesterOptions.defaultIndex
    );
    if (selectedIndex === null || selectedIndex < 0) return null;
    return {
        label: semesterOptions.semesters[selectedIndex],
        value: semesterOptions.semesterValues[selectedIndex]
    };
}

// 拉取课表页 HTML（含学期列表）
async function fetchSchedulePage() {
    const response = await fetch("/xsgrkbcx!getXsgrbkList.action", { method: "GET", credentials: "include" });
    if (!response.ok) throw new Error(`无法打开课表页面（HTTP ${response.status}）`);
    return response.text();
}

// 拉取指定学期课表（HTML 内嵌 var kbxx=[...]）
async function fetchCourseData(xnxqdm) {
    const response = await fetch(
        `/xsgrkbcx!xsAllKbList.action?xnxqdm=${encodeURIComponent(xnxqdm)}`,
        { method: "GET", credentials: "include" }
    );
    if (!response.ok) throw new Error(`课表请求失败（HTTP ${response.status}）`);
    const htmlText = await response.text();
    const match = htmlText.match(/var\s+kbxx\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) throw new Error("课表数据解析失败，请检查登录状态");
    let kbxx;
    try {
        kbxx = JSON.parse(match[1]);
    } catch (error) {
        throw new Error(`课表数据解析失败：${error.message}`);
    }
    return kbxx;
}

// 主流程：提示 → 选学期 → 拉课表 → 保存课程与作息
async function runImportFlow() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) { window.shiguangBridge.showToast("导入已取消"); return; }

        const pageHtml = await fetchSchedulePage();
        const semesterOptions = extractSemesterOptions(new DOMParser().parseFromString(pageHtml, "text/html"));
        if (!semesterOptions) throw new Error("未找到学期列表，请先登录教务系统");

        const semester = await selectSemester(semesterOptions);
        if (!semester) { window.shiguangBridge.showToast("导入已取消"); return; }

        window.shiguangBridge.showToast(`正在获取 ${semester.label} 的课表...`);
        const courses = parseCourseList(await fetchCourseData(semester.value));

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "提示",
                "该学期没有获取到课程数据，请检查登录状态和所选学期。",
                "确定"
            );
            return;
        }

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(PRESET_TIME_SLOTS));
        } catch (error) {
            window.shiguangBridge.showToast(`课程已导入，作息时间导入失败：${error.message}`);
        }

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            error.message || String(error),
            "确定"
        );
    }
}

runImportFlow();
