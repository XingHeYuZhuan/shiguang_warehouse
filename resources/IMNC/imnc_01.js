/**
 * 呼和浩特民族学院 (IMNC) 课表解析脚本-通过 WebVPN 登录
 * 放置于测试目录用于真机测试
 */

// 周次解析函数
function parseWeeks(weekStr) {
    let weeks = [];
    if (!weekStr) return weeks;
    let isSingle = weekStr.includes('单');
    let isDouble = weekStr.includes('双');
    
    // 匹配 "1-16", "第1-9周"
    let match = weekStr.match(/(\d+)-(\d+)/);
    if (match) {
        let start = parseInt(match[1]);
        let end = parseInt(match[2]);
        for (let i = start; i <= end; i++) {
            if (isSingle && i % 2 === 0) continue;
            if (isDouble && i % 2 !== 0) continue;
            weeks.push(i);
        }
    } else {
        // 匹配 "第13周"
        let singleMatch = weekStr.match(/(\d+)/);
        if (singleMatch) {
            weeks.push(parseInt(singleMatch[1]));
        }
    }
    return weeks;
}

// 核心解析函数
function fetchAndParseCourses() {
    let courses = [];
    let table = document.querySelector('#timetable');
    if (!table) return null;
    
    let rows = table.querySelectorAll('tr');
    // 第 0 行是表头，从第 1 行开始遍历节次
    for (let i = 1; i < rows.length; i++) {
        let row = rows[i];
        let cells = row.querySelectorAll('td');
        let section = i; // 1 到 13 节
        
        for (let j = 0; j < cells.length; j++) {
            let cell = cells[j];
            let day = j + 1; // 星期 1 到 7
            
            let html = cell.innerHTML.trim();
            if (!html || html === '&nbsp;') continue;
            
            // 按 <br> 分割
            let parts = html.split(/<br\s*\/?>/i).map(s => s.trim()).filter(s => s !== '');
            
            // 每 5 个元素代表一个完整的课程块
            for (let k = 0; k < parts.length; k += 5) {
                if (k + 3 >= parts.length) break; 
                
                let namePart = parts[k]; 
                let position = parts[k+1];
                let teacher = parts[k+2];
                let weekStr = parts[k+3];
                // parts[k+4] 是 "讲授" 等类型，暂时不需要存入
                
                // 提取书名号内的课程名
                let nameMatch = namePart.match(/&lt;&lt;(.*?)&gt;&gt;/);
                let name = nameMatch ? nameMatch[1] : namePart;
                // 兼容某些浏览器可能将转义符还原的情况
                if (!nameMatch) {
                    let nameMatch2 = namePart.match(/<<(.*?)>>/);
                    if (nameMatch2) name = nameMatch2[1];
                }
                
                let weeks = parseWeeks(weekStr);
                
                // 查找同一天、同名、同老师、同地点、同周次，且正好是上一节的课程（合并连上的课）
                let existingCourse = courses.find(c => 
                    c.name === name && 
                    c.day === day && 
                    c.teacher === teacher && 
                    c.position === position &&
                    JSON.stringify(c.weeks) === JSON.stringify(weeks) &&
                    c.endSection === section - 1 
                );
                
                if (existingCourse) {
                    existingCourse.endSection = section;
                } else {
                    courses.push({
                        name: name,
                        teacher: teacher,
                        position: position,
                        day: day,
                        startSection: section,
                        endSection: section,
                        weeks: weeks
                    });
                }
            }
        }
    }
    return courses;
}

function cleanCellText(cell) {
    return cell.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNoArrangementCourses() {
    let table = document.querySelector('#noArrangement');
    if (!table) return [];

    let rows = table.querySelectorAll('tr');
    let courses = [];
    let seen = {};

    for (let i = 1; i < rows.length; i++) {
        let cells = rows[i].querySelectorAll('td');
        if (cells.length < 8) continue;

        let course = {
            courseId: cleanCellText(cells[0]),
            name: cleanCellText(cells[1]),
            sequence: cleanCellText(cells[2]),
            teacher: cleanCellText(cells[3]) || '未填写教师',
            combinedClass: cleanCellText(cells[4]),
            weeks: cleanCellText(cells[5]),
            day: cleanCellText(cells[6]),
            position: cleanCellText(cells[7])
        };

        if (!course.courseId && !course.name) continue;

        let key = [course.courseId, course.name, course.sequence, course.teacher, course.combinedClass, course.weeks, course.day, course.position].join('|');
        if (seen[key]) continue;

        seen[key] = true;
        courses.push(course);
    }

    return courses;
}

function formatNoArrangementMessage(courses) {
    let lines = courses.map((course, index) => {
        let teacher = course.teacher || '未填写教师';
        let weeks = course.weeks || '未填写周次';
        return `${index + 1}. ${course.name} / ${teacher} / ${weeks}`;
    });

    return `检测到 ${courses.length} 门课程没有具体上课时间或地点，无法自动放入课表：\n\n${lines.join('\n')}\n\n请在确认课程时间后重新导入，点击【继续】将导入已知课程。`;
}

// 调度流程
async function runImportFlow() {
    try {
        AndroidBridge.showToast("开始解析课表...");
        
        const alertConfirmed = await window.AndroidBridgePromise.showAlert(
            "导入确认",
            "请确保您目前处于教务系统的“学生课表”显示页面。\n是否立即提取并导入课表？",
            "开始提取"
        );
        
        if (!alertConfirmed) {
            AndroidBridge.showToast("导入已取消");
            return;
        }
        
        let courses = fetchAndParseCourses();
        
        if (!courses || courses.length === 0) {
            await window.AndroidBridgePromise.showAlert("错误", "未在当前页面找到课表数据，请确认是否处于课表页面，或联系适配开发者。", "好的");
            return;
        }

        let noArrangementCourses = parseNoArrangementCourses();
        if (noArrangementCourses.length > 0) {
            await window.AndroidBridgePromise.showAlert(
                "存在未安排课程",
                formatNoArrangementMessage(noArrangementCourses),
                "继续"
            );
        }
        
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        AndroidBridge.showToast(`成功导入 ${courses.length} 门课程块！`);
        AndroidBridge.notifyTaskCompletion();
        
    } catch (error) {
        AndroidBridge.showToast("导入发生错误: " + error.message);
    }
}

// 启动执行
runImportFlow();
