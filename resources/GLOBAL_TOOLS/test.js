// 文件: school.js - 修复节次错误
// ==================== 验证函数 ====================
function validateDate(dateStr) {
    if (!dateStr || dateStr.trim().length === 0) {
        return "日期不能为空！";
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
        return "日期格式必须是 YYYY-MM-DD！";
    }
    const parts = dateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return "请输入有效的日期！";
    }
    return false;
}
function validateName(name) {
    if (name === null || name.trim().length === 0) {
        return "输入不能为空！";
    }
    if (name.length < 2) {
        return "至少需要2个字符！";
    }
    return false;
}
// ==================== 课表数据提取函数 ====================
/**
 * 从页面提取课表数据 - 修复节次错误
 */
function extractCourseData() {
    console.log("开始提取湖北汽车工业学院课表数据...");
    
    const courses = [];
    
    // 获取所有课表行 - 使用更精确的选择器
    const rows = document.querySelectorAll('.el-table__body-wrapper tbody tr');
    console.log(`找到 ${rows.length} 行课表数据`);
    
    // 获取时间标签，用于验证行对应的节次
    const timeLabels = document.querySelectorAll('.el-table__header-wrapper th .cell, .el-table__header-wrapper th span');
    console.log("时间标签:", Array.from(timeLabels).map(el => el.textContent));
    
    rows.forEach((row, rowIndex) => {
        // 获取该行的所有单元格
        const cells = row.querySelectorAll('td');
        
        // 从第1个单元格开始是周一至周日（跳过第0个时间单元格）
        for (let dayIndex = 1; dayIndex < cells.length; dayIndex++) {
            const cell = cells[dayIndex];
            
            // 星期映射修正：第1列=周一(0), 第2列=周二(1), ... 第7列=周日(6)
            const day = dayIndex - 1;
            
            // 查找单元格内的所有课程块 - 使用更通用的选择器
            const courseBlocks = cell.querySelectorAll('[class*="theory"], .theory, [class*="course"], div[style*="background"]');
            
            if (courseBlocks.length > 0) {
                courseBlocks.forEach(block => {
                    try {
                        const course = parseCourseBlock(block, day, rowIndex);
                        if (course) {
                            courses.push(course);
                        }
                    } catch (e) {
                        console.error("解析课程块失败:", e);
                    }
                });
            }
        }
    });
    
    // 如果没找到课程，尝试另一种选择器
    if (courses.length === 0) {
        console.log("尝试使用备用选择器...");
        const allCourseElements = document.querySelectorAll('[class*="theory"], .theory, [class*="course"]');
        console.log(`找到 ${allCourseElements.length} 个可能的课程元素`);
        
        allCourseElements.forEach(element => {
            // 尝试找到元素所在的单元格和行
            const td = element.closest('td');
            if (td) {
                const tr = td.closest('tr');
                if (tr) {
                    const rowIndex = Array.from(tr.parentNode.children).indexOf(tr);
                    const dayIndex = Array.from(td.parentNode.children).indexOf(td);
                    
                    if (dayIndex >= 1 && dayIndex <= 7) {
                        // 星期映射修正：第1列=周一(0), 第2列=周二(1), ... 第7列=周日(6)
                        const day = dayIndex - 1;
                        const course = parseCourseBlock(element, day, rowIndex);
                        if (course) {
                            courses.push(course);
                        }
                    }
                }
            }
        });
    }
    
    // 去重
    const uniqueCourses = removeDuplicates(courses);
    
    // 按星期和节次排序
    uniqueCourses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        return a.startSection - b.startSection;
    });
    
    console.log(`共提取到 ${uniqueCourses.length} 门课程`);
    uniqueCourses.forEach(c => {
        console.log(`星期${c.day+1}: ${c.name} - ${c.teacher} - ${c.position} - 第${c.startSection}-${c.endSection}节`);
    });
    
    return uniqueCourses;
}
/**
 * 解析课程块 - 修复节次映射
 */
