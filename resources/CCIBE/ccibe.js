// 重庆对外经贸学院教务系统 拾光课程表适配脚本
// 教务系统类型：金智智慧教务（新版 workspace）
// 入口地址：https://my-443.vpn.ccibe.edu.cn/ （一站式服务大厅 -> 教务系统 -> 我的课表）
// 使用前请先登录教务系统，并停留在“我的课表”页面

// ============================================================
// 一、基础工具函数
// ============================================================

// 位图转数字数组：从左数第 N 位为 '1'，即第 N 周 / 第 N 节
function bitmapToNums(bitmap) {
    var result = [];
    var raw = String(bitmap || '');
    for (var i = 0; i < raw.length; i++) {
        if (raw[i] === '1') result.push(i + 1);
    }
    return result;
}

// 清洗教师姓名：去掉角色标记，多个教师用顿号连接
function cleanTeacher(rawTeacher) {
    return String(rawTeacher || '')
        .replace(/;\s*$/, '')
        .split(';')
        .map(function (item) { return item.replace(/\[[^\]]*\]/g, '').trim(); })
        .filter(Boolean)
        .join('、');
}

// 拼接上课地点（校区 + 教室）
function cleanPosition(rawCourse) {
    var room = String(rawCourse.roomName || '').trim();
    var campus = String(rawCourse.roomBuildingCampusName || '').trim();
    if (room && campus) return campus + room;
    return room || campus || '';
}

// 解析形如 "1-4,6-18" 的区间文本为数字数组
function parseRangeText(text) {
    var result = [];
    String(text).split(',').forEach(function (segment) {
        var trimmed = segment.trim();
        var range = trimmed.match(/^(\d+)-(\d+)$/);
        if (range) {
            for (var i = parseInt(range[1], 10); i <= parseInt(range[2], 10); i++) {
                result.push(i);
            }
        } else if (/^\d+$/.test(trimmed)) {
            result.push(parseInt(trimmed, 10));
        }
    });
    return result;
}

// ============================================================
// 二、页面数据获取
// ============================================================

// 读取课表页面中已渲染的课程数据（含未展开的折叠课程）
function readFromVue() {
    var app = document.querySelector('#app');
    if (!app || !app.__vue__) return null;

    var originData = null;
    var walk = function (component, depth) {
        if (!component || depth > 30 || originData) return;
        if (component.$options && component.$options.name === 'Schedule') {
            var data = component.$data || {};
            if (data.originData && data.originData.length) {
                try { component.isAllUnfold = true; } catch (e) {}
                originData = data.originData;
            }
            return;
        }
        (component.$children || []).forEach(function (child) { walk(child, depth + 1); });
    };
    try { walk(app.__vue__, 0); } catch (e) {}
    return originData;
}

// 从课表表格 DOM 中解析课程数据
function readFromDom() {
    var sectionMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    var list = [];
    var rows = document.querySelectorAll('table tr');

    for (var r = 0; r < rows.length; r++) {
        var tr = rows[r];
        var sideCells = tr.querySelectorAll('td.side');
        if (sideCells.length < 2) continue;
        var bigSection = sectionMap[(sideCells[1].textContent || '').trim()];
        if (!bigSection) continue;

        var cells = tr.querySelectorAll('td.cell');
        for (var c = 0; c < cells.length; c++) {
            var cell = cells[c];
            var day = c + 1;
            var items = cell.querySelectorAll('.print-hidden .item-container');
            for (var k = 0; k < items.length; k++) {
                var itemRows = items[k].querySelectorAll('.item-row');
                var nameRow = itemRows[0];
                var teacherRow = itemRows[1];
                var metaRow = itemRows[2];
                if (!nameRow || !metaRow) continue;

                var nameEl = nameRow.querySelector('.course-name');
                var name = ((nameEl ? nameEl.textContent : nameRow.textContent) || '').trim();
                var teacher = (teacherRow ? teacherRow.textContent : '') || '';
                var meta = (metaRow.textContent || '').replace(/\s+/g, ' ').trim();

                var weekMatch = meta.match(/\[([\d,\-]+)周\]/);
                var periodMatch = meta.match(/\[([\d,\-]+)节\]/);
                var weeks = weekMatch ? parseRangeText(weekMatch[1]) : [];
                var periods = periodMatch ? parseRangeText(periodMatch[1]) : [bigSection];
                var position = meta.replace(/\[[^\]]*\]/g, '').trim();
                if (!weeks.length || !name) continue;

                list.push({
                    name: name,
                    teacher: cleanTeacher(teacher),
                    position: position,
                    day: day,
                    weeks: weeks,
                    sections: periods.map(function (n) { return { section: n }; })
                });
            }
        }
    }
    return list;
}

