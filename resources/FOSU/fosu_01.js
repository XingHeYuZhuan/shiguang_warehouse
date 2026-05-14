/**
 * 佛山大学强智教务系统适配
 * @since 2026-5-14
 * @description 支持课程表导入，需要校园网访问
 * @author e7g
 * @version 1.0
 */

function parseWeeksString(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    
    const cleanStr = weekStr.replace(/\(周\)/g, '').replace(/周/g, '').trim();
    
    const parts = cleanStr.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
            const [start, end] = trimmed.split('-').map(s => parseInt(s.trim(), 10));
            if (!isNaN(start) && !isNaN(end)) {
                for (let w = start; w <= end; w++) {
                    weeks.push(w);
                }
            }
        } else {
            const week = parseInt(trimmed, 10);
            if (!isNaN(week)) {
                weeks.push(week);
            }
        }
    }
    
    return weeks.sort((a, b) => a - b);
}

function parseSectionFromText(text) {
    const match = text.match(/\[(\d+)-(\d+)(?:-\d+)*\]节/);
    if (match) {
        return {
            start: parseInt(match[1], 10),
            end: parseInt(match[2], 10)
        };
    }
    return null;
}

function parseCourseFromDiv(divContent, dayIndex, sectionIndex) {
    const courses = [];
    
    if (!divContent || divContent.includes('&nbsp;') || divContent.trim() === '') {
        return courses;
    }
    
    const courseBlocks = divContent.split(/-----------------+/);
    
    for (const block of courseBlocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock || trimmedBlock.includes('&nbsp;')) continue;
        
        const lines = trimmedBlock.split('<br>').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) continue;
        
        let courseName = '';
        let teacher = '';
        let position = '';
        let weeks = [];
        let startSection = sectionIndex * 2 - 1;
        let endSection = sectionIndex * 2;
        
        courseName = lines[0].replace(/<[^>]*>/g, '').trim();
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('title="老师"')) {
                const match = line.match(/<font[^>]*>([^<]*)<\/font>/);
                if (match) {
                    teacher = match[1].trim();
                }
            } else if (line.includes('title="周次(节次)"')) {
                const match = line.match(/<font[^>]*>([^<]*)<\/font>/);
                if (match) {
                    weeks = parseWeeksString(match[1]);
                }
            } else if (line.includes('title="教室"')) {
                const match = line.match(/<font[^>]*>([^<]*)<\/font>/);
                if (match) {
                    position = match[1].trim();
                    const sectionMatch = parseSectionFromText(match[1]);
                    if (sectionMatch) {
                        startSection = sectionMatch.start;
                        endSection = sectionMatch.end;
                        position = position.replace(/\[\d+-\d+(?:-\d+)*\]节/g, '').trim();
                    }
                }
            }
        }
        
        if (courseName && weeks.length > 0) {
            courses.push({
                name: courseName,
                teacher: teacher,
                position: position,
                day: dayIndex,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }
    }
    
    return courses;
}

