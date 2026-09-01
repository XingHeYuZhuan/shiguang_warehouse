// 哈尔滨工程大学(hrbeu.edu.cn) 本科课表适配脚本
// 金智教务(Wisedu EMAP)平台，API方案

var HEU_API = {
    term: "/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do",
    course: "/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do",
    config: "/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do"
};

var HEU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "13:30", endTime: "14:15" },
    { number: 7, startTime: "14:20", endTime: "15:05" },
    { number: 8, startTime: "15:25", endTime: "16:10" },
    { number: 9, startTime: "16:15", endTime: "17:00" },
    { number: 10, startTime: "17:05", endTime: "17:50" },
    { number: 11, startTime: "18:30", endTime: "19:15" },
    { number: 12, startTime: "19:20", endTime: "20:05" },
    { number: 13, startTime: "20:10", endTime: "20:55" }
];

async function postJson(url, params) {
    var options = { credentials: "include" };
    if (params) {
        options.method = "POST";
        options.headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
        options.body = new URLSearchParams(params);
    }
    var resp = await fetch(url, options);
    if (!resp.ok) throw new Error("请求失败: " + resp.status);
    var data = await resp.json();
    if (data.code && data.code !== "0") throw new Error("教务系统拒绝请求");
    return data;
}

function extractRows(data, key) {
    if (data && data.datas) {
        if (key && data.datas[key] && Array.isArray(data.datas[key].rows)) {
            return data.datas[key].rows;
        }
        for (var k in data.datas) {
            var v = data.datas[k];
            if (v && Array.isArray(v.rows)) return v.rows;
        }
    }
    return [];
}

function parseWeeksBitmap(skzc) {
    var weeks = [];
    var bits = String(skzc || "");
    for (var i = 0; i < bits.length; i++) {
        if (bits[i] === "1") weeks.push(i + 1);
    }
    return weeks;
}

function parseWeeksText(text, maxWeek) {
    if (!text) return [];
    var cleaned = String(text).replace(/[第周]/g, "").replace(/，/g, ",");
    var odd = /单/.test(cleaned);
    var even = /双/.test(cleaned);
    var weeks = [];
    var seen = {};
    var rangeRe = /(\d+)\s*[-~至到]\s*(\d+)/g;
    var match;
    while ((match = rangeRe.exec(cleaned)) !== null) {
        for (var w = parseInt(match[1]); w <= parseInt(match[2]); w++) {
            if (odd && w % 2 === 0) continue;
            if (even && w % 2 !== 0) continue;
            if (!seen[w]) { weeks.push(w); seen[w] = true; }
        }
    }
    var singles = cleaned.replace(rangeRe, "").match(/\d+/g);
    if (singles) {
        for (var j = 0; j < singles.length; j++) {
            var n = parseInt(singles[j]);
            if (odd && n % 2 === 0) continue;
            if (even && n % 2 !== 0) continue;
            if (!seen[n] && n > 0 && n <= (maxWeek || 30)) { weeks.push(n); seen[n] = true; }
        }
    }
    return weeks.sort(function(a, b) { return a - b; });
}

function detectTerm() {
    try {
        var el = document.querySelector("#dqxnxq2");
        if (el && el.getAttribute("value")) return el.getAttribute("value");
    } catch (e) {}
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    if (m >= 1 && m <= 6) return (y - 1) + "-" + y + "-2";
    return y + "-" + (y + 1) + "-1";
}

function parseCourseRow(row) {
    var day = parseInt(row.SKXQ, 10);
    var startSection = parseInt(row.KSJC, 10);
    var endSection = parseInt(row.JSJC, 10);
    if (!row.KCM || isNaN(day) || isNaN(startSection) || isNaN(endSection)) return null;

    var weeks = [];
    if (row.SKZC) {
        weeks = parseWeeksBitmap(row.SKZC);
    } else if (row.ZCMC) {
        weeks = parseWeeksText(row.ZCMC, 30);
    }
    if (!weeks.length) return null;

    var name = String(row.KCM).trim();
    if (row.TYXMDM_DISPLAY) name += "(" + row.TYXMDM_DISPLAY + ")";

    return {
        name: name,
        teacher: String(row.SKJS || row.JSM || "").trim() || "未知",
        position: String(row.JASMC || row.JXLDM_DISPLAY || "").trim() || "待定",
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
    };
}

