// 重庆对外经贸学院教务系统 拾光课程表适配脚本
// 入口地址: https://my-443.vpn.ccibe.edu.cn/ （一站式服务大厅 -> 教务系统 -> 我的课表）
// 使用前请先登录并停留在“我的课表”页面（jwgl.ccibe.edu.cn/workspace/curriculum）

// ============ 通用工具 ============
// 位图转数字数组：从左数第 N 位为 1，即第 N 周 / 第 N 节
function bitmapToNums(s) {
    var out = [];
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
        if (s[i] === '1') out.push(i + 1);
    }
    return out;
}

function cleanTeacher(t) {
    return String(t || '')
        .replace(/;\s*$/, '')
        .split(';')
        .map(function (x) { return x.replace(/\[[^\]]*\]/g, '').trim(); })
        .filter(Boolean)
        .join('、');
}

function cleanRoom(o) {
    var room = String(o.roomName || '').trim();
    var campus = String(o.roomBuildingCampusName || '').trim();
    if (room && campus) return campus + room;
    return room || campus || '';
}

function parseRange(s) {
    var out = [];
    String(s).split(',').forEach(function (part) {
        var m = part.trim().match(/^(\d+)-(\d+)$/);
        if (m) {
            for (var i = parseInt(m[1], 10); i <= parseInt(m[2], 10); i++) out.push(i);
        } else if (/^\d+$/.test(part.trim())) {
            out.push(parseInt(part.trim(), 10));
        }
    });
    return out;
}

// ============ 数据获取：优先页面内存数据，其次 DOM 表格 ============
function readFromVue() {
    var app = document.querySelector('#app');
    if (!app || !app.__vue__) return null;
    var found = null;
    var walk = function (c, d) {
        if (!c || d > 30 || found) return;
        if (c.$options && c.$options.name === 'Schedule') {
            var data = c.$data || {};
            if (data.originData && data.originData.length) {
                try { c.isAllUnfold = true; } catch (e) {}
                found = data.originData;
            }
            return;
        }
        (c.$children || []).forEach(function (ch) { walk(ch, d + 1); });
    };
    try { walk(app.__vue__, 0); } catch (e) {}
    return found;
}

function readFromDom() {
    var secMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    var list = [];
    var trs = document.querySelectorAll('table tr');
    for (var r = 0; r < trs.length; r++) {
        var tr = trs[r];
        var sideCells = tr.querySelectorAll('td.side');
        if (sideCells.length < 2) continue;
        var bigSection = secMap[(sideCells[1].textContent || '').trim()];
        if (!bigSection) continue;
        var cells = tr.querySelectorAll('td.cell');
        for (var c = 0; c < cells.length; c++) {
            var td = cells[c];
            var day = c + 1;
            var items = td.querySelectorAll('.print-hidden .item-container');
            for (var k = 0; k < items.length; k++) {
                var rows = items[k].querySelectorAll('.item-row');
                var nameRow = rows[0];
                var teacherRow = rows[1];
                var metaRow = rows[2];
                if (!nameRow || !metaRow) continue;
                var nameEl = nameRow.querySelector('.course-name');
                var name = ((nameEl ? nameEl.textContent : nameRow.textContent) || '').trim();
                var teacher = (teacherRow ? teacherRow.textContent : '') || '';
                var meta = (metaRow.textContent || '').replace(/\s+/g, ' ').trim();
                var weekMatch = meta.match(/\[([\d,\-]+)周\]/);
                var periodMatch = meta.match(/\[([\d,\-]+)节\]/);
                var weeks = weekMatch ? parseRange(weekMatch[1]) : [];
                var periods = periodMatch ? parseRange(periodMatch[1]) : [bigSection];
                var pos = meta.replace(/\[[^\]]*\]/g, '').trim();
                if (!weeks.length || !name) continue;
                list.push({
                    name: name,
                    teacher: cleanTeacher(teacher),
                    position: pos,
                    day: day,
                    weeks: weeks,
                    sections: periods.map(function (n) { return { section: n }; })
                });
            }
        }
    }
    return list;
}

