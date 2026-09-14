/**
 * 河北石油职业技术大学正方教务系统适配脚本
 * 适用于正方教务系统 v9.0
 * 
 * 学校信息：
 * - 名称：河北石油职业技术大学
 * - 系统：正方教务系统
 * - 地址：http://jwc.jw.hebpu.edu.cn/jwglxt/xtgl/login_slogin.html
 * - 特点：需要校园网环境
 */

/**
 * 适配脚本主函数
 */
async function runImportFlow() {
    window.shiguangBridge.showToast("开始导入河北石油职业技术大学课程...");

    // 检查是否在正确的页面
    if (!window.location.href.includes('jwglxt')) {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "请先访问教务系统",
            "请先访问河北石油职业技术大学教务系统并登录:\n\n" +
            "http://jwc.jw.hebpu.edu.cn/jwglxt/xtgl/login_slogin.html\n\n" +
            "注意：需要校园网环境才能访问。",
            "我已登录教务系统"
        );
        if (!confirmed) {
            window.shiguangBridge.showToast("用户取消了导入。");
            return;
        }
    }

    try {
        // 获取课程数据
        const courseData = await fetchCoursesFromZhengfangSystem();
        
        if (!courseData || courseData.length === 0) {
            throw new Error("未获取到课程数据，请确认您已在教务系统中能正常查看课表");
        }

        // 对课程数据进行去重和合并
        const mergedCourses = mergeAndDistinctCourses(courseData);

        // 保存课程数据
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(mergedCourses));
        window.shiguangBridge.showToast(`成功导入 ${mergedCourses.length} 门课程！`);

        // 通知任务完成
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        window.shiguangBridge.showToast(`导入失败: ${error.message}`);
        console.error("课程导入失败:", error);
    }
}

/**
 * 从正方教务系统获取课程数据
 */
async function fetchCoursesFromZhengfangSystem() {
    const courses = [];

    try {
        // 尝试通过API获取数据（正方教务系统常用接口）
        // 检查当前学年学期
        const currentInfo = getCurrentSchoolYearTerm();
        const xnm = currentInfo.xnm; // 学年
        const xqm = currentInfo.xqm; // 学期

        // 尝试调用正方教务系统API获取课程数据
        const apiResponse = await callZhengfangAPI(xnm, xqm);
        if (apiResponse && apiResponse.datas && apiResponse.datas.xskbList) {
            return parseZhengfangAPIData(apiResponse);
        }
    } catch (apiError) {
        console.warn("API方式获取失败，尝试页面解析:", apiError);
    }

    // 如果API方式失败，尝试页面解析
    return parseCoursesFromPage();
}

/**
 * 获取当前学年学期信息
 */
function getCurrentSchoolYearTerm() {
    // 尝试从页面获取当前学年学期信息
    let xnm = '';
    let xqm = '';
    
    // 从页面元素获取
    const xnmField = document.querySelector('[name="xnm"]') || document.getElementById('xnm');
    const xqmField = document.querySelector('[name="xqm"]') || document.getElementById('xqm');
    
    if (xnmField && xnmField.value) xnm = xnmField.value;
    if (xqmField && xqmField.value) xqm = xqmField.value;
    
    // 如果页面没有直接提供，尝试从URL参数获取
    if (!xnm || !xqm) {
        const urlParams = new URLSearchParams(window.location.search);
        if (!xnm) xnm = urlParams.get('xnm') || getCurrentAcademicYear();
        if (!xqm) xqm = urlParams.get('xqm') || '1'; // 默认第一学期
    }
    
    // 确保值不为空
    if (!xnm) xnm = getCurrentAcademicYear();
    if (!xqm) xqm = '1';
    
    return { xnm, xqm };
}

/**
 * 获取当前学年
 */
function getCurrentAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    // 通常在8月之后是新学年
    return now.getMonth() >= 7 ? year.toString() : (year - 1).toString();
}

/**
 * 调用正方教务系统API
 */
async function callZhengfangAPI(xnm, xqm) {
    try {
        // 正方教务系统获取学生课表的API
        const response = await fetch('/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': window.location.href
            },
            body: `xnm=${xnm}&xqm=${xqm}`
        });

        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error("API调用失败:", error);
    }
    return null;
}

/**
 * 解析正方教务系统API返回的数据
 */
