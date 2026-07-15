// 中南林业科技大学(csuft.edu.cn) 拾光课程表适配脚本
// 强智教务系统，通过 WebVPN 访问

window.validateYearInput = function(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的学年！";
};

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const pure = weekStr.split('(')[0];
    pure.split(',').forEach(seg => {
        if (seg.includes('-')) {
            const [s, e] = seg.split('-').map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = s; i <= e; i++) weeks.push(i);
            }
        } else {
            const w = parseInt(seg);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function mergeCourses(courses) {
    if (courses.length <= 1) return courses;
    courses.sort((a, b) => {
        return a.name.localeCompare(b.name) || a.day - b.day || a.startSection - b.startSection;
    });
    const merged = [];
    let cur = courses[0];
    for (let i = 1; i < courses.length; i++) {
        const n = courses[i];
        if (cur.name === n.name && cur.teacher === n.teacher && cur.position === n.position && cur.day === n.day && cur.endSection + 1 === n.startSection) {
            cur.endSection = n.endSection;
        } else {
            merged.push(cur);
            cur = n;
        }
    }
    merged.push(cur);
    return merged;
}

const SECTION_MAP = {
    '第1，2节': [1, 2], '第1,2节': [1, 2], '第1, 2节': [1, 2],
    '第3，4节': [3, 4], '第3,4节': [3, 4], '第3, 4节': [3, 4],
    '第5，6节': [5, 6], '第5,6节': [5, 6], '第5, 6节': [5, 6],
    '第7，8节': [7, 8], '第7,8节': [7, 8], '第7, 8节': [7, 8],
    '第9，10节': [9, 10], '第9,10节': [9, 10], '第9, 10节': [9, 10],
};

const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
];

function parseSchedule(doc) {
    const table = doc.getElementById('kbtable');
    if (!table) return [];
    let raw = [];
    const rows = Array.from(table.querySelectorAll('tr')).filter(r => r.querySelector('td'));
    rows.forEach(row => {
        const th = row.querySelector('th');
        if (!th) return;
        const thText = th.textContent.trim();
        if (thText.includes('备注')) return;
        const section = SECTION_MAP[thText];
        if (!section) return;
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, idx) => {
            const day = idx + 1;
            const divs = cell.querySelectorAll('div.kbcontent');
            divs.forEach(div => {
                const html = div.innerHTML.trim();
                if (!html || html === '&nbsp;' || div.innerText.trim().length < 2) return;
                const blocks = html.split(/[-]{5,}/);
                blocks.forEach(block => {
                    if (!block.trim()) return;
                    const temp = document.createElement('div');
                    temp.innerHTML = block;
                    let name = '';
                    for (let node of temp.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== '') {
                            name = node.textContent.trim();
                            break;
                        }
                    }
                    const teacher = (temp.querySelector('font[title="老师"]') || temp.querySelector('font[title="教师"]'))?.innerText || '';
                    const position = temp.querySelector('font[title="教室"]')?.innerText || '';
                    const weekStr = temp.querySelector('font[title="周次(节次)"]')?.innerText || '';
                    if (name && section[0] > 0) {
                        raw.push({
                            name: name,
                            teacher: teacher,
                            weeks: parseWeeks(weekStr),
                            position: position,
                            day: day,
                            startSection: section[0],
                            endSection: section[1]
                        });
                    }
                });
            });
        });
    });
    return mergeCourses(raw);
}

async function runImportFlow() {
    try {
        const confirmed = await window.AndroidBridgePromise.showAlert("提示", "请确保已成功登录教务系统。是否开始导入？", "开始");
        if (!confirmed) return;

        const year = await window.AndroidBridgePromise.showPrompt("选择学年", "请输入要导入的起始学年（例如 2025-2026 应输入2025）:", "", "validateYearInput");
        if (!year) return;

        const semesterIdx = await window.AndroidBridgePromise.showSingleSelection("选择学期", JSON.stringify(["第一学期", "第二学期"]), -1);
        if (semesterIdx === null) return;

        const semId = `${year}-${parseInt(year) + 1}-${semesterIdx + 1}`;
        AndroidBridge.showToast("正在获取课表数据...");

        const url = "https://http-jwgl-csuft-edu-cn-80.webvpn.csuft.edu.cn/jsxsd/xskb/xskb_list.do";
        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `xnxq01id=${semId}`,
            credentials: "include"
        });

        const html = await resp.text();
        const courses = parseSchedule(new DOMParser().parseFromString(html, "text/html"));

        if (courses.length === 0) {
            AndroidBridge.showToast("未找到课程，请检查学年学期选择或登录状态。");
            return;
        }

        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: 20, firstDayOfWeek: 1 }));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));

        AndroidBridge.showToast(`成功导入 ${courses.length} 门课程`);
        AndroidBridge.notifyTaskCompletion();
    } catch (err) {
        AndroidBridge.showToast("错误: " + err.message);
    }
}

runImportFlow();
