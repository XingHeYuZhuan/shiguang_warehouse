function parseWeeks(weekStr) {
    const weeks = [];
    weekStr.split(',').forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            const w = parseInt(part);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    return weeks;
}

async function fetchAndParseCourses() {
    const rawItems = [];
    
    function findTable(win) {
        const t = Array.from(win.document.querySelectorAll('table')).find(x => x.innerText.includes("星期一") && x.innerText.includes("["));
        if (t) return t;
        for (let i = 0; i < win.frames.length; i++) {
            try { const st = findTable(win.frames[i]); if (st) return st; } catch (e) {}
        }
        return null;
    }
    
    const table = findTable(window);
    if (!table) return null;

    Array.from(table.rows).forEach(row => {
        const cells = Array.from(row.cells);
        if (cells.length < 7) return;
        cells.forEach((cell, colIndex) => {
            const distanceToLast = cells.length - 1 - colIndex;
            if (distanceToLast > 6) return;
            const day = 7 - distanceToLast;
            const rawText = cell.innerText.trim();
            if (!rawText.includes('[')) return;

            const lines = rawText.split('\n').map(l => l.trim()).filter(l => l);
            lines.forEach((line, i) => {
                const match = line.match(/([\d\-,]+)\[(\d+)-(\d+)\]/);
                if (match) {
                    let name = "未知课程";
                    if (i >= 2) name = lines[i-2];
                    else if (i >= 1) name = lines[i-1];
                    let teacher = (i >= 1 && !lines[i-1].includes('[')) ? lines[i-1] : "未知教师";
                    let position = (i < lines.length - 1) ? lines[i+1] : "未知地点";

                    rawItems.push({
                        name: name.replace(/\s/g, ""),
                        teacher: teacher.replace(/\s/g, ""),
                        position: position.replace(/\s/g, ""),
                        day: day,
                        startSection: parseInt(match[2]),
                        endSection: parseInt(match[3]),
                        weeks: parseWeeks(match[1])
                    });
                }
            });
        });
    });

    const groupMap = new Map();
    rawItems.forEach(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
        if (!groupMap.has(key)) groupMap.set(key, {});
        const weekMap = groupMap.get(key);
        item.weeks.forEach(w => {
            if (!weekMap[w]) weekMap[w] = new Set();
            for (let s = item.startSection; s <= item.endSection; s++) {
                weekMap[w].add(s);
            }
        });
    });

    const finalCourses = [];
    groupMap.forEach((weekMap, key) => {
        const [name, teacher, position, day] = key.split('|');
        const patternMap = new Map();
        
        Object.keys(weekMap).forEach(w => {
            const week = parseInt(w);
            const sections = Array.from(weekMap[week]).sort((a, b) => a - b);
            if (sections.length === 0) return;
            
            let start = sections[0];
            for (let i = 0; i < sections.length; i++) {
                if (i === sections.length - 1 || sections[i+1] !== sections[i] + 1) {
                    const pKey = `${start}-${sections[i]}`;
                    if (!patternMap.has(pKey)) patternMap.set(pKey, []);
                    patternMap.get(pKey).push(week);
                    if (i < sections.length - 1) start = sections[i+1];
                }
            }
        });
        
        patternMap.forEach((weeks, pKey) => {
            const [sStart, sEnd] = pKey.split('-').map(Number);
            finalCourses.push({
                name, teacher, position,
                day: parseInt(day),
                startSection: sStart,
                endSection: sEnd,
                weeks: weeks.sort((a, b) => a - b)
            });
        });
    });
    return finalCourses;
}

async function runImportFlow() {
    try {
        const courses = await fetchAndParseCourses();
        if (!courses || courses.length === 0) return;
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        AndroidBridge.notifyTaskCompletion();
    } catch (error) {}
}

runImportFlow();
