// 湖南邮电职业技术学院（湘邮教学管理平台）拾光课程表适配脚本
// 系统：正方 V6 系教务网络管理系统（登录页 Logon.do?method=logon）
// 状态：草稿未验证 —— 课表页 DOM 结构基于仓库内"正方教务-通用"适配（zhengfang_01.js）
//       推断，尚未用真实账号登录确认。如导入失败或字段错位，请提供课表页 HTML 后修正。
// 使用：先在应用内登录湘邮教学管理平台，进入"信息查询 → 学生个人课表"，点击导入。

(function () {
    "use strict";

    function normalizeText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/[０-９]/g, function (char) {
                return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
            })
            .replace(/[，、]/g, ",")
            .replace(/[－–—~～至到]/g, "-")
            .replace(/[（）]/g, function (char) { return char === "（" ? "(" : ")"; })
            .replace(/\s+/g, " ")
            .trim();
    }

    function showMessage(message) {
        if (window.AndroidBridge && typeof window.AndroidBridge.showToast === "function") {
            window.AndroidBridge.showToast(message);
        } else {
            console.log(message);
        }
    }

    async function showError(title, message) {
        if (window.AndroidBridgePromise && typeof window.AndroidBridgePromise.showAlert === "function") {
            await window.AndroidBridgePromise.showAlert(title, message, "确定");
        } else {
            alert(title + "\n" + message);
        }
    }

    // ---- 周次解析：支持 "1-16周"、"1-8(单)"、"1-3,5-6" 等 ----
    function parseWeeks(value) {
        const text = normalizeText(value)
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\(周\)/g, "")
            .replace(/周/g, "")
            .replace(/\s/g, "");
        const weeks = new Set();
        text.split(/[;,；]/).forEach(function (part) {
            if (!part) return;
            const oddOnly = /单/.test(part);
            const evenOnly = /双/.test(part);
            const ranges = part.match(/\d+(?:-\d+)?/g) || [];
            ranges.forEach(function (rangeText) {
                const bounds = rangeText.split("-").map(function (item) { return parseInt(item, 10); });
                const start = bounds[0];
                const end = bounds.length > 1 ? bounds[1] : start;
                if (!start || !end || start > end) return;
                for (let week = start; week <= end; week += 1) {
                    if (oddOnly && week % 2 === 0) continue;
                    if (evenOnly && week % 2 !== 0) continue;
                    weeks.add(week);
                }
            });
        });
        return Array.from(weeks).sort(function (left, right) { return left - right; });
    }

    // ---- 节次解析：从 "1-2节" 提取 [1,2] ----
    function parsePeriods(value) {
        const text = normalizeText(value).replace(/\s/g, "");
        const bracket = text.match(/\[([^\]]+)\]/);
        const source = bracket ? bracket[1] : text;
        const match = source.match(/(\d+)(?:-(\d+))?节/);
        if (!match) return [];
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : start;
        if (!start || !end || start > end) return [];
        const periods = [];
        for (let period = start; period <= end; period += 1) periods.push(period);
        return periods;
    }

    // ---- 定位包含课表的文档（处理 iframe 嵌套）----
    function findScheduleDocument() {
        if (document.querySelector("#kbgrid_table_0") || document.querySelector("#kblist_table") || hasCourseTables(document)) {
            return document;
        }
        const frames = Array.from(document.querySelectorAll("iframe"));
        for (const frame of frames) {
            try {
                const frameDocument = frame.contentDocument || frame.contentWindow.document;
                if (frameDocument && (frameDocument.querySelector("#kbgrid_table_0") ||
                    frameDocument.querySelector("#kblist_table") || hasCourseTables(frameDocument))) {
                    return frameDocument;
                }
            } catch (error) {
                // 跨域 iframe 无法读取，继续检查其他 frame。
            }
        }
        return null;
    }

    function hasCourseTables(doc) {
        const candidates = doc.querySelectorAll("table");
        for (const table of candidates) {
            if (table.querySelector(".timetable_con, .kbcontent, .title")) return true;
        }
        return false;
    }

    // ---- 从单元格推导星期 ----
    function parseWeekday(td) {
        const id = String(td.id || "");
        const idParts = id.split("-");
        const fromId = parseInt(idParts[0], 10);
        if (fromId >= 1 && fromId <= 7) return fromId;
        const cellIndex = td.cellIndex;
        return cellIndex >= 1 && cellIndex <= 7 ? cellIndex : 0;
    }

    function courseNameFromBlock(container) {
        const titleNode = container.querySelector(".title font, .title");
        if (titleNode) {
            return normalizeText(titleNode.textContent).replace(/[●★○]/g, "").trim();
        }
        const lines = extractBlockLines(container);
        return lines[0] || "";
    }

    // 把课程块 HTML 拆成可见行（去掉 title 行后取剩余第一行作为兜底名称）
    function extractBlockLines(container) {
        const clone = container.cloneNode(true);
        Array.from(clone.querySelectorAll(".title")).forEach(function (node) { node.remove(); });
        return clone.innerHTML
            .replace(/<br\s*\/?\s*>/gi, "\n")
            .split(/\n+/)
            .map(function (line) {
                const holder = document.createElement("div");
                holder.innerHTML = line;
                return normalizeText(holder.textContent).replace(/[●★○]/g, "").trim();
            })
            .filter(function (line) { return line && line !== "-"; });
    }

    function parseCourseBlock(container, weekday) {
        const courseName = courseNameFromBlock(container);
        const ps = Array.from(container.querySelectorAll("p"));

        let weekPeriodText = "";
        for (const p of ps) {
            const text = normalizeText(p.textContent);
            if (/节/.test(text) && /\d+-\d+/.test(text)) { weekPeriodText = text; break; }
        }
        if (!weekPeriodText) {
            weekPeriodText = normalizeText(container.textContent);
        }

        const weeks = parseWeeks(weekPeriodText);
        const periods = parsePeriods(weekPeriodText);
        if (!courseName || weekday < 1 || weekday > 7 || weeks.length === 0 || periods.length === 0) {
            return null;
        }

        // 教室/老师：优先按 zhengfang 结构（第 2/3 个 p），否则按关键字兜底
        let position = "";
        let teacher = "";
        if (ps.length >= 3) {
            position = normalizeText(ps[1].textContent);
            teacher = normalizeText(ps[2].textContent);
        }
        if (!position || !teacher) {
            const allLines = extractBlockLines(container).slice(1);
            for (const line of allLines) {
                if (!position && /教室|上课地点|教学楼|实验楼/.test(line)) position = line;
                if (!teacher && /老师|教师/.test(line)) teacher = line.replace(/^(老师|教师)[:：]\s*/, "");
            }
        }

        return {
            name: courseName,
            teacher: teacher || "未知教师",
            position: position || "待定",
            day: weekday,
            startSection: periods[0],
            endSection: periods[periods.length - 1],
            weeks: weeks
        };
    }

    // ---- 网格视图解析（#kbgrid_table_0）----
    function parseGridTable(table) {
        const courses = [];
        Array.from(table.querySelectorAll("td")).forEach(function (td) {
            const day = parseWeekday(td);
            if (day < 1 || day > 7) return;
            const blocks = Array.from(td.querySelectorAll(".timetable_con"));
            if (blocks.length === 0) {
                const html = String(td.innerHTML || "").trim();
                if (!html || html === "&nbsp;") return;
                html.split(/<br\s*\/?\s*>\s*[-—]{10,}\s*<br\s*\/?\s*>/i).forEach(function (blockHtml) {
                    if (!blockHtml.trim()) return;
                    const holder = document.createElement("div");
                    holder.innerHTML = blockHtml;
                    const course = parseCourseBlock(holder, day);
                    if (course) courses.push(course);
                });
                return;
            }
            blocks.forEach(function (block) {
                const course = parseCourseBlock(block, day);
                if (course) courses.push(course);
            });
        });
        return courses;
    }

    // ---- 列表视图解析（#kblist_table）----
    function parseListTable(table) {
        const courses = [];
        Array.from(table.querySelectorAll("tbody")).forEach(function (tbody, dayIndex) {
            const day = dayIndex; // tbody 顺序：第 0 个为表头，1..7 对应周一..周日
            if (day < 1 || day > 7) return;
            Array.from(tbody.querySelectorAll("tr:not(:first-child)")).forEach(function (tr) {
                const cells = Array.from(tr.querySelectorAll("td"));
                if (cells.length === 0) return;
                const contentCell = cells.length > 1 ? cells[1] : cells[0];
                const sectionCell = cells.length > 1 ? cells[0] : null;
                let startSection = 0;
                if (sectionCell) {
                    const sectionText = normalizeText(sectionCell.textContent).replace(/\s/g, "");
                    const match = sectionText.match(/^\s*(\d+)/);
                    if (match) startSection = parseInt(match[1], 10);
                }
                Array.from(contentCell.querySelectorAll(".timetable_con")).forEach(function (block) {
                    const course = parseCourseBlock(block, day);
                    if (!course) return;
                    if (startSection > 0) {
                        const span = course.endSection - course.startSection;
                        course.startSection = startSection;
                        course.endSection = startSection + span;
                    }
                    courses.push(course);
                });
            });
        });
        return courses;
    }

    // ---- 兜底：扫描任意表格中带课程特征的单元格 ----
    function parseGenericTables(doc) {
        const courses = [];
        Array.from(doc.querySelectorAll("table")).forEach(function (table) {
            Array.from(table.querySelectorAll("td")).forEach(function (td) {
                const blocks = Array.from(td.querySelectorAll(".timetable_con, .kbcontent"));
                if (blocks.length === 0) return;
                const day = parseWeekday(td);
                if (day < 1 || day > 7) return;
                blocks.forEach(function (block) {
                    const course = parseCourseBlock(block, day);
                    if (course) courses.push(course);
                });
            });
        });
        return courses;
    }

    // ---- 合并同课程跨节次（相邻块合并为连续节次）----
    function mergeCoursePeriods(courses) {
        const merged = new Map();
        courses.forEach(function (course) {
            const key = [course.name, course.teacher, course.position, course.day, course.weeks.join(",")].join("|");
            if (!merged.has(key)) {
                merged.set(key, Object.assign({}, course));
                return;
            }
            const existing = merged.get(key);
            existing.startSection = Math.min(existing.startSection, course.startSection);
            existing.endSection = Math.max(existing.endSection, course.endSection);
        });
        return Array.from(merged.values()).sort(function (left, right) {
            return left.day - right.day || left.startSection - right.startSection || left.name.localeCompare(right.name);
        });
    }

    function parseCourses(scheduleDocument) {
        let courses = [];
        const grid = scheduleDocument.querySelector("#kbgrid_table_0");
        if (grid) {
            courses = parseGridTable(grid);
        } else {
            const list = scheduleDocument.querySelector("#kblist_table");
            if (list) {
                courses = parseListTable(list);
            } else {
                courses = parseGenericTables(scheduleDocument);
            }
        }
        return mergeCoursePeriods(courses);
    }

    // ---- 常见作息（未验证，需按学校实际作息核对）----
    const TimeSlots = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:05", endTime: "10:50" },
        { number: 4, startTime: "11:00", endTime: "11:45" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:55", endTime: "15:40" },
        { number: 7, startTime: "16:00", endTime: "16:45" },
        { number: 8, startTime: "16:55", endTime: "17:40" },
        { number: 9, startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" }
    ];

    async function saveToApp(courses) {
        if (!window.AndroidBridgePromise) throw new Error("SleepDown 导入桥接不可用");
        let totalWeeks = 0;
        courses.forEach(function (course) {
            course.weeks.forEach(function (week) { totalWeeks = Math.max(totalWeeks, week); });
        });
        const configSaved = await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify({
            semesterTotalWeeks: totalWeeks || 20
        }));
        const slotsSaved = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));
        const coursesSaved = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!configSaved || !slotsSaved || !coursesSaved) throw new Error("课程数据交给应用时失败");
    }

    async function runImport() {
        try {
            showMessage("正在读取湖南邮电课表…");
            const scheduleDocument = findScheduleDocument();
            if (!scheduleDocument) {
                throw new Error("未找到课表表格，请确认已登录并进入\u201c信息查询 → 学生个人课表\u201d页面");
            }
            const courses = parseCourses(scheduleDocument);
            if (courses.length === 0) {
                throw new Error("没有解析到课程，请确认当前学期有课且课表已加载完成");
            }
            await saveToApp(courses);
            showMessage("已解析 " + courses.length + " 个课程时段");
            if (!window.AndroidBridge || typeof window.AndroidBridge.notifyTaskCompletion !== "function") {
                throw new Error("导入完成回调不可用");
            }
            window.AndroidBridge.notifyTaskCompletion();
        } catch (error) {
            console.error("HNPTC import failed", error);
            await showError("湖南邮电导入失败", error && error.message ? error.message : String(error));
        }
    }

    runImport();
})();
