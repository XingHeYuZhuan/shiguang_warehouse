// 西南交通大学 VATUU 为途教务系统课表导入脚本
// 适配页面：/vatuu/CourseAction?setAction=userCourseSchedule&selectTableType=ThisTerm

(() => {
    const SWJTU_SEMESTER_TOTAL_WEEKS = 19;

    const SWJTU_TIME_SLOTS = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:50", endTime: "09:35" },
        { number: 3, startTime: "09:50", endTime: "10:35" },
        { number: 4, startTime: "10:40", endTime: "11:25" },
        { number: 5, startTime: "11:30", endTime: "12:15" },
        { number: 6, startTime: "14:00", endTime: "14:45" },
        { number: 7, startTime: "14:50", endTime: "15:35" },
        { number: 8, startTime: "15:40", endTime: "16:25" },
        { number: 9, startTime: "16:40", endTime: "17:25" },
        { number: 10, startTime: "17:30", endTime: "18:15" },
        { number: 11, startTime: "19:30", endTime: "20:15" },
        { number: 12, startTime: "20:20", endTime: "21:05" },
        { number: 13, startTime: "21:10", endTime: "21:55" },
    ];

    const SWJTU_COURSE_CONFIG = {
        semesterStartDate: null,
        semesterTotalWeeks: SWJTU_SEMESTER_TOTAL_WEEKS,
        defaultClassDuration: 45,
        firstDayOfWeek: 1,
    };

    function normalizeText(text) {
        return String(text || "")
            .replace(/\u00a0/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/[\t\r]+/g, " ")
            .replace(/ +/g, " ")
            .trim();
    }

    function getCellLines(cell) {
        const cloned = cell.cloneNode(true);
        cloned.querySelectorAll("br").forEach((br) => {
            br.replaceWith("\n");
        });
        return normalizeText(cloned.textContent)
            .split(/\n+/)
            .map(normalizeText)
            .filter((line) => line && line !== "&nbsp;");
    }

    function isCourseHeaderLine(line) {
        return /^[A-Z]+\d+\s+.+[（(].+[）)]$/.test(line);
    }

    function parseCourseHeader(line) {
        const match = normalizeText(line).match(
            /^([A-Z]+\d+)\s+(.+?)[（(]([^（）()]*)[）)]$/,
        );
        if (!match) return null;
        return {
            courseCode: match[1],
            name: normalizeText(match[2]),
            teacher: normalizeText(match[3]),
        };
    }

    function parseWeeks(weekText) {
        const weeks = [];
        const text = normalizeText(weekText)
            .replace(/第/g, "")
            .replace(/[[【]/g, "(")
            .replace(/[\]】]/g, ")");
        const regex =
            /(\d+)(?:\s*-\s*(\d+))?\s*周?\s*(?:\((单|双)\)|([单双])周?)?/g;
        let match = regex.exec(text);

        while (match !== null) {
            const start = Number(match[1]);
            const end = match[2] ? Number(match[2]) : start;
            const parity = match[3] || match[4] || "";
            if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
                continue;

            for (let week = start; week <= end; week++) {
                if (parity === "单" && week % 2 !== 1) continue;
                if (parity === "双" && week % 2 !== 0) continue;
                if (!weeks.includes(week)) weeks.push(week);
            }

            match = regex.exec(text);
        }

        return weeks.sort((a, b) => a - b);
    }

    function parseScheduleLine(line) {
        const text = normalizeText(line);
        const match = text.match(
            /^(.+?周(?:\s*[（(][单双][）)])?)(?:\s+(.+))?$/,
        );
        if (!match) return null;

        const weeks = parseWeeks(match[1]);
        if (weeks.length === 0) return null;

        return {
            weeks,
            position: normalizeText(match[2] || "未指定"),
        };
    }

    function parseCoursesFromCell(cell) {
        const lines = getCellLines(cell);
        const courses = [];

        for (let i = 0; i < lines.length; i++) {
            if (!isCourseHeaderLine(lines[i])) continue;

            const header = parseCourseHeader(lines[i]);
            if (!header?.name) continue;

            let schedule = null;
            for (let j = i + 1; j < lines.length; j++) {
                if (isCourseHeaderLine(lines[j])) break;
                schedule = parseScheduleLine(lines[j]);
                if (schedule) break;
            }

            if (schedule) {
                courses.push({
                    courseCode: header.courseCode,
                    name: header.name,
                    teacher: header.teacher || "未指定",
                    position: schedule.position || "未指定",
                    weeks: schedule.weeks,
                });
            }
        }

        return courses;
    }

    function getCandidateDocuments() {
        const docs = [document];
        document.querySelectorAll("iframe").forEach((frame) => {
            try {
                if (frame.contentDocument) docs.push(frame.contentDocument);
            } catch (error) {
                console.warn("跳过不可访问的 iframe：", error);
            }
        });
        return docs;
    }

    function findScheduleTable() {
        for (const doc of getCandidateDocuments()) {
            const tables = Array.from(doc.querySelectorAll("table"));
            const table = tables.find((item) => {
                const text = normalizeText(item.textContent);
                return (
                    text.includes("星期一") &&
                    text.includes("上课时间") &&
                    text.includes("星期日")
                );
            });
            if (table) return table;
        }
        return null;
    }

    function getTableDiagnostics() {
        return getCandidateDocuments()
            .map((doc, index) => {
                const tableCount = doc.querySelectorAll("table").length;
                return `文档${index + 1}：${doc.title || "无标题"}，URL：${doc.location?.href || "未知"}，表格数量：${tableCount}`;
            })
            .join("；");
    }

    async function waitForScheduleTable(timeoutMs = 5000) {
        const startedAt = Date.now();
        let table = findScheduleTable();
        while (!table && Date.now() - startedAt < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            table = findScheduleTable();
        }
        return table;
    }

    function sameCourseForMerge(a, b) {
        return (
            a.day === b.day &&
            a.courseCode === b.courseCode &&
            a.name === b.name &&
            a.teacher === b.teacher &&
            a.position === b.position &&
            a.weeks.join(",") === b.weeks.join(",")
        );
    }

    function mergeContinuousCourses(courseRows) {
        const merged = [];
        const sorted = courseRows.slice().sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            if (a.startSection !== b.startSection)
                return a.startSection - b.startSection;
            return a.name.localeCompare(b.name, "zh-Hans-CN");
        });

        sorted.forEach((course) => {
            const last = merged[merged.length - 1];
            if (
                last &&
                sameCourseForMerge(last, course) &&
                course.startSection === last.endSection + 1
            ) {
                last.endSection = course.endSection;
            } else {
                merged.push({ ...course });
            }
        });

        return merged.map(({ courseCode, ...course }) => course);
    }

    async function parseScheduleTable() {
        const table = await waitForScheduleTable();
        if (!table) {
            throw new Error(
                `未找到课表表格，请确认已进入 VATUU 本学期课表页面并等待课表加载完成。${getTableDiagnostics()}`,
            );
        }

        const rows = Array.from(table.querySelectorAll("tr")).slice(1);
        const courseRows = [];

        rows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            if (cells.length < 9) return;

            const section = Number(
                normalizeText(cells[0].textContent).match(/\d+/)?.[0],
            );
            if (!Number.isFinite(section)) return;

            for (let day = 1; day <= 7; day++) {
                const cell = cells[day + 1];
                parseCoursesFromCell(cell).forEach((course) => {
                    courseRows.push({
                        ...course,
                        day,
                        startSection: section,
                        endSection: section,
                    });
                });
            }
        });

        return mergeContinuousCourses(courseRows);
    }

    function collectUnscheduledCourses() {
        const marker = "以下课程由于未安排具体节次时间，无法显示";
        const text = getCandidateDocuments()
            .map((doc) => normalizeText(doc.body?.textContent || ""))
            .find((docText) => docText.includes(marker));
        if (!text) return [];

        return text
            .slice(text.indexOf(marker) + marker.length)
            .split(/(?=[A-Z]+\d+\s+)/)
            .map(normalizeText)
            .filter((line) => /^[A-Z]+\d+\s+/.test(line));
    }

    async function importSwjtuSchedule() {
        try {
            window.shiguangBridge.showToast("正在解析西南交通大学 VATUU 课表...");

            const courses = await parseScheduleTable();
            if (courses.length === 0) {
                await window.shiguangBridgePromise.showAlert(
                    "导入失败",
                    "未解析到课程。请确认当前页面为本学期课表，并选择“全部周次”。",
                    "确定",
                );
                return false;
            }

            await window.shiguangBridgePromise.saveCourseConfig(
                JSON.stringify(SWJTU_COURSE_CONFIG),
            );
            await window.shiguangBridgePromise.savePresetTimeSlots(
                JSON.stringify(SWJTU_TIME_SLOTS),
            );
            await window.shiguangBridgePromise.saveImportedCourses(
                JSON.stringify(courses),
            );

            const unscheduledCourses = collectUnscheduledCourses();
            if (unscheduledCourses.length > 0) {
                window.shiguangBridge.showToast(
                    `成功导入 ${courses.length} 条课程，另有 ${unscheduledCourses.length} 门无节次课程已跳过`,
                );
            } else {
                window.shiguangBridge.showToast(`成功导入 ${courses.length} 条课程`);
            }

            window.shiguangBridge.notifyTaskCompletion();
            return true;
        } catch (error) {
            console.error("SWJTU VATUU 课表导入失败：", error);
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                `解析或保存课表失败：${error.message}`,
                "确定",
            );
            return false;
        }
    }

    void importSwjtuSchedule();
})();
