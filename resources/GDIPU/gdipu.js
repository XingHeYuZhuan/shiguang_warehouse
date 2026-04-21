// 广东轻工职业技术大学教务适配器
// 适配器ID: GDIPU_01

/**
 * 检查登录状态
 * @returns {boolean} 是否已登录
 */
const checkLogin = () => {
    // 检查是否在正确的域名下
    if (window.location.hostname !== 'jw.gdipu.edu.cn') {
        return false;
    }
    
    // 检查是否有有效的session
    const cookies = document.cookie;
    return cookies.includes('JSESSIONID=');
};

/**
 * 获取当前周数
 * @returns {number} 当前周数
 */
const getCurrentWeek = () => {
    // 尝试从页面中提取周数信息
    const weekInfoElement = document.querySelector('#li_showWeek span');
    if (weekInfoElement) {
        const weekText = weekInfoElement.textContent;
        const match = weekText.match(/第(\d+)周/);
        if (match) {
            return parseInt(match[1], 10);
        }
    }
    
    // 默认返回第1周
    return 1;
};

/**
 * 获取当前日期或指定周数的日期
 * @param {number} week - 周数
 * @returns {string} 日期字符串 YYYY-MM-DD
 */
const getDateForWeek = (week) => {
    // 这里需要根据学期开始日期计算
    // 由于我们不知道学期开始日期，我们可以使用当前日期
    const today = new Date();
    
    // 计算指定周数的日期（假设今天是当前周的第一天）
    const daysToAdd = (week - getCurrentWeek()) * 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysToAdd);
    
    // 格式化为YYYY-MM-DD
    return targetDate.toISOString().split('T')[0];
};

/**
 * 获取课程表数据
 * @param {string} date - 日期字符串 YYYY-MM-DD
 * @returns {Promise<string>} HTML响应
 */
const fetchTimetable = async (date) => {
    try {
        const response = await fetch('https://jw.gdipu.edu.cn/jsxsd/framework/main_index_loadkb.jsp', {
            method: 'POST',
            headers: {
                'Accept': 'text/html, */*; q=0.01',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Origin': 'https://jw.gdipu.edu.cn',
                'Referer': window.location.href,
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include', // 包含cookies
            body: `rq=${date}`
        });
        
        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }
        
        return await response.text();
    } catch (error) {
        console.error('获取课程表失败:', error);
        throw error;
    }
};

/**
 * 从HTML字符串解析课程表
 * @param {string} html - HTML字符串
 * @returns {Array} 课程信息数组
 */
const parseTimetableFromHTML = (html) => {
    const courses = [];
    
    // 创建临时DOM元素来解析HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 查找课程表表格
    const table = doc.querySelector('form table.kb_table');
    if (!table) {
        console.error('未找到课程表表格');
        return courses;
    }
    
    // 获取所有行（跳过表头）
    const rows = table.querySelectorAll('tbody tr');
    
    rows.forEach((row) => {
        // 第一列是节次信息
        const sectionCell = row.querySelector('td:first-child');
        if (!sectionCell) return;
        
        // 解析节次，如"1-2"（取第一行，忽略后面的时间信息）
        const sectionText = sectionCell.textContent.trim().split('\n')[0];
        const sectionInfo = parseSection(sectionText);
        
        // 遍历星期几的列（从第2列到第8列）
        // 根据表头：第1列是节次，第2列是星期一，第3列是星期二，...，第8列是星期日
        for (let colIndex = 1; colIndex <= 7; colIndex++) {
            const dayCell = row.querySelector(`td:nth-child(${colIndex + 1})`);
            if (!dayCell) continue;
            
            // 查找课程p标签
            const courseP = dayCell.querySelector('p[title]');
            if (!courseP) continue;
            
            // 从title属性解析课程信息
            const title = courseP.getAttribute('title');
            const courseInfo = parseCourseFromTitle(title);
            
            // 解析上课时间
            const timeInfo = parseTimeInfo(courseInfo.time || '');
            
            // 确定星期几：colIndex=1是星期一，colIndex=7是星期日
            let dayOfWeek;
            if (timeInfo.day && timeInfo.day > 0) {
                // 如果从时间字符串中解析出了星期几，使用它
                dayOfWeek = timeInfo.day;
            } else {
                // 否则根据列索引计算
                // 列索引映射：1->星期一(1), 2->星期二(2), 3->星期三(3), 4->星期四(4), 5->星期五(5), 6->星期六(6), 7->星期日(7)
                dayOfWeek = colIndex;
            }
            
            // 构建课程对象
            const course = {
                name: courseInfo.name || '',
                teacher: '', // 这个系统似乎没有教师信息
                position: courseInfo.location || '',
                day: dayOfWeek,
                startSection: sectionInfo.startSection,
                endSection: sectionInfo.endSection,
                weeks: timeInfo.weeks.length > 0 ? timeInfo.weeks : [getCurrentWeek()] // 默认当前周
            };
            
            // 添加到课程列表
            courses.push(course);
        }
    });
    
    return courses;
};

