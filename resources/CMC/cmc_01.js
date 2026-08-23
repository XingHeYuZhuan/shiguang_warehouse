// 成都医学院教务（乘方教务）适配器
// 流程：选一次学期（课表与考试共用）→ 导入课表 → 询问是否导入考试 → 合并保存
// 接口：
//   GET  /new/student/xsgrkb/week.page            课表页（学期下拉 + 作息表）
//   POST /new/student/xsgrkb/getCalendarWeekDatas  整学期课程数据
//   POST /new/student/xsksrw/paginateXsksrw        学生考试任务

// 周次字符串
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = weekStr.split(",").map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w) && w > 0);
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析按周场地字符串
function parseVenueWeeks(jxcdmc2) {
    const venueMap = new Map();
    let lastRoom = null;
    String(jxcdmc2 || "").split(",").forEach(part => {
        const match = part.trim().match(/^(.*?)-(\d+)$/);
        if (!match) return;
        const room = match[1].trim();
        const week = parseInt(match[2], 10);
        if (room) lastRoom = room;
        if (!lastRoom || isNaN(week)) return;
        if (!venueMap.has(lastRoom)) venueMap.set(lastRoom, []);
        venueMap.get(lastRoom).push(week);
    });
    return venueMap;
}

// 课程地点
function resolvePosition(item) {
    const primary = String(item.jxcdmc || "").trim();
    if (primary) return primary;
    if (String(item.bapjxcd || "") === "1") return "不用场地";
    return "待定";
}

function cleanTeacherName(raw) {
    return String(raw || "").replace(/\[[^\]]*\]/g, "").trim();
}

// 课表接口数据
function parseCourseList(apiJson, slotMap) {
    if (!apiJson) throw new Error("课表接口无响应");
    if (apiJson.code !== 0) {
        const message = String(apiJson.message || "").trim();
        throw new Error(message || `课表接口返回错误（code=${apiJson.code}）`);
    }
    if (!Array.isArray(apiJson.data)) throw new Error("课表接口返回格式不正确");

    const courseMap = new Map();
    apiJson.data.forEach(item => {
        const day = parseInt(item.xq, 10);
        const startSection = parseInt(item.ps, 10);
        const endSection = parseInt(item.pe, 10);
        const allWeeks = parseWeeks(item.zc);
        if (!item.kcmc || !allWeeks.length || isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) return;

        const teacher = cleanTeacherName(item.teaxms || item.pkr) || "未知";
        const venues = parseVenueWeeks(item.jxcdmc2);
        const venueEntries = venues.size > 0
            ? Array.from(venues.entries(), ([position, weeks]) => ({ position, weeks: [...new Set(weeks)].sort((a, b) => a - b) }))
            : [{ position: resolvePosition(item), weeks: allWeeks }];

        venueEntries.forEach(({ position, weeks }) => {
            const course = { name: item.kcmc.trim(), teacher, position, day, startSection, endSection, weeks };

            const actualStart = String(item.qssj || "").slice(0, 5);
            const actualEnd = String(item.jssj || "").slice(0, 5);
            const expectedStart = slotMap[startSection] && slotMap[startSection].start;
            const expectedEnd = slotMap[endSection] && slotMap[endSection].end;
            if (actualStart && actualEnd && (actualStart !== expectedStart || actualEnd !== expectedEnd)) {
                course.isCustomTime = true;
                course.customStartTime = actualStart;
                course.customEndTime = actualEnd;
            }
            
            const key = [course.name, teacher, position, day,
                course.isCustomTime ? actualStart + actualEnd : `${startSection}-${endSection}`, weeks.join(",")].join("__");
            if (!courseMap.has(key)) courseMap.set(key, course);
        });
    });

    return Array.from(courseMap.values()).sort((a, b) =>
        a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection || a.name.localeCompare(b.name)
    );
}

// 考试安排数据
function parseExamList(rows, slots) {
    const exams = [];
    rows.forEach(item => {
        const day = parseInt(item.xq, 10);
        const week = parseInt(item.zc, 10);
        const [startTime, endTime] = String(item.kssj || "").split("--").map(part => part.trim().slice(0, 5));
        const validTime = startTime && endTime && /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime);
        if (!item.kcmc || isNaN(day) || day < 1 || day > 7 || isNaN(week) || week < 1 || !validTime) return;

        const examType = String(item.kslbmc || "").trim().replace(/考试$/, "");
        const exam = {
            name: `${item.kcmc.trim()}${examType ? `(${examType})` : ""}`,
            teacher: "",
            position: String(item.kscdmc || "").trim() || "待定",
            day,
            weeks: [week]
        };
        const matched = slots && slots.find(s => s.startTime === startTime && s.endTime === endTime);
        if (matched) {
            exam.startSection = exam.endSection = matched.number;
        } else {
            exam.isCustomTime = true;
            exam.customStartTime = startTime;
            exam.customEndTime = endTime;
        }
        exams.push(exam);
    });
    return exams;
}

