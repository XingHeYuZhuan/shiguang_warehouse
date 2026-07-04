/**
 * csuft.js - 中南林业科技大学 强智教务系统适配脚本
 * 
 * 两种模式自动切换：
 *   A. 当前页面有 #kbtable → 直接从 DOM 读取（一键模式）
 *   B. 没有则让用户粘贴 HTML 源码（降级模式）
 */

const PRESET_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:55", endTime: "09:40" },
    { number: 3,  startTime: "10:00", endTime: "10:45" },
    { number: 4,  startTime: "10:55", endTime: "11:40" },
    { number: 5,  startTime: "14:00", endTime: "14:45" },
    { number: 6,  startTime: "14:55", endTime: "15:40" },
    { number: 7,  startTime: "16:00", endTime: "16:45" },
    { number: 8,  startTime: "16:55", endTime: "17:40" },
    { number: 9,  startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
];

function parseWeeks(str) {
    var s = str.replace(/[（(]周[)）]/g, '').trim();
    var r = [];
    s.split(',').forEach(function(p) {
        p = p.trim();
        if (p.includes('-')) {
            var a = p.split('-').map(Number);
            for (var i = a[0]; i <= a[1]; i++) r.push(i);
        } else {
            var n = Number(p);
            if (!isNaN(n)) r.push(n);
        }
    });
    return r;
}

function parseCell(html, day, start, end) {
    var r = [];
    if (!html || html.trim() === '&nbsp;') return r;
    html.split(/[-]{5,}/).forEach(function(block) {
        block = block.trim();
        if (!block || block === '&nbsp;') return;
        var m = block.match(/^([^<]+?)(?:<br>|$)/);
        if (!m) return;
        var name = m[1].trim();
        if (!name) return;
        var teacher = '', pos = '', weeks = [];
        var t = block.match(/<font[^>]*title="老师"[^>]*>([^<]+)<\/font>/);
        if (t) teacher = t[1].trim();
        var w = block.match(/<font[^>]*title="周次[^"]*"[^>]*>([^<]+)<\/font>/);
        if (w) weeks = parseWeeks(w[1].trim());
        var p = block.match(/<font[^>]*title="教室"[^>]*>([^<]+)<\/font>/);
        if (p) pos = p[1].trim();
        r.push({ name: name, teacher: teacher, position: pos, day: day, startSection: start, endSection: end, weeks: weeks, isCustomTime: false });
    });
    return r;
}

function parse(html) {
    var all = [];
    var patterns = [
        { re: /第1[，,]\s*2节/, s: 1, e: 2 },
        { re: /第3[，,]\s*4节/, s: 3, e: 4 },
        { re: /第5[，,]\s*6节/, s: 5, e: 6 },
        { re: /第7[，,]\s*8节/, s: 7, e: 8 },
        { re: /第9[，,]\s*10节/, s: 9, e: 10 },
    ];
    var tm = html.match(/<table[^>]*id="kbtable"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tm) throw new Error('未找到 kbtable');
    var rows = tm[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi);
    for (var rm of rows) {
        var rh = rm[1];
        var thm = rh.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
        if (!thm) continue;
        var tht = thm[1].replace(/<[^>]+>/g, '').trim();
        if (tht.includes('备注')) continue;
        var sec = null;
        for (var p of patterns) { if (p.re.test(tht)) { sec = p; break; } }
        if (!sec) continue;
        var tds = rh.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        var col = 0;
        for (var td of tds) {
            var day = col + 1;
            var kb = td[1].match(/<div[^>]*class="kbcontent"[^>]*>([\s\S]*?)<\/div>/i);
            if (kb) {
                var ch = kb[1].trim();
                if (ch && ch !== '&nbsp;') all.push.apply(all, parseCell(ch, day, sec.s, sec.e));
            }
            col++;
        }
    }
    return all;
}

function getSemester() {
    var sel = document.getElementById('xnxq01id');
    return sel && sel.value ? sel.value : null;
}

async function run() {
    try {
        var hasTable = !!document.getElementById('kbtable');
        var confirmed = await window.AndroidBridgePromise.showAlert(
            "中南林业科技大学课表导入",
            hasTable ? "检测到课表页面，将自动读取数据并导入。" : "请粘贴课表页面的HTML源码。",
            "开始"
        );
        if (!confirmed) { AndroidBridge.showToast("已取消"); return; }

        var courses;
        if (hasTable) {
            courses = parse(document.documentElement.outerHTML);
        } else {
            var src = await window.AndroidBridgePromise.showPrompt("粘贴HTML源码", "请粘贴课表页面的完整HTML源码：", "", "");
            if (!src || !src.trim()) { AndroidBridge.showToast("已取消"); return; }
            courses = parse(src);
        }

        if (!courses || courses.length === 0) {
            await window.AndroidBridgePromise.showAlert("提示", "未解析到课程数据，请确认页面是否正确。", "确定");
            return;
        }

        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        try { await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(PRESET_TIME_SLOTS)); } catch(e) {}
        try { await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: 20, firstDayOfWeek: 1 })); } catch(e) {}

        await window.AndroidBridgePromise.showAlert("完成", "成功导入 " + courses.length + " 条课程记录。", "确定");
        AndroidBridge.notifyTaskCompletion();
    } catch (err) {
        console.error(err);
        try { await window.AndroidBridgePromise.showAlert("错误", err.message || String(err), "确定"); } catch(e) {}
        AndroidBridge.notifyTaskCompletion();
    }
}

run();