function normalizeVue(list) {
    var out = [];
    list.forEach(function (o) {
        var weeks = bitmapToNums(o.teachingWeek);
        var periods = bitmapToNums(o.period);
        if (!weeks.length || !periods.length) return;
        var day = parseInt(o.weekDay, 10);
        if (!day || day < 1 || day > 7) return;
        var name = String(o.courseName || '').trim();
        if (!name) return;
        out.push({
            name: name,
            teacher: cleanTeacher(o.instructorName),
            position: cleanRoom(o),
            day: day,
            weeks: weeks,
            sections: periods.map(function (n) { return { section: n }; })
        });
    });
    return out;
}

// 合并同一门课在相同 (课程名|教师|地点|星期) 下被打散的连续节次，并重组周次
function mergeContinuousSections(lessons) {
    if (!lessons || !lessons.length) return [];
    var groups = {};
    lessons.forEach(function (l) {
        var key = l.name + '|' + l.teacher + '|' + l.position + '|' + l.day;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                weeksMatrix: []
            };
            for (var i = 0; i < 50; i++) groups[key].weeksMatrix.push({});
        }
        var g = groups[key];
        (l.weeks || []).forEach(function (w) {
            if (w >= 1 && w <= 50) {
                (l.sections || []).forEach(function (s) {
                    g.weeksMatrix[w - 1][s.section] = true;
                });
            }
        });
    });

    var merged = [];
    Object.keys(groups).forEach(function (key) {
        var g = groups[key];
        var blockMap = {};
        for (var w = 0; w < g.weeksMatrix.length; w++) {
            var secs = Object.keys(g.weeksMatrix[w]).map(Number).sort(function (a, b) { return a - b; });
            if (!secs.length) continue;
            var start = secs[0], prev = secs[0];
            for (var i = 1; i < secs.length; i++) {
                if (secs[i] === prev + 1) {
                    prev = secs[i];
                } else {
                    var bk = start + '-' + prev;
                    if (!blockMap[bk]) blockMap[bk] = [];
                    blockMap[bk].push(w + 1);
                    start = secs[i]; prev = secs[i];
                }
            }
            var bk2 = start + '-' + prev;
            if (!blockMap[bk2]) blockMap[bk2] = [];
            blockMap[bk2].push(w + 1);
        }
        Object.keys(blockMap).forEach(function (bk) {
            var parts = bk.split('-');
            merged.push({
                name: g.name,
                teacher: g.teacher,
                position: g.position,
                day: g.day,
                startSection: parseInt(parts[0], 10),
                endSection: parseInt(parts[1], 10),
                weeks: blockMap[bk].sort(function (a, b) { return a - b; })
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

async function fetchAndParseCourses() {
    var raw = null;
    try {
        var vueData = readFromVue();
        raw = vueData ? normalizeVue(vueData) : readFromDom();
    } catch (e) {
        raw = readFromDom();
    }
    if (!raw || !raw.length) return null;
    return mergeContinuousSections(raw);
}

// ============ 时间段与配置 ============
async function applyTimeSlots() {
    var slots = [
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
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function applyCourseConfig() {
    var config = {
        semesterStartDate: "2026-09-07",
        semesterTotalWeeks: 20,
        firstDayOfWeek: 1
    };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// ============ 前置检查 ============
async function promptUserToStart() {
    var confirmed = await window.shiguangBridgePromise.showAlert(
        "导入前请确认",
        "请确保您已登录教务系统，并停留在“我的课表”页面，然后点击确认开始导入。",
        "好的，开始"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入。");
        return false;
    }
    return true;
}

// ============ 主流程 ============
async function runImportFlow() {
    try {
        var confirmed = await promptUserToStart();
        if (!confirmed) {
            return;
        }

        window.shiguangBridge.showToast("正在读取课表数据...");

        var courses = await fetchAndParseCourses();
        if (!courses || !courses.length) {
            throw new Error("未找到课表数据，请先登录并进入“我的课表”页面");
        }

        await applyTimeSlots();
        await applyCourseConfig();

        var saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saveResult) {
            window.shiguangBridge.showToast("成功导入 " + courses.length + " 个课程条目");
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        console.error("[CCIBE 适配异常] " + (e && e.message ? e.message : e));
        window.shiguangBridge.showToast("导入失败：" + (e && e.message ? e.message : e));
    }
}

runImportFlow();