// 从 week.page 源码提取作息表
function parseBusinessHoursFromHtml(htmlText) {
    const match = htmlText.match(/var\s+businessHours\s*=\s*\$\.parseJSON\('(\[.*?\])'\);/);
    const slots = [];
    const map = {};
    if (match) {
        JSON.parse(match[1]).forEach(item => {
            const number = parseInt(item.jcdm, 10);
            const startTime = String(item.qssj || "").slice(0, 5);
            const endTime = String(item.jssj || "").slice(0, 5);
            if (isNaN(number) || !startTime || !endTime) return;
            slots.push({ number, startTime, endTime });
            map[number] = { start: startTime, end: endTime };
        });
        slots.sort((a, b) => a.number - b.number);
    }
    return { slots, map };
}

// 插入午间段期中考试时间
function withLunchSlot(slots) {
    return slots
        .map(s => s.number >= 6 ? { ...s, number: s.number + 1 } : s)
        .concat([{ number: 6, startTime: "12:15", endTime: "14:15" }])
        .sort((a, b) => a.number - b.number);
}

// 读取页面中的学期下拉框
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

// 导入前提示用户先登录教务系统
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "成都医学院教务导入",
        "请先确保已登录教务系统，再继续导入。",
        "我已登录"
    );
}

// 从页面已有学期中选择目标学期
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

// 询问是否同时导入考试
async function askImportExams() {
    const bridge = window.shiguangBridgePromise;
    if (!bridge || typeof bridge.showAlert !== "function") return true;
    return await bridge.showAlert(
        "导入考试安排",
        "是否同时导入本学期的考试安排？\n（期中/期末/补考将显示在课表对应日期）",
        "确定导入"
    );
}

// 获取课表页 HTML（含学期列表与作息表）
async function fetchSchedulePage() {
    const response = await fetch("/new/student/xsgrkb/week.page", { method: "GET", credentials: "include" });
    if (!response.ok) throw new Error(`无法打开课表页面（HTTP ${response.status}）`);
    return response.text();
}

// 乘方统一表单 POST（课表/考试共用），附带 JSON 请求头与会话
async function postForm(url, formData) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include",
        body: formData.toString()
    });
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response;
}

// 请求指定学期的课程数据
async function fetchCourseData(xnxqdm) {
    const year = parseInt(xnxqdm.slice(0, 4), 10);
    const formData = new URLSearchParams();
    formData.append("xnxqdm", xnxqdm);
    formData.append("zc", "");
    formData.append("d1", `${year}-08-01 00:00:00`);
    formData.append("d2", `${year + 1}-08-31 23:59:59`);
    return (await postForm("/new/student/xsgrkb/getCalendarWeekDatas", formData)).json();
}

// 分页拉取指定学期的全部考试任务
async function fetchExamData(xnxqdm) {
    const allRows = [];
    const pageSize = 100;
    let page = 1;

    for (;;) {
        const formData = new URLSearchParams();
        formData.append("xnxqdm", xnxqdm);
        formData.append("page", String(page));
        formData.append("rows", String(pageSize));
        formData.append("sort", "zc,xq,jcdm2");
        formData.append("order", "asc");

        const json = await (await postForm("/new/student/xsksrw/paginateXsksrw", formData)).json();
        const rows = Array.isArray(json.rows) ? json.rows : [];
        allRows.push(...rows);

        const total = parseInt(json.total, 10);
        if (!total || allRows.length >= total || rows.length === 0) break;
        page += 1;
    }
    return allRows;
}

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function saveTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return;
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

// 编排导入流程：提示 → 选学期 → 请求课表与考试 → 合并保存课程与作息时间
async function runImportFlow() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) { window.shiguangBridge.showToast("导入已取消"); return; }

        const pageHtml = await fetchSchedulePage();
        const semesterOptions = extractSemesterOptions(new DOMParser().parseFromString(pageHtml, "text/html"));
        if (!semesterOptions) throw new Error("未找到学期列表，请先登录教务系统");

        const semester = await selectSemester(semesterOptions);
        if (!semester) { window.shiguangBridge.showToast("导入已取消"); return; }

        const { slots, map: slotMap } = parseBusinessHoursFromHtml(pageHtml);
        window.shiguangBridge.showToast(`正在获取 ${semester.label} 的课表...`);
        const courses = parseCourseList(await fetchCourseData(semester.value), slotMap);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "提示",
                "该学期没有获取到课程数据，请检查登录状态和所选学期。",
                "确定"
            );
            return;
        }

        const exams = [];
        let timeSlots = slots;
        if (await askImportExams()) {
            timeSlots = withLunchSlot(slots);
            courses.forEach(c => {
                if (c.startSection >= 6) c.startSection += 1;
                if (c.endSection >= 6) c.endSection += 1;
            });
            window.shiguangBridge.showToast("正在获取考试安排...");
            exams.push(...parseExamList(await fetchExamData(semester.value), timeSlots));
            if (exams.length === 0) window.shiguangBridge.showToast("该学期暂时没有考试安排");
        }

        await saveCourses([...courses, ...exams]);
        try {
            await saveTimeSlots(timeSlots);
        } catch (error) {
            window.shiguangBridge.showToast(`课程已导入，作息时间导入失败：${error.message}`);
        }

        const examTip = exams.length > 0 ? `成功导入 ${exams.length} 门考试` : "导入完成";
        window.shiguangBridge.showToast(examTip);
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