/**
 * 从title属性解析课程信息
 * @param {string} title - title属性内容
 * @returns {Object} 解析后的课程信息
 */
const parseCourseFromTitle = (title) => {
    const info = {};
    
    // 使用正则表达式提取各个字段
    const creditMatch = title.match(/课程学分：([\d.]+)/);
    const propertyMatch = title.match(/课程属性：([^<]+)/);
    const nameMatch = title.match(/课程名称：([^<]+)/);
    const timeMatch = title.match(/上课时间：([^<]+)/);
    const locationMatch = title.match(/上课地点：([^<]+)/);
    const campusMatch = title.match(/上课校区：([^<]+)/);
    const groupMatch = title.match(/分组名：([^<]+)/);
    
    if (creditMatch) info.credit = creditMatch[1];
    if (propertyMatch) info.property = propertyMatch[1].trim();
    if (nameMatch) info.name = nameMatch[1].trim();
    if (timeMatch) info.time = timeMatch[1].trim();
    if (locationMatch) info.location = locationMatch[1].trim();
    if (campusMatch) info.campus = campusMatch[1].trim();
    if (groupMatch) info.group = groupMatch[1].trim();
    
    return info;
};

/**
 * 解析上课时间字符串
 * @param {string} timeStr - 上课时间字符串，如"第7周 星期二 [01-02]节" 或 "第7-12周 星期二 [01-02]节"
 * @returns {Object} 解析后的时间信息
 */
const parseTimeInfo = (timeStr) => {
    const result = {
        weeks: [],
        day: 0,
        startSection: 0,
        endSection: 0
    };
    
    // 解析周数范围，如"第7周" 或 "第7-12周"
    const weekMatch = timeStr.match(/第(\d+)(?:-(\d+))?周/);
    if (weekMatch) {
        const startWeek = parseInt(weekMatch[1], 10);
        if (weekMatch[2]) {
            // 有周数范围，如7-12
            const endWeek = parseInt(weekMatch[2], 10);
            for (let week = startWeek; week <= endWeek; week++) {
                result.weeks.push(week);
            }
        } else {
            // 单周
            result.weeks.push(startWeek);
        }
    }
    
    // 解析星期几
    const dayMap = {
        '星期一': 1,
        '星期二': 2,
        '星期三': 3,
        '星期四': 4,
        '星期五': 5,
        '星期六': 6,
        '星期日': 7
    };
    
    for (const [dayStr, dayNum] of Object.entries(dayMap)) {
        if (timeStr.includes(dayStr)) {
            result.day = dayNum;
            break;
        }
    }
    
    // 解析节次，如"[01-02]节"
    const sectionMatch = timeStr.match(/\[(\d+)-(\d+)\]/);
    if (sectionMatch) {
        result.startSection = parseInt(sectionMatch[1], 10);
        result.endSection = parseInt(sectionMatch[2], 10);
    }
    
    return result;
};

/**
 * 解析节次字符串
 * @param {string} sectionStr - 节次字符串，如"1-2"
 * @returns {Object} 开始和结束节次
 */
const parseSection = (sectionStr) => {
    const result = {
        startSection: 0,
        endSection: 0
    };
    
    if (sectionStr.includes('-')) {
        const parts = sectionStr.split('-');
        result.startSection = parseInt(parts[0], 10);
        result.endSection = parseInt(parts[1], 10);
    } else {
        result.startSection = parseInt(sectionStr, 10);
        result.endSection = parseInt(sectionStr, 10);
    }
    
    return result;
};

/**
 * 获取学期开始日期和总周数
 * @returns {Object} 学期配置
 */
