// 南京信息工程大学教务系统（jwxt.nuist.edu.cn）拾光课程表适配脚本

function validateAcademicYear(input) {
    if (/^\d{4}$/.test(String(input).trim())) return false;
    return "请输入四位数字的起始学年，例如 2026。";
}

function parseWeeks(skzc) {
    const value = String(skzc || "");
    const weeks = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "1") weeks.push(i + 1);
    }
    return weeks;
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

async function fetchCourses(academicYear, semesterIndex) {
    const semester = semesterIndex === 0 ? 1 : 2;
    const xnxqdm = `${academicYear}-${Number(academicYear) + 1}-${semester}`;
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

        const currentYear = new Date().getFullYear();
        const academicYear = await window.shiguangBridgePromise.showPrompt(
            "选择学年", "请输入起始学年（例如 2026）", String(currentYear), "validateAcademicYear"
        );
        if (academicYear === null) return;

        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期", JSON.stringify(["第一学期", "第二学期"]), 0
        );
        if (semesterIndex === null || semesterIndex < 0) return;

        window.shiguangBridge.showToast("正在获取课表...");
        const result = await fetchCourses(String(academicYear).trim(), semesterIndex);
        const timeSlots = await fetchTimeSlots();
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: null,
            semesterTotalWeeks: 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }));
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
        if (timeSlots.length > 0) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
        window.shiguangBridge.showToast(`成功导入 ${result.courses.length} 条课程记录（${result.xnxqdm}）。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${error.message}`);
        console.error("NUIST adapter error", error);
    }
}

runImportFlow();
