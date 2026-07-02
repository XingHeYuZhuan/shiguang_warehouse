function scheduleHtmlProvider() {
    const table = document.getElementById('kbtable');
    if (!table) {
        console.error("未找到课表表格 kbtable");
        return "";
    }
    return document.documentElement.outerHTML;
}

function scheduleHtmlParser(html) {

    function cleanText(value) {
        return (value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseWeeks(weekStr) {
        let weeks = [];
        if (!weekStr) return weeks;

        let parts = weekStr
            .replace("周", "")
            .replace(/[（）()]/g, "")
            .split(/[,\，、]/);

        for (let part of parts) {
            if (part.includes('-')) {
                let [start, end] = part.split('-').map(v => parseInt(v));
                for (let i = start; i <= end; i++) {
                    if (!weeks.includes(i)) weeks.push(i);
                }
            } else {
                let w = parseInt(part);
                if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
            }
        }

        return weeks.sort((a, b) => a - b);
    }

    function parseSections(text) {
        const nums = cleanText(text).match(/\d+/g);
        if (!nums) return null;

        return {
            start: parseInt(nums[0]),
            end: parseInt(nums[nums.length - 1])
        };
    }

    function extractCoursesFromDoc(doc) {

        let parsedCourses = [];
        const table = doc.getElementById('kbtable');
        if (!table) return [];

        const rows = table.getElementsByTagName('tr');

        for (let i = 1; i < rows.length; i++) {

            const cells = rows[i].getElementsByTagName('td');
            if (!cells || cells.length < 2) continue;

            const periodText = cells[0].innerText;
            const sections = parseSections(periodText);
            if (!sections) continue;

            for (let j = 1; j < cells.length; j++) {

                const cell = cells[j];
                const divs = cell.querySelectorAll('div.kbcontent');
                if (!divs.length) continue;

                divs.forEach(div => {

                    let htmlContent = div.innerHTML;
                    if (!htmlContent || htmlContent.includes("&nbsp;")) return;

                    let blocks = htmlContent.split(/-{5,}\s*<br\s*\/?>/);

                    blocks.forEach(block => {

                        let temp = document.createElement('div');
                        temp.innerHTML = block;

                        let nameNode = temp.childNodes[0];
                        let name = nameNode ? nameNode.textContent.trim() : "";
                        if (!name) return;

                        let course = {
                            name,
                            teacher: "",
                            position: "",
                            weeks: [],
                            day: j,
                            startSection: sections.start,
                            endSection: sections.end
                        };

                        let fonts = temp.querySelectorAll('font');

                        fonts.forEach(f => {
                            let title = f.getAttribute('title');
                            let text = cleanText(f.innerText);

                            if (title === '老师') course.teacher = text;
                            if (title === '教室') course.position = text;
                            if (title === '周次(节次)') course.weeks = parseWeeks(text);
                        });

                        parsedCourses.push(course);
                    });
                });
            }
        }

        return parsedCourses;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    return extractCoursesFromDoc(doc);
}

/**
 * ====== 必须：系统生命周期入口 ======
 */
async function runImportFlow() {

    try {

        if (typeof window.AndroidBridge !== 'undefined') {
            AndroidBridge.showToast("正在获取课表...");
        }

        const html = await fetch('/jsxsd/xskb/xskb_list.do', {
            method: 'GET',
            credentials: 'include'
        }).then(res => res.text());

        const parser = new DOMParser();
        let doc = parser.parseFromString(html, 'text/html');

        // ===== 学期选择 =====
        let select = doc.getElementById('xnxq01id');
        let semesterList = [];
        let semesterValues = [];
        let defaultIndex = 0;

        if (select) {
            let options = select.querySelectorAll('option');
            options.forEach((opt, i) => {
                semesterList.push(opt.innerText.trim());
                semesterValues.push(opt.value);
                if (opt.selected) defaultIndex = i;
            });
        }

        if (semesterList.length > 0 && window.AndroidBridgePromise) {

            let index = await window.AndroidBridgePromise.showSingleSelection(
                "选择学期",
                JSON.stringify(semesterList),
                defaultIndex
            );

            if (index === null) return;

            if (index !== defaultIndex) {
                const form = new URLSearchParams();
                form.append('xnxq01id', semesterValues[index]);

                const res = await fetch('/jsxsd/xskb/xskb_list.do', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: form.toString(),
                    credentials: 'include'
                });

                const html2 = await res.text();
                doc = parser.parseFromString(html2, 'text/html');
            }
        }

        // ===== 解析课程 =====
        const courses = extractCoursesFromDoc(doc);

        if (!courses.length) {
            if (window.AndroidBridgePromise) {
                await window.AndroidBridgePromise.showAlert("提示", "未解析到课程", "确定");
            }
            return;
        }

        // ===== 作息配置 =====
        const config = {
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };

        const timeIndex = await (async () => {
            if (!window.AndroidBridgePromise) return 0;

            return await window.AndroidBridgePromise.showSingleSelection(
                "选择作息",
                JSON.stringify(["冬令时", "夏令时"]),
                0
            );
        })();

        const timeSlots = timeIndex === 1 ? "SUMMER" : "WINTER";

        // ===== 保存 =====
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));

        if (window.AndroidBridge) {
            AndroidBridge.showToast(`导入成功 ${courses.length} 门课程`);
            AndroidBridge.notifyTaskCompletion();
        }

    } catch (e) {
        console.error(e);
        if (window.AndroidBridge) {
            AndroidBridge.showToast("导入失败：" + e.message);
        }
    }
}