function parseHtmlTable(htmlContent) {
    const courses = [];
    
    const tableMatch = htmlContent.match(/<table[^>]*id="kbtable"[^>]*>[\s\S]*?<\/table>/i);
    if (!tableMatch) {
        console.error('未找到课程表格');
        return courses;
    }
    
    const tableHtml = tableMatch[0];
    
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = tableHtml.match(rowRegex) || [];
    
    let sectionIndex = 0;
    
    for (const row of rows) {
        if (row.includes('星期一') || row.includes('备注')) {
            continue;
        }
        
        const thMatch = row.match(/<th[^>]*>[\s\S]*?第(\S+)大节[\s\S]*?<\/th>/i);
        if (thMatch) {
            const sectionNames = ['一', '二', '三', '四', '五', '六'];
            sectionIndex = sectionNames.indexOf(thMatch[1]) + 1;
        }
        
        if (sectionIndex === 0) continue;
        
        const cellRegex = /<td[^>]*>[\s\S]*?<\/td>/gi;
        const cells = row.match(cellRegex) || [];
        
        let dayIndex = 1;
        
        for (const cell of cells) {
            const kbcontentRegex = /<div[^>]*class="kbcontent"[^>]*>[\s\S]*?<\/div>/gi;
            const kbcontentDivs = cell.match(kbcontentRegex) || [];
            
            for (const div of kbcontentDivs) {
                const contentMatch = div.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
                if (contentMatch) {
                    const divContent = contentMatch[1];
                    const parsedCourses = parseCourseFromDiv(divContent, dayIndex, sectionIndex);
                    courses.push(...parsedCourses);
                }
            }
            
            if (kbcontentDivs.length === 0) {
                const kbcontent1Regex = /<div[^>]*class="kbcontent1"[^>]*>[\s\S]*?<\/div>/gi;
                const kbcontent1Divs = cell.match(kbcontent1Regex) || [];
                
                for (const div of kbcontent1Divs) {
                    const contentMatch = div.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
                    if (contentMatch) {
                        const divContent = contentMatch[1];
                        const parsedCourses = parseCourseFromDiv(divContent, dayIndex, sectionIndex);
                        courses.push(...parsedCourses);
                    }
                }
            }
            
            dayIndex++;
        }
    }
    
    return courses;
}

function mergeSameCourses(courses) {
    const courseMap = new Map();
    
    for (const course of courses) {
        const key = `${course.name}-${course.teacher}-${course.position}-${course.day}`;
        
        if (courseMap.has(key)) {
            const existing = courseMap.get(key);
            for (const week of course.weeks) {
                if (!existing.weeks.includes(week)) {
                    existing.weeks.push(week);
                }
            }
            existing.startSection = Math.min(existing.startSection, course.startSection);
            existing.endSection = Math.max(existing.endSection, course.endSection);
        } else {
            courseMap.set(key, { ...course, weeks: [...course.weeks] });
        }
    }
    
    return Array.from(courseMap.values()).map(c => ({
        ...c,
        weeks: c.weeks.sort((a, b) => a - b)
    }));
}

async function parseAndImportCourses() {
    const tableElement = document.querySelector('table#kbtable');
    
    if (!tableElement) {
        console.error('未找到课程表格元素 #kbtable');
        AndroidBridge.showToast('未找到课程表格，请确保在正确的页面！');
        return false;
    }
    
    const htmlContent = tableElement.outerHTML;
    console.log('找到课程表格，开始解析...');
    
    let courses = parseHtmlTable(htmlContent);
    console.log(`解析到 ${courses.length} 条课程记录`);
    
    courses = mergeSameCourses(courses);
    console.log(`合并后 ${courses.length} 条课程记录`);
    
    console.log('解析结果:', JSON.stringify(courses, null, 2));
    
    try {
        const result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            console.log('课程导入成功！');
            AndroidBridge.showToast(`成功导入 ${courses.length} 门课程！`);
            return true;
        } else {
            console.log('课程导入失败，结果：' + result);
            AndroidBridge.showToast('课程导入失败，请查看日志。');
            return false;
        }
    } catch (error) {
        console.error('导入课程时发生错误:', error);
        AndroidBridge.showToast('导入课程失败: ' + error.message);
        return false;
    }
}