function parseCourseBlock(block, day, rowIndex) {
    // 获取所有子元素
    const children = block.children;
    let name = '', teacher = '', position = '', weeks = [];
    
    // 方法1：通过子元素解析
    if (children.length >= 3) {
        // 课程名称通常在h3标签中
        const nameElement = block.querySelector('h3');
        if (nameElement) {
            name = nameElement.innerText.trim();
            // 只移除括号内是纯数字且不是课程名称标识的情况
            // 但保留(24)这种课程代码
            // 如果括号内是纯数字且长度大于2，可能是周次信息，否则保留
            name = name.replace(/[（(]\d+[）)]/g, function(match) {
                // 提取括号内的数字
                const num = match.replace(/[（()）]/g, '');
                // 如果数字大于30，可能是周次信息，移除；否则保留（如24是课程代码）
                if (parseInt(num) > 30) {
                    return '';
                }
                return match;
            }).trim();
        }
        
        // 教师信息通常在第一个p标签中
        const teacherElement = block.querySelector('p:first-child span:first-child, p:nth-child(1) span');
        if (teacherElement) {
            teacher = teacherElement.innerText.trim();
            // 移除课时信息（如"2H"）
            teacher = teacher.replace(/\d+H?$/, '').trim();
        }
        
        // 周次和教室信息通常在第二个p标签中
        const weekPositionElement = block.querySelector('p:nth-child(2) span, p:last-child span');
        if (weekPositionElement) {
            const text = weekPositionElement.innerText.trim();
            const result = parseWeekAndPosition(text);
            weeks = result.weeks;
            position = result.position;
        }
    }
    
    // 方法2：如果子元素解析失败，通过文本行解析
    if (!name || !teacher || !position) {
        const text = block.innerText;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length >= 3) {
            // 第1行：课程名称
            if (!name) {
                name = lines[0].trim();
                // 只移除括号内是纯数字且不是课程名称标识的情况
                name = name.replace(/[（(]\d+[）)]/g, function(match) {
                    const num = match.replace(/[（()）]/g, '');
                    if (parseInt(num) > 30) {
                        return '';
                    }
                    return match;
                }).trim();
            }
            
            // 第2行：教师信息
            if (!teacher && lines[1]) {
                teacher = lines[1].trim();
                teacher = teacher.replace(/\d+H?$/, '').trim();
            }
            
            // 第3行：周次和教室
            if (!position && lines[2]) {
                const result = parseWeekAndPosition(lines[2].trim());
                weeks = result.weeks;
                position = result.position;
            }
        }
    }
    
    // 如果还是没有找到教室，尝试从整个块中提取数字教室
    if (!position || position === '未知教室') {
        position = extractClassroom(block.innerText);
    }
    
    // 节次映射彻底修正：按行索引重新定义startSection和endSection
    let startSection, endSection;
    switch(rowIndex) {
        case 0: // 第1行：第1节
            startSection = 1;
            endSection = 1;
            break;
        case 1: // 第2行：第2节
            startSection = 2;
            endSection = 2;
            break;
        case 2: // 第3行：第3节
            startSection = 3;
            endSection = 3;
            break;
        case 3: // 第4行：第4节
            startSection = 4;
            endSection = 4;
            break;
        case 4: // 第5行：第5节
            startSection = 5;
            endSection = 5;
            break;
        case 5: // 第6行：第6节
            startSection = 6;
            endSection = 6;
            break;
        case 6: // 第7行：第7节
            startSection = 7;
            endSection = 7;
            break;
        case 7: // 第8行：第8节
            startSection = 8;
            endSection = 8;
            break;
        case 8: // 第9行：第9节
            startSection = 9;
            endSection = 9;
            break;
        case 9: // 第10行：第10节
            startSection = 10;
            endSection = 10;
            break;
        case 10: // 第11行：第11节
            startSection = 11;
            endSection = 11;
            break;
        default: // 默认第1节
            startSection = 1;
            endSection = 1;
    }
    
    // 检查是否有rowspan（连堂课程）- 修正连堂节次计算逻辑
    const td = block.closest('td');
    if (td) {
        const rowspan = td.getAttribute('rowspan');
        if (rowspan) {
            const span = parseInt(rowspan);
            if (span > 1) {
                // 连堂时，结束节次 = 开始节次 + 跨行数 - 1
                endSection = startSection + span - 1;
                // 限制节次最大值不超过11
                if (endSection > 11) endSection = 11;
            }
        }
    }
    
    // 只有提取到有效的课程名称才返回
    if (!name || name.includes('节') || name.length < 2 || name.includes('理论课')) {
        return null;
    }
    
    // 特殊处理体育课（可能没有教室）
    if (name.includes('体育') && position === '未知教室') {
        position = '操场';
    }
    
    const course = {
        name: name,
        teacher: teacher || '未知教师',
        position: position || '未知教室',
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks.length > 0 ? weeks : [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
        isCustomTime: false
    };
    
    return course;
}
/**
 * 解析周次和教室
 */
