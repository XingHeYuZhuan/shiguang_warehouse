function scheduleHtmlProvider() {
    const table = document.getElementById('kbtable');
    if (!table) {
        alert("未找到课表表格，请确保当前处于[学生个人课表]页面");
        return "";
    }
    return table.outerHTML;
}

function scheduleHtmlParser(html) {
    function cleanText(value) {
        return (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }

    function parseWeeks(text) {
        const raw = cleanText(text).replace("周", "");
        if (!raw) return [];
        const parity = raw.includes("单") ? "odd" : raw.includes("双") ? "even" : "all";
        const weeks = [];
        raw.replace(/[（(].*?[）)]/g, "").split(/[,\，、]/).forEach(part => {
            const rangeMatch = part.match(/^(\d+)\s*[-－~～]\s*(\d+)$/);
            if (rangeMatch) {
                for (let i = Number(rangeMatch[1]); i <= Number(rangeMatch[2]); i++) {
                    if (parity === "odd" && i % 2 === 0) continue;
                    if (parity === "even" && i % 2 !== 0) continue;
                    weeks.push(i);
                }
            } else if (/^\d+$/.test(part)) {
                weeks.push(Number(part));
            }
        });
        return [...new Set(weeks)].sort((a, b) => a - b);
    }

    function parsePeriods(text) {
        const nums = cleanText(text).match(/\d+/g) || [];
        if (nums.length === 0) return [];
        const start = Number(nums[0]), end = Number(nums[nums.length - 1]);
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }

    const resultCourses = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    let isFirstRow = true;

    while ((trMatch = trRegex.exec(html)) !== null) {
        if (isFirstRow) {
            isFirstRow = false;
            continue;
        }
        const rowHtml = trMatch[1];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const tds = [];
        let tdMatch;
        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
            tds.push(tdMatch[1]);
        }
        
        if (tds.length < 2) continue;

        const periodText = tds[0].replace(/<[^>]+>/g, "");
        if (!/\d+/.test(periodText)) continue;
        const sections = parsePeriods(periodText);

        for (let col = 1; col <= 7; col++) {
            const cellHtml = tds[col];
            if (!cellHtml) continue;

            const kbcontentMatch = cellHtml.match(/<div[^>]*class=["']kbcontent["'][^>]*>([\s\S]*?)<\/div>/i);
            if (!kbcontentMatch) continue;
            
            const kbcontent = kbcontentMatch[1];
            if (!kbcontent || kbcontent.includes("&nbsp;")) continue;

            const segments = kbcontent.split(/<br\s*\/?>\s*[-]{5,}\s*<br\s*\/?>|<br\s*\/?>\s*[-]{5,}/i);
            
            segments.forEach(seg => {
                let name = seg.split(/<br\s*\/?>/i)[0] || "";
                name = cleanText(name.replace(/<[^>]+>/g, ""));
                if (!name) return;

                const course = { name: name, teacher: "", position: "", weeks: [], day: col, sections: sections };

                const fontRegex = /<font[^>]*title=["']([^"']+)["'][^>]*>([\s\S]*?)<\/font>/gi;
                let fontMatch;
                while ((fontMatch = fontRegex.exec(seg)) !== null) {
                    const title = fontMatch[1];
                    const content = cleanText(fontMatch[2].replace(/<[^>]+>/g, ""));
                    
                    if (title === '老师') course.teacher = content;
                    else if (title === '周次(节次)') course.weeks = parseWeeks(content);
                    else if (title === '教室') course.position = content;
                }
                resultCourses.push(course);
            });
        }
    }
    return resultCourses;
}