async function importPresetTimeSlots() {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:40" },
        { "number": 2, "startTime": "08:45", "endTime": "09:25" },
        { "number": 3, "startTime": "09:40", "endTime": "10:20" },
        { "number": 4, "startTime": "10:25", "endTime": "11:05" },
        { "number": 5, "startTime": "11:10", "endTime": "11:50" },
        { "number": 6, "startTime": "13:30", "endTime": "14:10" },
        { "number": 7, "startTime": "14:15", "endTime": "14:55" },
        { "number": 8, "startTime": "15:10", "endTime": "15:50" },
        { "number": 9, "startTime": "15:55", "endTime": "16:35" },
        { "number": 10, "startTime": "16:40", "endTime": "17:20" },
        { "number": 11, "startTime": "18:30", "endTime": "19:10" },
        { "number": 12, "startTime": "19:15", "endTime": "19:55" },
        { "number": 13, "startTime": "20:05", "endTime": "20:45" },
        { "number": 14, "startTime": "20:50", "endTime": "21:30" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.AndroidBridge.showToast("时间段导入成功！");
            return true;
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.AndroidBridge.showToast("时间段导入失败，请查看日志。");
            return false;
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.AndroidBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

function parseSemesterInfo() {
    const semesterSelect = document.querySelector('select#xnxq01id');
    if (!semesterSelect) {
        console.warn('未找到学期选择框');
        return { semester: '2025-2026-2', totalWeeks: 19 };
    }
    
    const selectedOption = semesterSelect.querySelector('option[selected]');
    const semesterValue = selectedOption ? selectedOption.value : semesterSelect.value;
    
    console.log('当前学期:', semesterValue);
    
    const match = semesterValue.match(/(\d{4})-(\d{4})-(\d)/);
    if (!match) {
        return { semester: semesterValue, totalWeeks: 19 };
    }
    
    const [, startYear, endYear, semesterNum] = match;
    let startDate;
    
    function adjustToMonday(date) {
        let dayOfWeek = date.getDay();
        if (dayOfWeek === 0) {
            date.setDate(date.getDate() + 1);
        } else if (dayOfWeek !== 1) {
            date.setDate(date.getDate() - (dayOfWeek - 1));
        }
        return date;
    }
    
    if (semesterNum === '1') {
        const year = parseInt(startYear);
        startDate = adjustToMonday(new Date(year, 8, 8));
    } else {
        const year = parseInt(endYear);
        startDate = adjustToMonday(new Date(year, 2, 8));
    }
    
    const formattedDate = startDate.toISOString().split('T')[0];
    
    return {
        semester: semesterValue,
        startDate: formattedDate,
        totalWeeks: 19
    };
}

async function saveCourseConfig() {
    console.log("正在准备配置数据...");
    
    const semesterInfo = parseSemesterInfo();
    console.log('学期信息:', semesterInfo);
    
    const courseConfigData = {
        "semesterStartDate": semesterInfo.startDate || "2026-02-24",
        "semesterTotalWeeks": semesterInfo.totalWeeks,
        "defaultClassDuration": 40,
        "defaultBreakDuration": 5,
        "firstDayOfWeek": 1
    };

    try {
        console.log("正在尝试导入课表配置...");
        console.log("配置数据:", JSON.stringify(courseConfigData, null, 2));
        const configJsonString = JSON.stringify(courseConfigData);

        const result = await window.AndroidBridgePromise.saveCourseConfig(configJsonString);

        if (result === true) {
            console.log("课表配置导入成功！");
            AndroidBridge.showToast(`配置导入成功！学期: ${semesterInfo.semester}, 开学: ${courseConfigData.semesterStartDate}`);
            return true;
        } else {
            console.log("课表配置导入未成功，结果：" + result);
            AndroidBridge.showToast("配置导入失败，请查看日志。");
            return false;
        }
    } catch (error) {
        console.error("导入配置时发生错误:", error);
        AndroidBridge.showToast("导入配置失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.AndroidBridgePromise.showAlert(
        "佛山大学教务系统课表导入",
        "【重要】本系统需要使用校园网访问，请确保已连接校园网后再操作。\n\n导入步骤：\n1. 登录教务系统\n2. 导航到【培养管理】→【学期理论课表】\n3. 确认课表已加载显示\n4. 点击确定开始导入",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        return;
    }

    AndroidBridge.showToast("开始解析课程表...");

    console.log("=== 开始课程表解析和导入流程 ===");

    const importResult = await parseAndImportCourses();
    if (!importResult) {
        console.log("课程导入失败或用户取消。");
        return;
    }

    console.log("课程导入完成。");
    AndroidBridge.showToast("课程导入完成！");

    await importPresetTimeSlots();
    await saveCourseConfig();

    console.log("=== 所有任务完成 ===");
    AndroidBridge.notifyTaskCompletion();
}

if (typeof AndroidBridge !== 'undefined' && AndroidBridge) {
    runImportFlow();
}