function parseZhengfangAPIData(data) {
    const courses = [];

    try {
        if (data && data.datas && data.datas.xskbList) {
            const kbList = Array.isArray(data.datas.xskbList.rows) ? 
                          data.datas.xskbList.rows : data.datas.xskbList;
            
            if (Array.isArray(kbList)) {
                for (const item of kbList) {
                    // 解析API返回的课程数据
                    const course = {
                        name: item.KCM || item.kcm || '', // 课程名称
                        teacher: item.TEACHERNAME || item.teachername || 
                                 item.SKJS || item.skjs || '', // 授课教师
                        position: item.JASMC || item.jasmc || 
                                  item.CLASSROOM || item.classroom || '', // 教室名称
                        day: parseInt(item.XQJ) || 1, // 星期几 (1-7)
                        startSection: parseInt(item.KSJCDM) || 1, // 开始节次
                        endSection: parseInt(item.KSJCDM) + (parseInt(item.JC) || 1) - 1 || 2, // 结束节次
                        weeks: parseWeeksFromZhengfang(item.ZCMC || item.zcmc || '') // 周次信息
                    };

                    if (course.name) {
                        courses.push(course);
                    }
                }
            }
        }
    } catch (e) {
        console.error("解析API数据失败:", e);
        // 如果API解析失败，回退到页面解析
        return parseCoursesFromPage();
    }

    return courses;
}

/**
 * 从页面解析课程数据
 */
function parseCoursesFromPage() {
    const courses = [];
    
    // 查找课程表容器 - 正方教务系统常见的表格ID
    const selectors = [
        '#kbtable', '.kbtable', '[id*="kb"]', 
        '#table', '.table', '[class*="kb"]',
        '[id*="kcb"]', '[class*="kcb"]'
    ];
    
    let kbTable = null;
    for (const selector of selectors) {
        kbTable = document.querySelector(selector);
        if (kbTable) break;
    }
    
    if (kbTable) {
        // 解析课表表格
        const rows = kbTable.querySelectorAll('tr');
        for (let i = 1; i < rows.length; i++) { // 跳过表头
            const row = rows[i];
            const cols = row.querySelectorAll('td, th');
            
            if (cols.length > 0) {
                // 从第二列开始遍历（第一列通常是节次）
                for (let j = 1; j < cols.length; j++) {
                    const cell = cols[j];
                    const day = j; // j=1对应周一，以此类推
                    
                    // 尝试解析单元格中的课程信息
                    const courseText = cell.textContent || cell.innerText;
                    if (courseText && courseText.trim() !== '' && 
                        courseText !== '&nbsp;' && courseText !== ' ') {
                        
                        // 解析单个单元格中的多个课程
                        const cellCourses = parseCellCourses(courseText, day);
                        courses.push(...cellCourses);
                    }
                }
            }
        }
    } else {
        // 如果找不到标准表格，尝试其他方式
        courses.push(...parseAlternativeStructure());
    }
    
    return courses;
}

/**
 * 解析单元格中的课程信息
 */
function parseCellCourses(cellText, day) {
    const courses = [];
    
    // 正方教务系统中，一个单元格可能包含多个课程，用换行符或其他分隔符分隔
    const courseBlocks = cellText.split(/\n\s*\n|\r\n\s*\r\n/).filter(block => block.trim() !== '');
    
    for (const block of courseBlocks) {
        const courseInfo = parseSingleCourseBlock(block, day);
        if (courseInfo) {
            courses.push(courseInfo);
        }
    }
    
    return courses;
}

/**
 * 解析单个课程块
 */
function parseSingleCourseBlock(block, day) {
    // 清理文本
    const lines = block
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
    
    if (lines.length < 2) return null;
    
    let courseName = '';
    let teacher = '';
    let position = '';
    let weeksStr = '';
    let sectionsStr = '';
    
    // 智能解析每一行
    for (const line of lines) {
        if (isCourseName(line) && courseName === '') {
            courseName = line;
        } else if (isTeacher(line) && teacher === '') {
            teacher = line;
        } else if (isPosition(line) && position === '') {
            position = line;
        } else if ((line.includes('周') || line.includes('[') && line.includes(']')) && weeksStr === '') {
            weeksStr = line;
        } else if (line.includes('节') && sectionsStr === '') {
            sectionsStr = line;
        }
    }
    
    // 如果某些信息没找到，尝试从所有行中提取
    if (courseName === '') {
        for (const line of lines) {
            if (isLikelyCourseName(line)) {
                courseName = line;
                break;
            }
        }
    }
    
    if (teacher === '') {
        for (const line of lines) {
            if (line.includes('老师') || line.includes('教授') || line.includes('讲师')) {
                teacher = line;
                break;
            }
        }
    }
    
    if (position === '' && weeksStr === '') {
        for (const line of lines) {
            if (isPosition(line)) {
                // 这行可能同时包含教室和周次信息
                if (line.includes('周') || line.includes('[') || line.includes(']')) {
                    // 分离教室和周次
                    const posMatch = line.match(/([^周\[\]]+)([周\[\]\d,-]+)/);
                    if (posMatch) {
                        position = posMatch[1].trim();
                        weeksStr = posMatch[2];
                    } else {
                        position = line;
                    }
                } else {
                    position = line;
                }
                break;
            }
        }
    }
    
    if (courseName === '') return null;
    
    // 解析周次
    const weeks = weeksStr ? parseWeeks(weeksStr) : [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]; // 默认全周
    
    // 解析节次
    let startSection = 1, endSection = 2;
    if (sectionsStr) {
        const sectionMatch = sectionsStr.match(/(\d+)-?(\d*)/);
        if (sectionMatch) {
            startSection = parseInt(sectionMatch[1]);
            endSection = sectionMatch[2] ? parseInt(sectionMatch[2]) : startSection;
        }
    }
    
    return {
        name: courseName,
        teacher: teacher || "",
        position: position || "",
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
    };
}

