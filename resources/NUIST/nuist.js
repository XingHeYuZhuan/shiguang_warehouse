// 南京信息工程大学教务系统（jwxt.nuist.edu.cn）拾光课程表适配脚本

function parseWeeks(skzc) {
    const value = String(skzc || "");
    const weeks = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "1") weeks.push(i + 1);
    }
    return weeks;
}

// jc.do 不可用时的 NUIST 默认作息（已由接口确认）。
const DEFAULT_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "13:45", endTime: "14:30" },
    { number: 6, startTime: "14:40", endTime: "15:25" },
    { number: 7, startTime: "15:55", endTime: "16:40" },
    { number: 8, startTime: "16:50", endTime: "17:35" },
    { number: 9, startTime: "18:45", endTime: "19:30" },
    { number: 10, startTime: "19:40", endTime: "20:25" },
    { number: 11, startTime: "20:35", endTime: "21:20" },
    { number: 12, startTime: "21:25", endTime: "22:00" }
];

function getErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") return serialized;
    } catch (_) {
        // Ignore serialization failures and use the generic fallback below.
    }
    return "未知错误";
}

function parsePosition(row) {
    const campus = String(row.XXXQDM_DISPLAY || "").trim();
    const room = String(row.JASMC || "").trim();
    if (campus && room) return `${room}（${campus}）`;
    return room || campus || "待定";
}

function parseCourse(row) {
    const day = Number(row.SKXQ);
    const startSection = Number(row.KSJC);
    const endSection = Number(row.JSJC);
    const weeks = parseWeeks(row.SKZC);
    if (!row.KCM || !day || day < 1 || day > 7 || !startSection || !endSection ||
        startSection > endSection || weeks.length === 0) return null;

    return {
        name: String(row.KCM).trim(),
        teacher: String(row.SKJS || "").split(/[\\/、,，]/)[0].trim() || "未知",
        position: parsePosition(row),
        day,
        startSection,
        endSection,
        weeks
    };
}

async function fetchCourses(xnxqdm) {
    const response = await fetch("/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: `XNXQDM=${encodeURIComponent(xnxqdm)}`,
        credentials: "include"
    });
    if (!response.ok) throw new Error(`课表接口请求失败（HTTP ${response.status}）`);

    const payload = await response.json();
    const table = payload && payload.datas && payload.datas.cxxszhxqkb;
    if (!table) throw new Error("教务系统返回数据格式异常。");
    if (table.extParams && Number(table.extParams.code) !== 1) {
        throw new Error(table.extParams.msg || "教务系统未发布该学期课表。");
    }

    const rows = Array.isArray(table.rows) ? table.rows : [];
    const courses = rows.map(parseCourse).filter(Boolean);
    if (courses.length === 0) throw new Error("未找到包含有效时间的课程。");
    courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
    return { courses, xnxqdm };
}

async function fetchCurrentSemester() {
    const response = await fetch("/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: "",
        credentials: "include"
    });
    if (!response.ok) throw new Error(`当前学期接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = payload && payload.datas && payload.datas.dqxnxq && payload.datas.dqxnxq.rows;
    const term = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!term || !term.DM) throw new Error("未获取到当前学期信息。");
    return {
        code: String(term.DM),
        name: String(term.MC || term.DM)
    };
}

async function fetchTimeSlots() {
    const response = await fetch("/jwapp/sys/wdkb/modules/jshkcb/jc.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: "",
        credentials: "include"
    });
    if (!response.ok) throw new Error(`节次时间接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = payload && payload.datas && payload.datas.jc && payload.datas.jc.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map(row => ({
        number: Number(row.DM),
        startTime: String(row.KSSJ || ""),
        endTime: String(row.JSSJ || "")
    })).filter(slot => slot.number > 0 && slot.startTime && slot.endTime)
      .sort((a, b) => a.number - b.number);
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "南京信息工程大学课表导入",
            "请先在当前教务页面完成登录，再开始导入。",
            "开始导入"
        );
        if (!confirmed) return;

        window.shiguangBridge.showToast("正在获取课表...");
        const semester = await fetchCurrentSemester();
        window.shiguangBridge.showToast(`当前学期：${semester.name}`);
        const result = await fetchCourses(semester.code);
        let timeSlots = DEFAULT_TIME_SLOTS;
        try {
            const fetchedTimeSlots = await fetchTimeSlots();
            if (fetchedTimeSlots.length > 0) timeSlots = fetchedTimeSlots;
        } catch (error) {
            console.warn("NUIST time slot request failed, using defaults", error);
            window.shiguangBridge.showToast("作息时间获取失败，已使用默认时间继续导入。");
        }
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: null,
            semesterTotalWeeks: 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }));
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast(`成功导入 ${result.courses.length} 条课程记录（${result.xnxqdm}）。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("NUIST adapter error", error);
    }
}

runImportFlow();