// 把页面原始数据归一化为统一中间结构
function normalizeFromVue(rawList) {
    var result = [];
    rawList.forEach(function (raw) {
        var weeks = bitmapToNums(raw.teachingWeek);
        var periods = bitmapToNums(raw.period);
        if (!weeks.length || !periods.length) return;

        var day = parseInt(raw.weekDay, 10);
        if (!day || day < 1 || day > 7) return;

        var name = String(raw.courseName || '').trim();
        if (!name) return;

        result.push({
            name: name,
            teacher: cleanTeacher(raw.instructorName),
            position: cleanPosition(raw),
            day: day,
            weeks: weeks,
            sections: periods.map(function (n) { return { section: n }; })
        });
    });
    return result;
}

// ============================================================
// 三、数据转换与合并
// ============================================================

// 将打散的节次按周重组为连续的 startSection/endSection 区块
function mergeContinuousSections(lessons) {
    if (!lessons || !lessons.length) return [];

    var groups = {};
    lessons.forEach(function (lesson) {
        var key = lesson.name + '|' + lesson.teacher + '|' + lesson.position + '|' + lesson.day;
        if (!groups[key]) {
            groups[key] = {
                name: lesson.name,
                teacher: lesson.teacher,
                position: lesson.position,
                day: lesson.day,
                weekMatrix: []
            };
            for (var i = 0; i < 50; i++) groups[key].weekMatrix.push({});
        }

        var group = groups[key];
        (lesson.weeks || []).forEach(function (week) {
            if (week >= 1 && week <= 50) {
                (lesson.sections || []).forEach(function (section) {
                    group.weekMatrix[week - 1][section.section] = true;
                });
            }
        });
    });

    var merged = [];
    Object.keys(groups).forEach(function (key) {
        var group = groups[key];
        var blockMap = {};

        for (var w = 0; w < group.weekMatrix.length; w++) {
            var sections = Object.keys(group.weekMatrix[w])
                .map(Number)
                .sort(function (a, b) { return a - b; });
            if (!sections.length) continue;

            var start = sections[0];
            var prev = sections[0];
            for (var i = 1; i < sections.length; i++) {
                if (sections[i] === prev + 1) {
                    prev = sections[i];
                } else {
                    var blockKey = start + '-' + prev;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w + 1);
                    start = sections[i];
                    prev = sections[i];
                }
            }
            var lastKey = start + '-' + prev;
            if (!blockMap[lastKey]) blockMap[lastKey] = [];
            blockMap[lastKey].push(w + 1);
        }

        Object.keys(blockMap).forEach(function (blockKey) {
            var parts = blockKey.split('-');
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: parseInt(parts[0], 10),
                endSection: parseInt(parts[1], 10),
                weeks: blockMap[blockKey].sort(function (a, b) { return a - b; })
            });
        });
    });

    merged.sort(function (a, b) {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

// 获取并解析课程数据
async function fetchAndParseCourses() {
    var rawList = null;
    try {
        var vueData = readFromVue();
        rawList = vueData ? normalizeFromVue(vueData) : readFromDom();
    } catch (e) {
        rawList = readFromDom();
    }

    if (!rawList || !rawList.length) return null;
    return mergeContinuousSections(rawList);
}

// ============================================================
// 四、时间与配置数据
// ============================================================

// 预设节次时间（依据教务系统作息配置）
var PRESET_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:15", endTime: "10:00" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
    { number: 11, startTime: "20:50", endTime: "21:35" },
    { number: 12, startTime: "21:45", endTime: "22:30" }
];

// ============================================================
// 五、用户交互
// ============================================================

// 前置公告
async function promptUserToStart() {
    var confirmed = await window.shiguangBridgePromise.showAlert(
        "重庆对外经贸学院 课表导入",
        "导入前请确认：您已登录教务系统，并停留在“我的课表”页面。",
        "好的，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return false;
    }
    return true;
}

// 开学日期校验函数（供 showPrompt 使用，必须定义在全局作用域）
function validateDateInput(input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input || '')) {
        return false; // 验证通过
    }
    return "请按 YYYY-MM-DD 格式填写，例如 2026-09-07";
}

