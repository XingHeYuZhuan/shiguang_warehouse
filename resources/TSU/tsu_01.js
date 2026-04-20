async function startImport() {
    let courses = [];
    try {
        let table = document.getElementById("mytable");
        if (!table) return;

        let trs = table.getElementsByTagName("tr");
        for (let i = 0; i < trs.length; i++) {
            let tr = trs[i];
            if (tr.classList.contains("H")) continue;
            
            let tds = Array.from(tr.querySelectorAll("td.td"));
            for (let dayIndex = 0; dayIndex < tds.length && dayIndex < 7; dayIndex++) {
                let td = tds[dayIndex];
                let currentDay = dayIndex + 1;
                
                let courseDivs = td.querySelectorAll("div[style*='padding-bottom:5px']");
                courseDivs.forEach(div => {
                    let parts = div.innerHTML.split(/<br\s*\/?>/i);
                    if (parts.length >= 4) {
                        let courseName = stripTags(parts[0]);
                        let teacher = stripTags(parts[1]);
                        let timeStr = stripTags(parts[2]);
                        let room = stripTags(parts[3]);
                        
                        let parsedList = parseTimeAndGenerateModels(timeStr, courseName, teacher, room, currentDay);
                        courses = courses.concat(parsedList);
                    }
                });
            }
        }

        if (courses.length > 0) {
            const saveResult = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
            if (saveResult === true) {
                AndroidBridge.notifyTaskCompletion();
            }
        }
    } catch (error) {}
}

function parseTimeAndGenerateModels(timeStr, name, teacher, room, day) {
    let results = [];
    let m = timeStr.match(/^(.*?)\s*\[(\d+)(?:-(\d+))?\]\s*$/);
    if (!m) return results;
    
    let weekPart = m[1].trim(); 
    let startSection = parseInt(m[2], 10);
    let endSection = m[3] ? parseInt(m[3], 10) : startSection;
    
    let weekType = 0;
    if (/双/.test(weekPart)) {
        weekType = 2;
        weekPart = weekPart.replace(/双/g, '').trim();
    } else if (/单/.test(weekPart)) {
        weekType = 1;
        weekPart = weekPart.replace(/单/g, '').trim();
    }
    
    let weeksArray = [];
    let segments = weekPart.split(/[,，]/);
    for (let seg of segments) {
        seg = seg.trim();
        if (!seg) continue;
        
        let rangeMatch = seg.match(/^(\d+)(?:-(\d+))?$/);
        if (!rangeMatch) continue;
        
        let startWeek = parseInt(rangeMatch[1], 10);
        let endWeek = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startWeek;
        
        for (let w = startWeek; w <= endWeek; w++) {
            if (weekType === 1 && w % 2 === 0) continue;
            if (weekType === 2 && w % 2 !== 0) continue;
            if (!weeksArray.includes(w)) weeksArray.push(w);
        }
    }
    
    if (weeksArray.length > 0) {
        weeksArray.sort((a, b) => a - b);
        results.push({
            name: name,
            teacher: teacher,
            position: room,
            day: day,                      
            startSection: startSection,    
            endSection: endSection,        
            weeks: weeksArray              
        });
    }
    return results;
}

function stripTags(s) {
    return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

startImport();