function parseWeekAndPosition(text) {
    let weeks = [];
    let position = '未知教室';
    
    if (!text) return { weeks, position };
    
    console.log("解析周次和教室:", text);
    
    // 匹配周次模式：如 "3-16周"、"1-12周"、"6-8周"
    const weekPattern = /(\d+-\d+周|\d+,\d+周|\d+周)/;
    const weekMatch = text.match(weekPattern);
    
    if (weekMatch) {
        const weekStr = weekMatch[1];
        weeks = parseWeeks(weekStr);
        
        // 剩余部分可能是教室
        let remaining = text.replace(weekStr, '').trim();
        
        // 如果剩余部分包含数字，很可能是教室
        if (remaining && /\d+/.test(remaining)) {
            position = remaining;
        } else {
            // 尝试从原文本中提取教室（通常是4位数字）
            const roomMatch = text.match(/\b\d{3,4}\b/);
            if (roomMatch) {
                position = roomMatch[0];
            }
        }
    } else {
        // 如果没有周次信息，直接尝试提取教室
        const roomMatch = text.match(/\b\d{3,4}\b/);
        if (roomMatch) {
            position = roomMatch[0];
            weeks = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
        }
    }
    
    // 清理教室字符串
    if (position && position !== '未知教室') {
        // 只保留数字
        position = position.replace(/[^\d]/g, '');
    }
    
    return { weeks, position };
}
/**
 * 从文本中提取教室
 */
function extractClassroom(text) {
    // 匹配常见的教室格式：1205、6604、1231、2303、6403、6212、2103、1233、6104、1203
    const roomPatterns = [
        /\b\d{4}\b/,           // 4位数字
        /\b\d{3}\b/,           // 3位数字
        /[0-9]{3,4}/           // 任意3-4位数字
    ];
    
    for (let pattern of roomPatterns) {
        const match = text.match(pattern);
        if (match) {
            return match[0];
        }
    }
    
    return '未知教室';
}
/**
 * 解析周次字符串
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return [];
    
    // 移除"周"字
    weekStr = weekStr.replace(/周/g, '').trim();
    
    try {
        if (weekStr.includes(',')) {
            weekStr.split(',').forEach(part => {
                if (part.includes('-')) {
                    const [start, end] = part.split('-').map(Number);
                    for (let i = start; i <= end; i++) weeks.push(i);
                } else {
                    const w = parseInt(part);
                    if (!isNaN(w)) weeks.push(w);
                }
            });
        } else if (weekStr.includes('-')) {
            const [start, end] = weekStr.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            const w = parseInt(weekStr);
            if (!isNaN(w)) weeks.push(w);
        }
    } catch (e) {
        console.error("解析周次失败:", weekStr, e);
    }
    
    return weeks.length > 0 ? weeks.sort((a,b) => a-b) : [];
}
/**
 * 去重
 */
function removeDuplicates(courses) {
    const seen = new Map();
    return courses.filter(course => {
        // 创建唯一键：课程名+教师+星期+开始节次
        const key = `${course.name}-${course.teacher}-${course.day}-${course.startSection}`;
        if (seen.has(key)) {
            return false;
        }
        seen.set(key, true);
        return true;
    });
}
/**
 * 提取学期信息
 */
function extractSemesterInfo() {
    return {
        semesterStartDate: "2026-03-01",
        semesterTotalWeeks: 20
    };
}
// ==================== 弹窗和导入函数 ====================
async function demoAlert() {
    try {
        const confirmed = await window.AndroidBridgePromise.showAlert(
            "📚 湖北汽车工业学院课表导入",
            "将提取当前页面的课表数据并导入到App\n\n" +
            "📌 请确认已在课表页面\n" +
            "📌 将提取所有可见课程",
            "开始导入",
            "取消"
        );
        return confirmed;
    } catch (error) {
        console.error("显示弹窗错误:", error);
        return false;
    }
}
async function demoPrompt() {
    try {
        const semesterInfo = extractSemesterInfo();
        const semesterStart = await window.AndroidBridgePromise.showPrompt(
            "📅 设置开学日期",
            "请输入本学期开学日期",
            semesterInfo.semesterStartDate,
            "validateDate"
        );
        return semesterStart || semesterInfo.semesterStartDate;
    } catch (error) {
        console.error("日期输入错误:", error);
        return "2026-03-01";
    }
}
/**
 * 导入预设时间段 - 新增函数
 * 用于导入测试用的11个时间段（每个时间段1分钟）
 */
