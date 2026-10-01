// 文件: cust.js
// 长春理工大学 kbpro 课程表导入脚本

const SCHEDULE_PAGE_URL = 'https://kbpro.cust.edu.cn/Schedule/';
const SCHEDULE_INFO_API = 'https://kbpro.cust.edu.cn/Schedule/scheduleInfo';
const SCHEDULE_JSON_API = 'https://kbpro.cust.edu.cn/Schedule/getSchedulejson';

// 判断当前是否已经进入新版课表页面
function isOnSchedulePage() {
    try {
        const url = new URL(window.location.href);
        return url.hostname.toLowerCase() === 'kbpro.cust.edu.cn'
            && url.pathname.toLowerCase().startsWith('/schedule');
    } catch (error) {
        return false;
    }
}

// 直接进入新版课表页面，不再进入旧教务系统 Student 页面
function redirectToSchedulePage() {
    console.log('当前不在新版课表页面，正在跳转:', SCHEDULE_PAGE_URL);
    window.shiguangBridge.showToast('正在打开课程表...');
    window.location.replace(SCHEDULE_PAGE_URL);
}

// 通用 GET JSON 请求。Cookie 由浏览器当前登录会话自动携带，不写死 JSESSIONID。
async function fetchJson(url, description) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        credentials: 'include',
        cache: 'no-store'
    });

    if (!response.ok) {
        throw new Error(`${description}失败，HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        throw new Error(`${description}返回的不是 JSON，可能登录状态已失效`);
    }

    return await response.json();
}

// 获取学期、开学日期、当前周以及周次日期映射
async function fetchScheduleInfo() {
    try {
        console.log('正在获取学期信息...');
        const data = await fetchJson(SCHEDULE_INFO_API, '获取学期信息');
        console.log('学期信息:', data);
        return data;
    } catch (error) {
        console.error('获取学期信息失败:', error);
        window.shiguangBridge.showToast('获取学期信息失败: ' + error.message);
        return null;
    }
}

// 获取课程明细
async function fetchScheduleData() {
    try {
        console.log('正在获取课程明细...');
        const data = await fetchJson(SCHEDULE_JSON_API, '获取课程数据');

        if (!Array.isArray(data)) {
            throw new Error('课程接口返回格式异常');
        }

        console.log(`成功获取 ${data.length} 条课程明细`);
        console.log('课程接口原始数据:', data);
        return data;
    } catch (error) {
        console.error('获取课程数据失败:', error);
        window.shiguangBridge.showToast('获取课程失败: ' + error.message);
        return null;
    }
}

// weekDescription 是 25 位周次位图。
// 下标直接对应 scheduleInfo.dateList 中的 weekOrder：
// 第 0 位 = weekOrder 0（开学前一周），正式导入时忽略；第 1 位 = 第 1 周，以此类推。
function parseWeekDescription(weekDescription) {
    if (typeof weekDescription !== 'string') {
        return [];
    }

    const weeks = [];

    for (let index = 1; index < weekDescription.length; index++) {
        if (weekDescription[index] === '1') {
            weeks.push(index);
        }
    }

    return weeks;
}

// 教师显示名称：保持接口第一次出现的顺序，只把空格统一成“、”
function normalizeTeacherDisplay(teacherName) {
    if (!teacherName) {
        return '';
    }

    const names = teacherName
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return [...new Set(names)].join('、');
}

// 教师比较键：忽略多人教师在不同周返回时的排列顺序
function normalizeTeacherKey(teacherName) {
    if (!teacherName) {
        return '';
    }

    const names = teacherName
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return [...new Set(names)].sort().join('、');
}

// 拼接完整上课地点
function buildPosition(item) {
    return [item.campus, item.buildingName, item.classroomName]
        .map(value => (value || '').trim())
        .filter(Boolean)
        .join(' ') || '未指定';
}

// 将 getSchedulejson 返回结果转换成时光课表格式
function convertScheduleData(apiData) {
    const exactCoursesMap = new Map();
    const timeSlotsMap = new Map();

    apiData.forEach(item => {
        const courseName = (item.courseName || '').trim();
        const teacherDisplay = normalizeTeacherDisplay(item.teacherName);
        const teacherKey = normalizeTeacherKey(item.teacherName);
        const position = buildPosition(item);
        const day = Number(item.dayOfWeek);
        const startSection = Number(item.beginSection);
        const endSection = Number(item.endSection);
        const weeks = parseWeekDescription(item.weekDescription);

        if (!courseName || weeks.length === 0) {
            return;
        }

        if (!Number.isInteger(day) || day < 1 || day > 7) {
            console.warn('忽略星期字段异常的课程:', item);
            return;
        }

        if (!Number.isInteger(startSection) || !Number.isInteger(endSection)
            || startSection <= 0 || endSection < startSection) {
            console.warn('忽略节次字段异常的课程:', item);
            return;
        }

        // 同一门课、同一教师集合、同一地点、同一天、同一节次范围：合并所有周次
        const exactKey = [
            courseName,
            teacherKey,
            position,
            day,
            startSection,
            endSection
        ].join('||');

        if (!exactCoursesMap.has(exactKey)) {
            exactCoursesMap.set(exactKey, {
                name: courseName,
                teacher: teacherDisplay,
                _teacherKey: teacherKey,
                position,
                day,
                startSection,
                endSection,
                weeks: new Set()
            });
        }

        const course = exactCoursesMap.get(exactKey);
        weeks.forEach(week => course.weeks.add(week));

        // 收集 API 给出的时间范围，用于覆盖默认作息时间的起止边界
        const beginTime = (item.beginTime || '').trim();
        const endTime = (item.endTime || '').trim();

        if (beginTime && endTime) {
            const timeKey = `${startSection}-${endSection}-${beginTime}-${endTime}`;
            timeSlotsMap.set(timeKey, {
                startSection,
                endSection,
                startTime: beginTime,
                endTime
            });
        }
    });

    // 第一轮：将同一课程时段的单周记录合并为完整周次记录
    const exactCourses = Array.from(exactCoursesMap.values()).map(course => ({
        ...course,
        weeks: Array.from(course.weeks).sort((a, b) => a - b)
    }));

    // 第二轮：同一课程如果被接口拆成连续节次，例如矩阵论 5-6 节 + 7 节，合并成 5-7 节。
    // 只有课程、教师集合、地点、星期、周次完全一致并且节次相邻时才合并，避免误合并两个独立时段。
    const mergeGroups = new Map();

    exactCourses.forEach(course => {
        const mergeKey = [
            course.name,
            course._teacherKey,
            course.position,
            course.day,
            course.weeks.join(',')
        ].join('||');

        if (!mergeGroups.has(mergeKey)) {
            mergeGroups.set(mergeKey, []);
        }

        mergeGroups.get(mergeKey).push(course);
    });

    const courses = [];

    mergeGroups.forEach(group => {
        group.sort((a, b) => {
            if (a.startSection !== b.startSection) {
                return a.startSection - b.startSection;
            }
            return a.endSection - b.endSection;
        });

        let current = null;

        group.forEach(course => {
            if (!current) {
                current = { ...course };
                return;
            }

            if (course.startSection <= current.endSection + 1) {
                current.startSection = Math.min(current.startSection, course.startSection);
                current.endSection = Math.max(current.endSection, course.endSection);
            } else {
                delete current._teacherKey;
                courses.push(current);
                current = { ...course };
            }
        });

        if (current) {
            delete current._teacherKey;
            courses.push(current);
        }
    });

    courses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.endSection !== b.endSection) return a.endSection - b.endSection;
        return a.name.localeCompare(b.name, 'zh-CN');
    });

    console.log(`接口原始记录: ${apiData.length} 条`);
    console.log(`合并后的课程记录: ${courses.length} 条`);
    console.log('转换后的课程:', courses);

    return {
        courses,
        timeSlots: Array.from(timeSlotsMap.values())
    };
}

// 生成时间段配置
function generateTimeSlots(timeSlotsFromAPI) {
    const defaultTimeSlots = [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:55', endTime: '09:35' },
        { number: 3, startTime: '10:05', endTime: '10:50' },
        { number: 4, startTime: '11:00', endTime: '11:40' },
        { number: 5, startTime: '13:30', endTime: '14:15' },
        { number: 6, startTime: '14:25', endTime: '15:05' },
        { number: 7, startTime: '15:35', endTime: '16:20' },
        { number: 8, startTime: '16:30', endTime: '17:10' },
        { number: 9, startTime: '18:00', endTime: '18:45' },
        { number: 10, startTime: '18:45', endTime: '19:35' },
        { number: 11, startTime: '19:45', endTime: '20:30' },
        { number: 12, startTime: '20:30', endTime: '21:20' }
    ];

    if (Array.isArray(timeSlotsFromAPI)) {
        timeSlotsFromAPI.forEach(slot => {
            const first = defaultTimeSlots.find(item => item.number === slot.startSection);
            const last = defaultTimeSlots.find(item => item.number === slot.endSection);

            if (first && slot.startTime) {
                first.startTime = slot.startTime;
            }

            if (last && slot.endTime) {
                last.endTime = slot.endTime;
            }
        });
    }

    return defaultTimeSlots;
}

// 主函数：获取并导入课程
async function importCourseSchedule() {
    try {
        console.log('开始导入 kbpro 课程表...');
        window.shiguangBridge.showToast('正在获取课程表...');

        const scheduleInfo = await fetchScheduleInfo();
        if (!scheduleInfo) {
            return false;
        }

        console.log(
            `当前学期: ${scheduleInfo.termName || '未知'}，`
            + `开学日期: ${scheduleInfo.schoolStartTime || '未知'}，`
            + `当前周: ${scheduleInfo.weekNum ?? '未知'}`
        );

        const scheduleData = await fetchScheduleData();
        if (!scheduleData) {
            return false;
        }

        const { courses, timeSlots } = convertScheduleData(scheduleData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast('未找到可导入的课程');
            return false;
        }

        const coursesResult = await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );

        if (coursesResult !== true) {
            console.error('课程导入失败，返回:', coursesResult);
            window.shiguangBridge.showToast('课程导入失败');
            return false;
        }

        console.log('课程导入成功');
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 条课程记录！`);

        const finalTimeSlots = generateTimeSlots(timeSlots);
        console.log('时间段配置:', finalTimeSlots);

        const timeSlotsResult = await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(finalTimeSlots)
        );

        if (timeSlotsResult === true) {
            console.log('时间段导入成功');
            window.shiguangBridge.showToast('时间段配置成功！');
        } else {
            console.warn('时间段导入失败，返回:', timeSlotsResult);
            window.shiguangBridge.showToast('课程已导入，但时间段配置失败');
        }

        return true;
    } catch (error) {
        console.error('导入过程出错:', error);
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

// ========== 主执行逻辑 ==========

if (!isOnSchedulePage()) {
    redirectToSchedulePage();
} else {
    console.log('已进入长春理工大学新版课表页面');
    window.shiguangBridge.showToast('正在准备导入课程表...');

    // 等待页面和登录态稳定后请求接口
    setTimeout(async () => {
        const success = await importCourseSchedule();
        if (success) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    }, 1000);
}
