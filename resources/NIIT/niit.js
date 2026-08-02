// 文件: courseImport.js
// 功能: 针对 金智教育 教务系统「我的课表」(wdkb) 页面做课程导入适配。
// 说明: 本脚本注入到课表页面后，会自动解析 #kcb_container table.wut_table 中的课程，
//       并通过 AndroidBridge 桥接导入到课表 App。
// 数据来源:
//   - 表格:   #kcb_container table.wut_table 中 td[data-role="item"]
//   - 节次/星期: td 上的 data-week(1-7 对应周一至周日)、data-begin-unit、data-end-unit
//   - 课程名:  .mtt_item_kcmc 的直接文本
//   - 教师:    .mtt_item_jxbmc
//   - 周次/教室: .mtt_item_room 的文本，形如 "1-5周,9-13周,星期1,第1节-第2节,G1躬行楼102"

(function () {
    'use strict';

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[课程导入]');
        console.log.apply(console, args);
    }

    function toast(msg) {
        try {
            window.AndroidBridge.showToast(msg);
        } catch (e) {
            log('toast失败(' + msg + '):', e);
        }
    }

    function hasBridge() {
        return !!(window.AndroidBridgePromise && typeof window.AndroidBridgePromise.saveImportedCourses === 'function');
    }

    // ---------- 工具函数 ----------

    // 取元素的直接文本节点内容（忽略子元素），课程名所在 div 中混有教师/教室等子结构
    function directText(el) {
        if (!el) return '';
        var t = '';
        for (var i = 0; i < el.childNodes.length; i++) {
            var node = el.childNodes[i];
            if (node.nodeType === 3) {
                t += node.nodeValue;
            }
        }
        t = t.replace(/\s+/g, ' ').trim();
        if (t) return t;
        // 兜底：去掉所有子元素后再取文本
        var clone = el.cloneNode(true);
        while (clone.firstChild && clone.firstChild.nodeType !== 3) {
            clone.removeChild(clone.firstChild);
        }
        return (clone.textContent || '').trim();
    }

    // 解析周次描述（可能含多个区间，如 "1-5周,9周,13-18周" 或 "13-15周(单)"），返回展开后的周次数组
    function parseWeeks(roomText) {
        var weekPart = roomText.split('星期')[0] || '';
        var weeks = [];
        var re = /(\d+)(?:\s*-\s*(\d+))?\s*周\s*(?:\(([单双])\))?/g;
        var m;
        while ((m = re.exec(weekPart)) !== null) {
            var a = parseInt(m[1], 10);
            var b = m[2] ? parseInt(m[2], 10) : a;
            var parity = m[3] || '';
            for (var w = a; w <= b; w++) {
                if (parity === '单' && w % 2 === 0) continue;
                if (parity === '双' && w % 2 === 1) continue;
                weeks.push(w);
            }
        }
        return Array.from(new Set(weeks)).sort(function (x, y) { return x - y; });
    }

    // 从 room 文本中取出教室名，文本形如 "1-5周,9-13周,星期1,第1节-第2节,G1躬行楼102"
    function extractPosition(roomText) {
        var m = /第\d+节-第\d+节,([\s\S]*)$/.exec(roomText);
        if (m) return m[1].trim();
        var parts = roomText.split(',');
        return parts[parts.length - 1].trim();
    }

    // 从 room 文本兜底解析星期与节次，文本形如 "星期2,第9节-第10节"
    function parseDaySections(roomText) {
        var day = NaN, startSection = NaN, endSection = NaN;
        var dm = /星期([1-7])/.exec(roomText);
        if (dm) day = parseInt(dm[1], 10);
        var sm = /第(\d+)节-第(\d+)节/.exec(roomText);
        if (sm) {
            startSection = parseInt(sm[1], 10);
            endSection = parseInt(sm[2], 10);
        }
        return { day: day, startSection: startSection, endSection: endSection };
    }

    // ---------- 时间工具 ----------

    // 等待课表表格渲染完成（SPA 页面可能延迟加载）
    function waitForTable(maxWaitMs, intervalMs) {
        return new Promise(function (resolve, reject) {
            var start = Date.now();
            var timer = setInterval(function () {
                var table = document.querySelector('#kcb_container table.wut_table');
                if (table) {
                    clearInterval(timer);
                    resolve(table);
                } else if (Date.now() - start > maxWaitMs) {
                    clearInterval(timer);
                    reject(new Error('等待课表加载超时，未找到 #kcb_container table.wut_table'));
                }
            }, intervalMs || 300);
        });
    }

    // ---------- 数据解析 ----------

    // 1. 解析课程
    // 注意: 同一 td（同一天、同一节次）下可能包含多个 .mtt_arrange_item，
    //       即同一时间段、不同周的多个课程，需逐个解析；
    //       若某课程被拆成多块（周次不连续），最后按 名称+教师+教室+时间 合并周次。
    function extractCourses(table) {
        var courses = [];
        var cells = table.querySelectorAll('td[data-role="item"]');
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            var cellDay = parseInt(cell.getAttribute('data-week'), 10);
            var cellStart = parseInt(cell.getAttribute('data-begin-unit'), 10);
            var cellEnd = parseInt(cell.getAttribute('data-end-unit'), 10);

            var items = cell.querySelectorAll('.mtt_arrange_item');
            if (items.length === 0) continue;

            for (var j = 0; j < items.length; j++) {
                var item = items[j];
                var name = directText(item.querySelector('.mtt_item_kcmc'));
                if (!name) continue; // 空占位

                var roomEl = item.querySelector('.mtt_item_room');
                var roomText = roomEl ? roomEl.textContent.replace(/\s+/g, '').trim() : '';
                if (!roomText) continue;

                var day = cellDay, startSection = cellStart, endSection = cellEnd;
                // 兜底：属性缺失时从文本解析
                if (isNaN(day) || isNaN(startSection) || isNaN(endSection)) {
                    var fb = parseDaySections(roomText);
                    if (isNaN(day)) day = fb.day;
                    if (isNaN(startSection)) startSection = fb.startSection;
                    if (isNaN(endSection)) endSection = fb.endSection;
                }
                if (isNaN(day) || isNaN(startSection) || isNaN(endSection)) continue;

                var teacherEl = item.querySelector('.mtt_item_jxbmc');
                courses.push({
                    "name": name,
                    "teacher": teacherEl ? teacherEl.textContent.replace(/\s+/g, '').trim() : '',
                    "position": extractPosition(roomText),
                    "day": day,
                    "startSection": startSection,
                    "endSection": endSection,
                    "weeks": parseWeeks(roomText)
                });
            }
        }

        // 合并同一时间槽上被拆分的相同课程（周次取并集）
        var merged = [];
        var index = {};
        for (var k = 0; k < courses.length; k++) {
            var c = courses[k];
            var key = c.day + '|' + c.startSection + '|' + c.endSection + '|' + c.name + '|' + c.teacher + '|' + c.position;
            if (index[key] === undefined) {
                index[key] = merged.length;
                merged.push({
                    "name": c.name,
                    "teacher": c.teacher,
                    "position": c.position,
                    "day": c.day,
                    "startSection": c.startSection,
                    "endSection": c.endSection,
                    "weeks": c.weeks.slice()
                });
            } else {
                var existing = merged[index[key]];
                c.weeks.forEach(function (w) {
                    if (existing.weeks.indexOf(w) === -1) existing.weeks.push(w);
                });
            }
        }
        merged.forEach(function (c) {
            c.weeks.sort(function (x, y) { return x - y; });
        });
        return merged;
    }

    // 2. 预设时间段：使用本校作息时间表
    function buildTimeSlots() {
        return [
            { "number": 1, "startTime": "08:00", "endTime": "08:45" },
            { "number": 2, "startTime": "08:55", "endTime": "09:40" },
            { "number": 3, "startTime": "10:00", "endTime": "10:45" },
            { "number": 4, "startTime": "10:55", "endTime": "11:40" },
            { "number": 5, "startTime": "13:30", "endTime": "14:15" },
            { "number": 6, "startTime": "14:25", "endTime": "15:10" },
            { "number": 7, "startTime": "15:30", "endTime": "16:15" },
            { "number": 8, "startTime": "16:25", "endTime": "17:10" },
            { "number": 9, "startTime": "18:15", "endTime": "19:00" },
            { "number": 10, "startTime": "19:10", "endTime": "19:55" },
            { "number": 11, "startTime": "20:05", "endTime": "20:50" }
        ];
    }

    // 3. 推断本学期总周数
    function detectTotalWeeks(courses) {
        var max = 18;
        courses.forEach(function (c) {
            c.weeks.forEach(function (w) { if (w > max) max = w; });
        });
        var body = document.body ? (document.body.textContent || '') : '';
        var re = /(\d{1,2})\s*周/g;
        var m;
        while ((m = re.exec(body)) !== null) {
            var v = parseInt(m[1], 10);
            if (v > max) max = v;
        }
        return max < 18 ? 18 : max;
    }

    // ---------- AndroidBridge 导入 ----------

    async function importCourses(courses) {
        log('正在导入课程，共', courses.length, '条...');
        var result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            log('课程导入成功！');
            toast('成功导入 ' + courses.length + ' 门课程');
            return true;
        }
        log('课程导入未成功，结果：', result);
        toast('课程导入失败，请查看日志。');
        return false;
    }

    async function importPresetTimeSlots(slots) {
        log('正在导入预设时间段，共', slots.length, '个...');
        var result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        if (result === true) {
            log('预设时间段导入成功！');
        } else {
            log('预设时间段导入未成功，结果：', result);
        }
    }

    async function importCourseConfig(totalWeeks) {
        // 只传需要修改的字段，其余使用 App 端默认值
        var config = {
            "semesterStartDate": null,
            "semesterTotalWeeks": totalWeeks,
            "firstDayOfWeek": 1 // 周一为一周第一天（本课表 data-week=1 为星期一）
        };
        log('正在导入课表配置，总周数=', totalWeeks);
        var result = await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        if (result === true) {
            log('课表配置导入成功！');
        } else {
            log('课表配置导入未成功，结果：', result);
        }
    }

    // ---------- 主流程 ----------

    async function main() {
        if (!hasBridge()) {
            log('未检测到 AndroidBridgePromise，跳过导入。');
            return;
        }
        toast('开始导入课程...');
        try {
            await waitForTable(30000, 300);
            var courses = extractCourses(document.querySelector('#kcb_container table.wut_table'));
            log('解析到课程', courses.length, '条');
            if (courses.length === 0) {
                toast('未解析到任何课程');
                return;
            }

            var ok = await importCourses(courses);
            if (!ok) return;

            var slots = buildTimeSlots();
            await importPresetTimeSlots(slots);

            var totalWeeks = detectTotalWeeks(courses);
            await importCourseConfig(totalWeeks);
        } catch (e) {
            console.error('导入课程时发生错误:', e);
            toast('导入课程失败: ' + (e && e.message ? e.message : e));
        } finally {
            try {
                window.AndroidBridge.notifyTaskCompletion();
                log('已通知任务完成');
            } catch (e) {
                log('notifyTaskCompletion 调用失败:', e);
            }
        }
    }

    // 启动导入
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { main(); });
    } else {
        main();
    }
})();