async function importPresetTimeSlots() {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:10", "endTime": "08:55" },
        { "number": 2, "startTime": "09:00", "endTime": "09:45" },
        { "number": 3, "startTime": "10:05", "endTime": "10:50" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:30", "endTime": "15:15" },
        { "number": 6, "startTime": "15:20", "endTime": "16:05" },
        { "number": 7, "startTime": "16:25", "endTime": "17:10" },
        { "number": 8, "startTime": "17:15", "endTime": "18:00" },
        { "number": 9, "startTime": "18:45", "endTime": "19:30" },
        { "number": 10, "startTime": "19:35", "endTime": "20:20" },
        { "number": 11, "startTime": "20:25", "endTime": "21:10" }
    ];
    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.AndroidBridge.showToast("测试时间段导入成功！");
            return true;
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.AndroidBridge.showToast("测试时间段导入失败，请查看日志。");
            return false;
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.AndroidBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}
async function importSchedule() {
    try {
        AndroidBridge.showToast("正在提取课表数据...");
        
        const courses = extractCourseData();
        
        if (courses.length === 0) {
            await window.AndroidBridgePromise.showAlert(
                "⚠️ 提取失败",
                "未找到课表数据，请确认已在课表页面",
                "知道了"
            );
            return false;
        }
        
        // 预览
        const preview = await window.AndroidBridgePromise.showAlert(
            "📊 数据预览",
            `共找到 ${courses.length} 门课程\n\n` +
            `示例:\n${courses.slice(0, 5).map(c => 
                `• 周${c.day+1} ${c.name} - 第${c.startSection}-${c.endSection}节`
            ).join('\n')}`,
            "确认导入",
            "取消"
        );
        
        if (!preview) {
            return false;
        }
        
        // 导入课程
        AndroidBridge.showToast("正在导入课程...");
        const result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        if (result === true) {
            const semesterDate = await demoPrompt();
            const configResult = await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify({
                semesterStartDate: semesterDate,
                semesterTotalWeeks: 20,
                defaultClassDuration: 45,
                defaultBreakDuration: 10,
                firstDayOfWeek: 1
            }));
            
            if (configResult === true) {
                AndroidBridge.showToast(`✅ 导入成功！共${courses.length}门课程`);
                return true;
            }
        }
        
        AndroidBridge.showToast("❌ 导入失败");
        return false;
        
    } catch (error) {
        console.error("导入错误:", error);
        AndroidBridge.showToast("导入出错: " + error.message);
        return false;
    }
}
async function runAllDemosSequentially() {
    AndroidBridge.showToast("🚀 课表导入助手启动...");
    
    // 检查页面
    if (!window.location.href.includes('studentHome/expectCourseTable')) {
        const goToPage = await window.AndroidBridgePromise.showAlert(
            "页面提示",
            "当前不在课表页面，是否跳转？",
            "跳转",
            "取消"
        );
        if (goToPage) {
            window.location.href = 'http://neweas.huat.edu.cn/#/studentHome/expectCourseTable';
        }
        return;
    }
    
    const start = await demoAlert();
    if (!start) {
        AndroidBridge.showToast("已取消");
        return;
    }
    
    // 可以选择是否导入时间段
    const importTimeSlots = await window.AndroidBridgePromise.showAlert(
        "⏰ 导入时间段",
        "是否要导入预设的时间段数据？\n",
        "导入",
        "跳过"
    );
    
    if (importTimeSlots) {
        await importPresetTimeSlots();
    }
    
    await importSchedule();
    
    AndroidBridge.notifyTaskCompletion();
}
// 导出函数
window.validateDate = validateDate;
window.validateName = validateName;
window.extractCourseData = extractCourseData;
window.importPresetTimeSlots = importPresetTimeSlots;
// 启动
runAllDemosSequentially();
