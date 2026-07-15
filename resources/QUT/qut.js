// 青岛理工大学 - 正方教务系统 课程表适配脚本

function parseWeeks(zcd) {
    if (!zcd || typeof zcd !== 'string') return [];
    var weeks = [];
    var seen = {};
    var parts = zcd.split(',');
    for (var i = 0; i < parts.length; i++) {
        var raw = parts[i].trim();
        if (!raw) continue;

        var rangeMatch = raw.match(/^(\d+)-(\d+)周(?:\(单\)|\(双\))?$/);
        if (rangeMatch) {
            var start = parseInt(rangeMatch[1]);
            var end = parseInt(rangeMatch[2]);
            var isOdd = raw.indexOf('(单)') !== -1;
            var isEven = raw.indexOf('(双)') !== -1;
            for (var w = start; w <= end; w++) {
                if (isOdd && w % 2 === 0) continue;
                if (isEven && w % 2 === 1) continue;
                if (!seen[w]) { seen[w] = true; weeks.push(w); }
            }
            continue;
        }

        var singleMatch = raw.match(/^(\d+)周$/);
        if (singleMatch) {
            var w = parseInt(singleMatch[1]);
            if (!seen[w]) { seen[w] = true; weeks.push(w); }
        }
    }
    weeks.sort(function(a, b) { return a - b; });
    return weeks;
}

function cleanCourseName(name) {
    return name.replace(/[★○●◇◆]/g, '').trim();
}

// 全局验证函数
function validateYear(input) {
    if (/^\d{4}$/.test(input)) return false;
    return "请输入四位数字学年";
}

async function runImportFlow() {
    AndroidBridge.showToast("拾光课程表 - 青岛理工大学适配");

    var confirmed = await window.AndroidBridgePromise.showAlert(
        "青岛理工大学课表导入",
        "将从正方教务系统导入课程表。\n请确保已在教务系统中登录。",
        "开始导入"
    );
    if (!confirmed) return;

    var xnm = await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入学年（如 2026 表示 2026-2027 学年）:",
        new Date().getFullYear().toString(),
        "validateYear"
    );
    if (xnm === null) { AndroidBridge.showToast("导入已取消"); return; }

    var semesters = ["第一学期", "第二学期"];
    var semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    if (semesterIndex === null) { AndroidBridge.showToast("导入已取消"); return; }
    var xqm = semesterIndex === 0 ? "3" : "12";

    AndroidBridge.showToast("正在获取课表数据...");

    try {
        var formBody = "xnm=" + xnm + "&xqm=" + xqm + "&kzlx=ck&xsdm=&kclbdm=&kclxdm=";
        var response = await fetch(
            "http://jxgl.qut.edu.cn/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest"
                },
                body: formBody,
                credentials: "include"
            }
        );

        if (!response.ok) throw new Error("请求失败，状态码: " + response.status);

        var text = await response.text();
        if (text.indexOf("登录") !== -1 && text.indexOf("密码") !== -1) {
            throw new Error("未登录或登录已过期，请先登录教务系统");
        }

        var data = JSON.parse(text);

        if (!data.kbList || data.kbList.length === 0) {
            AndroidBridge.showToast("该学期无课表数据");
            return;
        }

        var courses = [];
        for (var i = 0; i < data.kbList.length; i++) {
            var item = data.kbList[i];
            if (!item.kcmc || !item.xqj || !item.jcs) continue;

            var weeks = parseWeeks(item.zcd);
            if (weeks.length === 0) continue;

            var jcsParts = item.jcs.split("-");
            var startSection = parseInt(jcsParts[0]);
            var endSection = parseInt(jcsParts[1] || jcsParts[0]);

            courses.push({
                name: cleanCourseName(item.kcmc),
                teacher: item.xm || "",
                position: item.cdmc || "未排地点",
                day: parseInt(item.xqj),
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }

        if (courses.length === 0) {
            AndroidBridge.showToast("解析课表数据为空");
            return;
        }

        var timeSlots = [
            { "number": 1, "startTime": "08:00", "endTime": "08:45" },
            { "number": 2, "startTime": "08:50", "endTime": "09:35" },
            { "number": 3, "startTime": "09:55", "endTime": "10:40" },
            { "number": 4, "startTime": "10:45", "endTime": "11:30" },
            { "number": 5, "startTime": "11:35", "endTime": "12:20" },
            { "number": 6, "startTime": "14:00", "endTime": "14:45" },
            { "number": 7, "startTime": "14:50", "endTime": "15:35" },
            { "number": 8, "startTime": "15:55", "endTime": "16:40" },
            { "number": 9, "startTime": "16:45", "endTime": "17:30" },
            { "number": 10, "startTime": "19:00", "endTime": "19:45" }
        ];

        var config = {};
        if (xqm === "3") {
            config.semesterStartDate = xnm + "-09-01";
        } else {
            config.semesterStartDate = (parseInt(xnm) + 1) + "-03-01";
        }
        config.semesterTotalWeeks = 20;

        AndroidBridge.showToast("解析到 " + courses.length + " 门课程，正在导入...");

        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));

        AndroidBridge.showToast("成功导入 " + courses.length + " 门课程！");
        AndroidBridge.notifyTaskCompletion();

    } catch (e) {
        console.error("导入失败:", e);
        AndroidBridge.showToast("导入失败: " + e.message);
    }
}

runImportFlow();