/**
 * 判断是否为课程名称
 */
function isCourseName(text) {
    // 课程名通常包含中文字符，长度适中，不含明显的教师或教室标识
    return /[\u4e00-\u9fa5]/.test(text) && 
           text.length >= 2 && 
           !text.includes('老师') && 
           !text.includes('教授') && 
           !text.includes('教') && 
           !text.includes('楼') && 
           !text.includes('室');
}

/**
 * 判断是否可能是课程名称
 */
function isLikelyCourseName(text) {
    return /[\u4e00-\u9fa5]/.test(text) && 
           text.length >= 2 && 
           !text.match(/^\d/); // 不以数字开头
}

/**
 * 判断是否为教师名称
 */
function isTeacher(text) {
    return (text.includes('老师') || text.includes('教授') || text.includes('讲师') || 
            text.includes('助教')) && /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 判断是否为教室位置
 */
function isPosition(text) {
    return (text.includes('教') || text.includes('楼') || text.includes('室') || 
            text.includes('机房') || text.includes('实验室') || text.includes('阶梯')) && 
           /[\u4e00-\u9fa5\w]/.test(text);
}

/**
 * 解析周次信息
 */
function parseWeeks(weeksText) {
    const weeks = [];
    
    if (!weeksText) return weeks;
    
    // 移除可能的括号和多余字符
    let cleanText = weeksText.replace(/[\[\]第周]/g, ' ');
    
    if (cleanText.includes('-')) {
        // 处理范围，如 "1-10" 或 "1 - 10"
        const ranges = cleanText.match(/(\d+)\s*-\s*(\d+)/g);
        if (ranges) {
            for (const range of ranges) {
                const [start, end] = range.replace(/\s/g, '').split('-').map(Number);
                if (!isNaN(start) && !isNaN(end)) {
                    for (let i = start; i <= end; i++) {
                        if (!weeks.includes(i)) weeks.push(i);
                    }
                }
            }
        }
    }
    
    // 处理逗号或顿号分隔的周次
    const nums = cleanText.replace(/[,，、]/g, ' ').split(/\s+/);
    for (const num of nums) {
        const week = parseInt(num.trim());
        if (!isNaN(week) && week > 0 && week <= 30 && !weeks.includes(week)) { // 假设最多30周
            weeks.push(week);
        }
    }
    
    // 处理"单周"、"双周"
    if (weeksText.includes('单周')) {
        for (let i = 1; i <= 30; i += 2) {
            if (!weeks.includes(i)) weeks.push(i);
        }
    }
    if (weeksText.includes('双周')) {
        for (let i = 2; i <= 30; i += 2) {
            if (!weeks.includes(i)) weeks.push(i);
        }
    }
    
    return weeks.sort((a, b) => a - b);
}

/**
 * 从正方教务系统数据解析周次
 */
function parseWeeksFromZhengfang(zcmc) {
    return parseWeeks(zcmc);
}

/**
 * 解析其他可能的页面结构
 */
function parseAlternativeStructure() {
    const courses = [];
    
    // 查找可能包含课程信息的其他元素
    const potentialElements = document.querySelectorAll('*');
    for (let i = 0; i < potentialElements.length; i++) {
        const element = potentialElements[i];
        const text = element.textContent || element.innerText;
        
        // 查找包含课程特征的文本
        if (hasCourseCharacteristics(text)) {
            // 尝试解析这个元素
            const elementCourses = tryParseElement(element);
            courses.push(...elementCourses);
        }
    }
    
    return courses;
}

/**
 * 检查文本是否具有课程特征
 */
function hasCourseCharacteristics(text) {
    return text.length > 5 && 
           (text.includes('周') || text.includes('节') || text.includes('教')) &&
           /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 尝试解析元素
 */
function tryParseElement(element) {
    const courses = [];
    // 这里可以实现更多复杂的解析逻辑
    return courses;
}

/**
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// 启动导入流程
runImportFlow();
