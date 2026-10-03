/**
 * 浙江工商职业技术学院 - 青果教务管理适配脚本
 * 支持 WebVPN / iframe / #lessonSchedule-content 全量抓取及通用表格降级
 */

(function () {
    const TimeSlots = [
        { number: 1, startTime: "08:30", endTime: "09:15" },
        { number: 2, startTime: "09:20", endTime: "10:05" },
        { number: 3, startTime: "10:20", endTime: "11:05" },
        { number: 4, startTime: "11:10", endTime: "11:55" },
        { number: 5, startTime: "13:10", endTime: "13:55" },
        { number: 6, startTime: "14:00", endTime: "14:45" },
        { number: 7, startTime: "15:00", endTime: "15:45" },
        { number: 8, startTime: "15:50", endTime: "16:35" },
        { number: 9, startTime: "16:40", endTime: "17:25" },
        { number: 10, startTime: "18:20", endTime: "19:05" },
        { number: 11, startTime: "19:10", endTime: "19:55" },
        { number: 12, startTime: "20:00", endTime: "20:45" }
    ];

    const DAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

    function safeToast(msg) {
        try {
            if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
                window.shiguangBridge.showToast(msg);
            }
        } catch (e) {
            console.log("[ZJBTI Toast]", msg);
        }
    }

    async function safeAlert(title, message) {
        if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === "function") {
            return await window.shiguangBridgePromise.showAlert(title, message, "我知道了");
        }
        safeToast(message);
        return true;
    }

    function parseWeeks(weekStr, isSingle, isDouble) {
        const clean = String(weekStr).replace(/周/g, "").trim();
        const parts = clean.split(/[,，]/);
        const weeks = [];

        parts.forEach(part => {
            if (part.includes("-")) {
                const [start, end] = part.split("-").map(Number);
                for (let w = start; w <= end; w++) {
                    if (isSingle && w % 2 === 0) continue;
                    if (isDouble && w % 2 !== 0) continue;
                    weeks.push(w);
                }
            } else {
                const w = Number(part);
                if (!isNaN(w) && w > 0) {
                    if (isSingle && w % 2 === 0) return;
                    if (isDouble && w % 2 !== 0) return;
                    weeks.push(w);
                }
            }
        });

        return Array.from(new Set(weeks)).sort((a, b) => a - b);
    }

    /**
     * 递归遍历 DOM 及所有 iframe / frame 寻找课表容器
     */
    function findScheduleDocument(rootDoc) {
        if (!rootDoc) return null;
        try {
            if (rootDoc.querySelector("#lessonSchedule-content") || rootDoc.querySelector(".weeklesson")) {
                return rootDoc;
            }
        } catch (e) {}

        try {
            const frames = rootDoc.querySelectorAll("iframe, frame");
            for (let i = 0; i < frames.length; i++) {
                try {
                    const subDoc = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);
                    if (subDoc) {
                        const found = findScheduleDocument(subDoc);
                        if (found) return found;
                    }
                } catch (e) {}
            }
        } catch (e) {}

        return null;
    }

    /**
     * 从 #lessonSchedule-content 解析全量课程
     */
    function parseFromLessonScheduleContent(doc) {
        const uls = Array.from(doc.querySelectorAll("#lessonSchedule-content .weeklesson ul, .weeklesson ul"));
        if (uls.length === 0) return null;

        const courses = [];
        const seen = new Set();

        uls.forEach(ul => {
            const lis = Array.from(ul.querySelectorAll("li"));
            let cur = {};

            function commitCourse() {
                if (!cur.name || !cur.timeStr) return;
                const cleanTime = cur.timeStr.replace(/&nbsp;/g, " ").trim();
                const m = cleanTime.match(/\[(.*?)\](?:\((单|双)\))?\s*([一二三四五六日天])\s*\[(\d+)(?:\s*-\s*(\d+))?节\]/);
                if (!m) return;

                const weeks = parseWeeks(m[1], m[2] === "单", m[2] === "双");
                const day = DAY_MAP[m[3]];
                const startSec = parseInt(m[4]);
                const endSec = m[5] ? parseInt(m[5]) : startSec;

                if (!day || isNaN(startSec) || weeks.length === 0) return;

                const key = `${cur.name}|${cur.teacher || ""}|${cur.position || ""}|${day}|${startSec}-${endSec}|${weeks.join(",")}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    courses.push({
                        name: cur.name,
                        teacher: cur.teacher || "",
                        position: cur.position || "",
                        day: day,
                        startSection: startSec,
                        endSection: endSec,
                        weeks: weeks
                    });
                }
            }

            lis.forEach(li => {
                const text = li.innerText.trim();
                if (text.startsWith("课程名称：")) {
                    commitCourse();
                    cur = { name: text.replace("课程名称：", "").trim() };
                } else if (text.startsWith("任课教师：")) {
                    cur.teacher = text.replace("任课教师：", "").trim();
                } else if (text.startsWith("上课时间：")) {
                    cur.timeStr = text.replace("上课时间：", "").trim();
                } else if (text.startsWith("上课地点：")) {
                    cur.position = text.replace("上课地点：", "").trim();
                }
            });

            commitCourse();
        });

        return courses.length > 0 ? courses : null;
    }

    /**
     * 降级从标准青果 table 网格抓取
     */
    function parseFromTableFallback(rootDoc) {
        function findTable(doc) {
            if (!doc) return null;
            try {
                const t = Array.from(doc.querySelectorAll("table")).find(x => x.innerText && x.innerText.includes("时段") && x.innerText.includes("节次"));
                if (t) return t;
            } catch (e) {}

            try {
                const frames = doc.querySelectorAll("iframe, frame");
                for (let i = 0; i < frames.length; i++) {
                    try {
                        const subDoc = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);
                        if (subDoc) {
                            const found = findTable(subDoc);
                            if (found) return found;
                        }
                    } catch (e) {}
                }
            } catch (e) {}
            return null;
        }

        const table = findTable(rootDoc);
        if (!table) return null;

        const courses = [];
        const seen = new Set();

        Array.from(table.rows).forEach(row => {
            const cells = Array.from(row.cells);
            if (cells.length < 7) return;

            cells.forEach((cell, colIndex) => {
                const distanceToLast = cells.length - 1 - colIndex;
                if (distanceToLast > 6) return;
                const day = 7 - distanceToLast;

                const rawText = cell.innerText.trim();
                if (!rawText.includes("[")) return;

                const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
                lines.forEach((line, i) => {
                    const match = line.match(/([\d\-,]+)\[(\d+)-(\d+)\]/);
                    if (match) {
                        const name = i >= 2 ? lines[i - 2] : (i >= 1 ? lines[i - 1] : "未知课程");
                        const teacher = (i >= 1 && !lines[i - 1].includes("[")) ? lines[i - 1] : "";
                        const position = (i < lines.length - 1) ? lines[i + 1] : "";
                        const startSec = parseInt(match[2]);
                        const endSec = parseInt(match[3]);
                        const weeks = parseWeeks(match[1], false, false);

                        const key = `${name}|${teacher}|${position}|${day}|${startSec}-${endSec}|${weeks.join(",")}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            courses.push({
                                name: name.replace(/\s/g, ""),
                                teacher: teacher.replace(/\s/g, ""),
                                position: position.replace(/\s/g, ""),
                                day: day,
                                startSection: startSec,
                                endSection: endSec,
                                weeks: weeks
                            });
                        }
                    }
                });
            });
        });

        return courses.length > 0 ? courses : null;
    }

    async function runImportFlow() {
        try {
            const currentUrl = window.location.href;

            // 1. 如果还在 WebVPN 导航页或未进入教务管理
            if (!currentUrl.includes("zjgsjw") && !currentUrl.includes("homes.action")) {
                await safeAlert(
                    "导入指引：请先进入教务管理",
                    "检测到尚未进入教务管理系统。\n\n操作步骤：\n1. 请在当前 WebVPN 页面找到并点击「教务管理」\n2. 登录并进入教务管理首页\n3. 在首页课表区域上方切换为「学期课表」\n4. 确认课表加载出来后，再次点击右下角执行导入"
                );
                return;
            }

            safeToast("正在检测浙江工商职院课表结构...");

            let doc = findScheduleDocument(window.document);
            let courses = null;

            if (doc) {
                courses = parseFromLessonScheduleContent(doc);
            }

            if (!courses || courses.length === 0) {
                courses = parseFromTableFallback(window.document);
            }

            // 2. 如果已在教务管理但未切换到学期课表
            if (!courses || courses.length === 0) {
                await safeAlert(
                    "导入指引：请切换为学期课表",
                    "已检测到教务管理，但未找到学期课表数据。\n\n请按以下步骤操作：\n1. 在教务首页课表区域上方点击切换为「学期课表」\n2. 等待课表内容完整显示\n3. 再次点击右下角执行导入"
                );
                return;
            }

            let maxWeek = 20;
            courses.forEach(c => {
                c.weeks.forEach(w => {
                    if (w > maxWeek) maxWeek = w;
                });
            });

            safeToast(`检测到 ${courses.length} 门课程，正在保存...`);

            if (window.shiguangBridgePromise) {
                await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

                try {
                    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));
                } catch (e) {
                    console.warn("作息时间表保存失败:", e);
                }

                try {
                    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
                        semesterStartDate: null,
                        semesterTotalWeeks: maxWeek,
                        firstDayOfWeek: 1
                    }));
                } catch (e) {
                    console.warn("学期配置保存失败:", e);
                }
            }

            safeToast(`成功导入 ${courses.length} 门课程并同步 12 节课作息！`);

            if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === "function") {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            const errStr = error ? (error.stack || error.message || String(error)) : "未知错误";
            safeToast("导入发生异常: " + errStr);
            console.error("ZJBTI Import Error:", error);
            await safeAlert("导入异常", "错误原因：" + errStr);
        }
    }

    runImportFlow();
})();