const getSemesterConfig = () => {
    // 从页面中提取周数信息
    const weekInfoElement = document.querySelector('#li_showWeek span');
    let currentWeek = getCurrentWeek();
    let totalWeeks = 20; // 默认20周
    
    if (weekInfoElement) {
        const weekText = weekInfoElement.textContent;
        const match = weekText.match(/第(\d+)周\/(\d+)周/);
        if (match) {
            currentWeek = parseInt(match[1], 10);
            totalWeeks = parseInt(match[2], 10);
        }
    }
    
    // 计算学期开始日期（假设今天是当前周的第一天）
    const today = new Date();
    const daysSinceStart = (currentWeek - 1) * 7;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - daysSinceStart);
    
    // 格式化为YYYY-MM-DD
    const formattedDate = startDate.toISOString().split('T')[0];
    
    return {
        semesterStartDate: formattedDate,
        totalWeeks: totalWeeks
    };
};

/**
 * 获取时间段配置
 * @param {string} html - 课程表HTML
 * @returns {Array} 时间段配置数组
 */
const getTimeSlots = (html) => {
    const timeSlots = [];
    
    // 创建临时DOM元素来解析HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const table = doc.querySelector('form table.kb_table');
    
    if (!table) {
        // 返回默认时间段配置
        return [
            { number: 1, startTime: "08:30", endTime: "09:55" },
            { number: 2, startTime: "10:15", endTime: "11:40" },
            { number: 3, startTime: "11:45", endTime: "12:25" },
            { number: 4, startTime: "13:15", endTime: "13:55" },
            { number: 5, startTime: "14:00", endTime: "15:25" },
            { number: 6, startTime: "15:45", endTime: "17:10" },
            { number: 7, startTime: "17:15", endTime: "17:55" },
            { number: 8, startTime: "19:30", endTime: "20:55" },
            { number: 9, startTime: "21:00", endTime: "21:40" }
        ];
    }
    
    const rows = table.querySelectorAll('tbody tr');
    
    rows.forEach((row, index) => {
        const sectionCell = row.querySelector('td:first-child');
        if (!sectionCell) return;
        
        // 提取时间信息，如"08:30-09:55"
        const timeText = sectionCell.textContent;
        const timeMatch = timeText.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        
        if (timeMatch) {
            timeSlots.push({
                number: index + 1,
                startTime: timeMatch[1],
                endTime: timeMatch[2]
            });
        }
    });
    
    return timeSlots;
};

/**
 * 保存课程数据
 * @param {Array} courses - 课程数组
 * @param {Object} courseConfig - 课程配置
 * @param {Array} timeSlots - 时间段配置
 */
const saveSchedule = async (courses, courseConfig, timeSlots) => {
    try {
        await Promise.allSettled([
            window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(courseConfig)),
            window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses)),
            window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots))
        ]);
        
        AndroidBridge.showToast("课程表导入成功！");
        return true;
    } catch (error) {
        console.error("保存课程数据时出错:", error);
        AndroidBridge.showToast("课程表导入失败：" + error.message);
        return false;
    }
};

/**
 * 主函数
 */
(async () => {
    try {
        // 检查登录状态
        if (!checkLogin()) {
            AndroidBridge.showToast("尚未登录广东轻工职业技术大学教务系统，请先登录！");
            throw new Error("未检测到登录状态");
        }
        
        AndroidBridge.showToast("正在获取课程表数据...");
        
        // 获取当前周数
        const currentWeek = getCurrentWeek();
        
        // 获取当前周数的日期
        const date = getDateForWeek(currentWeek);
        
        // 获取课程表HTML
        const timetableHTML = await fetchTimetable(date);
        
        // 解析课程表
        const courses = parseTimetableFromHTML(timetableHTML);
        
        if (courses.length === 0) {
            AndroidBridge.showToast("未找到课程信息，请确保已进入课程表页面");
            throw new Error("未找到课程信息");
        }
        
        console.log(`找到 ${courses.length} 门课程`);
        
        // 获取学期配置
        const courseConfig = getSemesterConfig();
        
        // 获取时间段配置
        const timeSlots = getTimeSlots(timetableHTML);
        
        // 保存数据
        const success = await saveSchedule(courses, courseConfig, timeSlots);
        
        if (success) {
            AndroidBridge.notifyTaskCompletion();
        } else {
            throw new Error("保存课程数据失败");
        }
        
    } catch (error) {
        console.error("导入课程表时出错:", error);
        AndroidBridge.showToast("导入课程表失败：" + error.message);
    }
})();