// 询问开学日期：自动识别当前周并反推第 1 周周一作为默认值
async function askSemesterStartDate() {
    var autoDate = await detectSemesterStartDate();
    var input = await window.shiguangBridgePromise.showPrompt(
        "确认开学日期",
        "已自动识别本学期第 1 周周一（格式 YYYY-MM-DD），如有误请修改：",
        autoDate || "",
        "validateDateInput"
    );
    return input || null;
}

// 自动推算开学日期：从当前周接口反推第 1 周周一
async function detectSemesterStartDate() {
    try {
        var token = null;
        try {
            token = JSON.parse(localStorage.getItem('cqu_edu_ACCESS_TOKEN') || '""');
        } catch (e) {}

        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        var response = await fetch('/api/timetable/time/cur-week', {
            credentials: 'include',
            headers: headers
        });
        var json = await response.json();
        var data = json && json.data ? json.data : null;
        if (!data) return null;

        var keys = Object.keys(data);
        if (!keys.length) return null;
        var currentWeek = parseInt(keys[0], 10);
        if (!currentWeek || currentWeek < 1) return null;

        var today = new Date();
        var dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
        var monday = new Date(
            today.getTime() - (dayOfWeek - 1) * 86400000 - (currentWeek - 1) * 7 * 86400000
        );

        var year = monday.getFullYear();
        var month = String(monday.getMonth() + 1).padStart(2, '0');
        var day = String(monday.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    } catch (e) {
        return null;
    }
}

// ============================================================
// 六、数据保存
// ============================================================

// 保存预设时间段
async function saveTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(PRESET_TIME_SLOTS));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("时间段保存失败：" + error.message);
        return false;
    }
}

// 保存课表配置
async function saveCourseConfig(startDate) {
    var config = {
        semesterTotalWeeks: 20,
        firstDayOfWeek: 1
    };
    if (startDate) config.semesterStartDate = startDate;

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课表配置保存失败：" + error.message);
        return false;
    }
}

// 保存课程数据
async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程数据保存失败：" + error.message);
        return false;
    }
}

// ============================================================
// 七、主导入流程（仅负责编排）
// ============================================================
async function runImportFlow() {
    // 1. 前置公告与检查
    var confirmed = await promptUserToStart();
    if (!confirmed) return;

    // 2. 获取并解析课程数据
    window.shiguangBridge.showToast("正在读取课表数据...");
    var courses = await fetchAndParseCourses();
    if (!courses || !courses.length) {
        window.shiguangBridge.showToast("未找到课表数据，请先登录并进入“我的课表”页面。");
        return;
    }

    // 3. 确认开学日期
    var startDate = await askSemesterStartDate();

    // 4. 保存预设时间段
    var timeSlotsSaved = await saveTimeSlots();
    if (!timeSlotsSaved) return;

    // 5. 保存课表配置
    var configSaved = await saveCourseConfig(startDate);
    if (!configSaved) return;

    // 6. 保存课程数据
    var coursesSaved = await saveCourses(courses);
    if (!coursesSaved) return;

    // 7. 流程完全成功，发送结束信号
    window.shiguangBridge.showToast("导入成功，共 " + courses.length + " 个课程条目。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