function deduplicateCourses(rows) {
    var index = {};
    var courses = [];
    for (var i = 0; i < rows.length; i++) {
        var parsed = parseCourseRow(rows[i]);
        if (!parsed) continue;
        var key = parsed.day + "|" + parsed.startSection + "|" + parsed.endSection +
                  "|" + parsed.name + "|" + parsed.teacher + "|" + parsed.position;
        if (index[key] === undefined) {
            index[key] = courses.length;
            courses.push(parsed);
        } else {
            var existing = courses[index[key]];
            parsed.weeks.forEach(function(w) {
                if (existing.weeks.indexOf(w) === -1) existing.weeks.push(w);
            });
        }
    }
    courses.forEach(function(c) { c.weeks.sort(function(a, b) { return a - b; }); });
    return courses;
}

async function runImportFlow() {
    var confirmed = await window.shiguangBridgePromise.showAlert(
        "哈尔滨工程大学课表导入",
        "请确保已登录教务系统。\n登录后，进入课表页面，即可自动导入当前学期课表。",
        "确定，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入");
        return;
    }

    window.shiguangBridge.showToast("正在获取学期信息...");

    var termCode = "";
    try {
        var termData = await postJson(HEU_API.term);
        var termRows = extractRows(termData, "dqxnxq");
        if (termRows.length > 0 && termRows[0].DM) {
            termCode = termRows[0].DM;
        }
    } catch (e) {
        console.log("HEU: 学期API失败，使用自动检测: " + e.message);
    }
    if (!termCode) termCode = detectTerm();
    console.log("HEU: 当前学期=" + termCode);

    window.shiguangBridge.showToast("正在获取课表数据...");

    var courseData = await postJson(HEU_API.course, { XNXQDM: termCode });
    var courseRows = extractRows(courseData, "cxxszhxqkb");
    console.log("HEU: API返回 " + courseRows.length + " 条原始记录");

    if (courseRows.length === 0) {
        await window.shiguangBridgePromise.showAlert(
            "导入提示",
            "当前学期未查到课表数据，请确认已登录并有排课。",
            "知道了"
        );
        return;
    }

    var courses = deduplicateCourses(courseRows);
    console.log("HEU: 去重后 " + courses.length + " 门课程");

    if (courses.length === 0) {
        window.shiguangBridge.showToast("课表解析结果为空");
        return;
    }

    var totalWeeks = 20;
    for (var i = 0; i < courseRows.length; i++) {
        var len = String(courseRows[i].SKZC || "").length;
        if (len > totalWeeks) totalWeeks = len;
    }
    var maxWeekInCourses = 0;
    courses.forEach(function(c) {
        var mw = Math.max.apply(null, c.weeks);
        if (mw > maxWeekInCourses) maxWeekInCourses = mw;
    });
    if (maxWeekInCourses > totalWeeks) totalWeeks = maxWeekInCourses;

    await window.shiguangBridgePromise.savePresetTimeSlots(
        JSON.stringify(HEU_TIME_SLOTS)
    );
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterStartDate: null,
        semesterTotalWeeks: totalWeeks,
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.saveImportedCourses(
        JSON.stringify(courses)
    );

    window.shiguangBridge.showToast(
        termCode + " 课表导入成功，共 " + courses.length + " 门课程"
    );
    window.shiguangBridge.notifyTaskCompletion();
}

(async function() {
    try {
        await runImportFlow();
    } catch (error) {
        console.error("HEU课表导入失败:", error);
        if (window.shiguangBridgePromise) {
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                "错误: " + error.message + "\n\n请确认：\n1. 已登录教务系统\n2. 处于校园网或VPN环境",
                "确定"
            );
        }
    }
})();
