// 适配目标：武汉商学院-超星综合教学管理系统

(function () {
    function toast(message) {
        if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
            window.shiguangBridge.showToast(message);
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function getTargetDocument() {
        if (location.href.includes("queryKbForXsd")) {
            return document;
        }

        const iframe = document.querySelector("iframe[src*='queryKbForXsd']");
        if (!iframe) return null;

        for (let i = 0; i < 20; i += 1) {
            try {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (doc && doc.readyState && doc.readyState !== "loading") {
                    return doc;
                }
            } catch (e) {
                // ignore
            }
            await sleep(500);
        }
        return null;
    }

    async function waitForScheduleData(doc, timeoutMs = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const cells = Array.from(doc.querySelectorAll("td.cell, td[id^='Cell']"));
            const filled = cells.filter((cell) => {
                const text = (cell.innerText || cell.textContent || "").trim();
                return text.length > 0 && /周/.test(text);
            });
            if (filled.length > 0) {
                return true;
            }
            await sleep(500);
        }
        return false;
    }

    function uniqueSortedNumbers(nums) {
        const set = new Set(nums.filter((n) => Number.isFinite(n)));
        return Array.from(set).sort((a, b) => a - b);
    }

    function parseWeekText(weekText) {
        if (!weekText) return [];
        let text = String(weekText).trim();
        if (!text) return [];

        let oddOnly = false;
        let evenOnly = false;
        if (text.includes("单")) oddOnly = true;
        if (text.includes("双")) evenOnly = true;

        text = text.replace(/周/g, "");
        text = text.replace(/\s+/g, "");
        text = text.replace(/\(.*?\)/g, "");
        text = text.replace(/（.*?）/g, "");

        const weeks = [];
        const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
        segments.forEach((seg) => {
            if (!seg) return;
            const rangeMatch = seg.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (!Number.isFinite(start) || !Number.isFinite(end)) return;
                for (let w = start; w <= end; w += 1) {
                    weeks.push(w);
                }
                return;
            }
            const single = parseInt(seg, 10);
            if (Number.isFinite(single)) weeks.push(single);
        });

        let filtered = weeks;
        if (oddOnly && !evenOnly) {
            filtered = weeks.filter((w) => w % 2 === 1);
        } else if (evenOnly && !oddOnly) {
            filtered = weeks.filter((w) => w % 2 === 0);
        }

        return uniqueSortedNumbers(filtered);
    }

    function splitCourseBlocks(cellText) {
        const text = cellText.replace(/\r/g, "").trim();
        if (!text) return [];
        return text
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);
    }

    function extractWeeksTextFromLine(line) {
        if (!line) return { weeksText: "", rest: line || "" };
        const match = line.match(/(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\s*(?:\((单|双)\))?\s*周/);
        if (!match) return { weeksText: "", rest: line };
        const weeksCore = match[1];
        const oddEven = match[2] ? `(${match[2]})` : "";
        const weeksText = `${weeksCore}${oddEven}周`;
        const rest = line.replace(match[0], "").trim();
        return { weeksText, rest };
    }

    function parseCourseBlock(block) {
        const lines = block
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (!lines.length) return null;

        const name = lines[0] || "";
        let teacher = "";
        let weeksText = "";
        let position = "";

        const weekLineIndex = lines.findIndex((l) => /周/.test(l));
        if (weekLineIndex >= 0) {
            const { weeksText: extractedWeeks, rest } = extractWeeksTextFromLine(
                lines[weekLineIndex]
            );
            weeksText = extractedWeeks;
            if (weekLineIndex === 1) {
                teacher = rest || lines[1];
            }
        }

        if (!teacher && lines.length > 1) {
            teacher = lines[1];
            const { weeksText: extractedWeeks, rest } = extractWeeksTextFromLine(teacher);
            if (extractedWeeks) {
                weeksText = weeksText || extractedWeeks;
                teacher = rest;
            }
        }

        if (!weeksText) {
            for (const line of lines) {
                const { weeksText: extractedWeeks } = extractWeeksTextFromLine(line);
                if (extractedWeeks) {
                    weeksText = extractedWeeks;
                    break;
                }
            }
        }

        if (weekLineIndex >= 0 && weekLineIndex + 1 < lines.length) {
            position = lines[weekLineIndex + 1];
        }
        if (!position) {
            position =
                lines.find((l) => l !== name && l !== teacher && !/周/.test(l)) || "";
        }

        return {
            name: name || "未知课程",
            teacher: teacher || "",
            weeksText,
            position: position || "",
        };
    }

    function padTime(value) {
        const text = String(value || "").trim();
        const match = text.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return text;
        const h = match[1].padStart(2, "0");
        return `${h}:${match[2]}`;
    }

    function randomColor() {
        return Math.floor(Math.random() * 12) + 1;
    }

    function createId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }

    function mergeCourses(courses) {
        const byKey = new Map();
        courses.forEach((course) => {
            const weeksKey = (course.weeks || []).join(",");
            const key = [course.name, course.teacher, course.position, course.day, weeksKey].join("|");
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push({ ...course });
        });

        const merged = [];
        byKey.forEach((items) => {
            items.sort((a, b) => a.startSection - b.startSection);
            let current = null;
            items.forEach((item) => {
                if (!current) {
                    current = { ...item };
                    return;
                }
                if (item.startSection === current.endSection + 1) {
                    current.endSection = Math.max(current.endSection, item.endSection);
                } else {
                    merged.push(current);
                    current = { ...item };
                }
            });
            if (current) merged.push(current);
        });

        return merged;
    }

    function parseScheduleFromDocument(doc) {
        const cells = Array.from(doc.querySelectorAll("td.cell"));
        const fallbackCells = cells.length ? [] : Array.from(doc.querySelectorAll("td[id^='Cell']"));
        const targetCells = cells.length ? cells : fallbackCells;
        const courses = [];
        const seen = new Set();

        targetCells.forEach((cell) => {
            const id = cell.getAttribute("id") || "";
            const match = id.match(/^Cell(\d)(\d{1,2})$/);
            if (!match) return;

            const day = parseInt(match[1], 10);
            const startSection = parseInt(match[2], 10);
            const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);
            const endSection = startSection + Math.max(rowspan, 1) - 1;

            const blocks = splitCourseBlocks(cell.innerText || "");
            blocks.forEach((blockText) => {
                const parsed = parseCourseBlock(blockText);
                if (!parsed) return;
                const weeks = parseWeekText(parsed.weeksText);
                if (!weeks.length) return;

                const key = [
                    parsed.name,
                    parsed.teacher,
                    parsed.position,
                    day,
                    startSection,
                    endSection,
                    weeks.join(","),
                ].join("|");
                if (seen.has(key)) return;
                seen.add(key);

                courses.push({
                    id: createId(),
                    name: parsed.name,
                    teacher: parsed.teacher,
                    position: parsed.position,
                    day,
                    startSection,
                    endSection,
                    color: randomColor(),
                    weeks,
                });
            });
        });

        return mergeCourses(courses);
    }

    function parseTimeSlots(doc) {
        const slots = [];
        const seenNumbers = new Set();
        const timeRegex = /(\d{1,2}:\d{2})/g;

        const timeCells = Array.from(
            doc.querySelectorAll("td[data-jcindex], td[data-jcIndex]")
        );

        timeCells.forEach((cell) => {
            const text = (cell.innerText || cell.textContent || "").trim();
            if (!text) return;

            const indexAttr = cell.getAttribute("data-jcindex") || cell.getAttribute("data-jcIndex");
            const numberMatch = text.match(/^(\d{1,2})/);
            const number = parseInt(indexAttr || (numberMatch && numberMatch[1]) || "", 10);
            if (!Number.isFinite(number)) return;

            const times = text.match(timeRegex) || [];
            if (times.length < 2) return;

            if (seenNumbers.has(number)) return;
            seenNumbers.add(number);

            slots.push({
                number,
                startTime: padTime(times[0]),
                endTime: padTime(times[1]),
            });
        });

        return slots.sort((a, b) => a.number - b.number);
    }

    async function run() {
        toast("开始解析课表...");
        const doc = await getTargetDocument();
        if (!doc) {
            toast("未找到课表页面 iframe");
            return;
        }

        await waitForScheduleData(doc);

        const courses = parseScheduleFromDocument(doc);
        const timeSlots = parseTimeSlots(doc);

        if (!courses.length) {
            toast("未解析到课程，请确认课表已加载完成");
            return;
        }

        try {
            const result = await window.shiguangBridgePromise.saveImportedCourses(
                JSON.stringify(courses)
            );
            if (result === true) {
                if (timeSlots.length) {
                    await window.shiguangBridgePromise.savePresetTimeSlots(
                        JSON.stringify(timeSlots)
                    );
                }
                toast("课表导出成功");
                window.shiguangBridge.notifyTaskCompletion();
            } else {
                toast("课表导出失败，请查看控制台日志");
            }
        } catch (error) {
            toast("导出失败: " + error.message);
        }
    }

    run();
})();
