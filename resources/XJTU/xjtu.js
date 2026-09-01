/**
 * 西安交通大学教务系统课表适配脚本 (API版)
 * 适配系统: e-hall 教务系统 (wdkb)
 * API端点: xskcb.do (课程数据), dqxnxq.do (当前学期)
 */

const BASE_URL = 'https://ehall.xjtu.edu.cn/jwapp/sys/wdkb/modules';

// ==================== 周次解析 ====================

/**
 * 将 SKZC 二进制位串解析为周次数组
 * 输入: "000001" → [6], "00000000000000001111" → [1,2,3,4]
 * SKZC 是20位二进制字符串，从右到左表示第1-20周
 */
function parseWeeksFromBinary(skzc) {
    if (!skzc) return [];
    const weeks = [];
    const reversed = skzc.split('').reverse();
    for (let i = 0; i < reversed.length; i++) {
        if (reversed[i] === '1') {
            weeks.push(i + 1);
        }
    }
    return weeks;
}

// ==================== 学期选择 ====================

/**
 * 生成学期选项列表
 * 格式: ["2025-2026 秋季(1)", "2025-2026 春季(2)", "2025-2026 暑假(4)"]
 */
function generateSemesterOptions(currentYear) {
    const options = [];
    const semesterNames = { '1': '秋季', '2': '春季', '4': '暑假' };
    const semesterCodes = ['1', '2', '4'];

    // 从当前学年前2年到后1年
    const startYear = parseInt(currentYear.split('-')[0], 10) - 1;
    const endYear = parseInt(currentYear.split('-')[0], 10) + 1;

    for (let y = endYear; y >= startYear; y--) {
        const yearCode = `${y}-${y + 1}`;
        for (const semCode of semesterCodes) {
            const xnxqdm = `${yearCode}-${semCode}`;
            const displayName = `${yearCode}学年 ${semesterNames[semCode]}`;
            options.push({ xnxqdm, displayName });
        }
    }
    return options;
}

/**
 * 获取当前学期信息
 */
async function fetchCurrentSemester() {
    try {
        const response = await fetch(`${BASE_URL}/jshkcb/dqxnxq.do`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            credentials: 'include'
        });
        if (!response.ok) return null;
        const data = await response.json();
        const row = data?.datas?.dqxnxq?.rows?.[0];
        return row ? row.DM : null;
    } catch (e) {
        console.warn('获取当前学期失败:', e);
        return null;
    }
}

/**
 * 让用户选择学年学期
 */
async function selectSemester() {
    // 获取当前学期
    const currentSemester = await fetchCurrentSemester();
    if (!currentSemester) {
        shiguangBridge.showToast('获取学期信息失败，请确保已登录');
        return null;
    }

    // 从当前学期提取学年
    const parts = currentSemester.split('-');
    const currentYear = `${parts[0]}-${parts[1]}`;

    // 生成选项
    const options = generateSemesterOptions(currentYear);
    const displayNames = options.map(o => o.displayName);

    // 找到当前学期的默认索引
    const defaultIndex = options.findIndex(o => o.xnxqdm === currentSemester);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期',
        JSON.stringify(displayNames),
        defaultIndex >= 0 ? defaultIndex : 0
    );

    if (selectedIndex === null || selectedIndex < 0) return null;
    return options[selectedIndex].xnxqdm;
}

// ==================== 课程数据获取与解析 ====================

/**
 * 从API获取课程数据
 */
async function fetchCourses(xnxqdm) {
    const response = await fetch(`${BASE_URL}/xskcb/xskcb.do`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: `XNXQDM=${xnxqdm}`,
        credentials: 'include'
    });
    if (!response.ok) throw new Error('请求课程数据失败');
    const data = await response.json();
    if (data.code !== '0') throw new Error('课程数据返回异常');
    return data?.datas?.xskcb?.rows || [];
}

/**
 * 按课程代码分组，合并同课程不同天的记录
 * API返回的每条记录是一门课在某一天的信息
 * 需要将同一KCH的记录合并，将多天信息聚合到一起
 */
function groupCoursesByCode(rows) {
    const grouped = {};
    for (const row of rows) {
        const key = `${row.KCH}_${row.KSJC}_${row.JASMC}`;
        if (!grouped[key]) {
            grouped[key] = {
                name: row.KCM || '',
                teacher: row.SKJS || '',
                position: row.JASMC || '',
                startSection: parseInt(row.KSJC, 10),
                endSection: parseInt(row.JSJC, 10),
                days: [],
                weeks: []
            };
        }
        const day = parseInt(row.SKXQ, 10);
        if (day >= 1 && day <= 7 && !grouped[key].days.includes(day)) {
            grouped[key].days.push(day);
        }
        const weeks = parseWeeksFromBinary(row.SKZC);
        grouped[key].weeks = [...new Set([...grouped[key].weeks, ...weeks])].sort((a, b) => a - b);
    }
    return Object.values(grouped);
}

/**
 * 将分组后的课程数据展开为拾光课程表格式
 * 每个课程 × 每天 生成一条独立记录
 */
function buildCourseList(groupedCourses) {
    const courses = [];
    for (const g of groupedCourses) {
        if (!g.name || g.days.length === 0 || g.weeks.length === 0) continue;
        for (const day of g.days) {
            courses.push({
                name: g.name,
                teacher: g.teacher,
                position: g.position,
                day: day,
                startSection: g.startSection,
                endSection: g.endSection,
                weeks: g.weeks
            });
        }
    }
    return courses;
}

// ==================== 时间段配置 ====================

const XJTU_TIME_SLOTS = [
    { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
    { "number": 2,  "startTime": "08:55", "endTime": "09:40" },
    { "number": 3,  "startTime": "10:00", "endTime": "10:45" },
    { "number": 4,  "startTime": "10:55", "endTime": "11:40" },
    { "number": 5,  "startTime": "14:00", "endTime": "14:45" },
    { "number": 6,  "startTime": "14:55", "endTime": "15:40" },
    { "number": 7,  "startTime": "16:00", "endTime": "16:45" },
    { "number": 8,  "startTime": "16:55", "endTime": "17:40" },
    { "number": 9,  "startTime": "19:00", "endTime": "19:45" },
    { "number": 10, "startTime": "19:55", "endTime": "20:40" },
    { "number": 11, "startTime": "20:50", "endTime": "21:35" }
];

async function importTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(XJTU_TIME_SLOTS));
    } catch (e) {
        console.warn('时间段导入失败:', e);
    }
}

// ==================== 主流程 ====================

async function importXJTUCourses() {
    try {
        // 1. 提示用户确认已登录
        const confirmed = await window.shiguangBridgePromise.showAlert(
            '课表导入',
            '导入前请确保已在浏览器中成功登录西安交通大学教务系统',
            '好的，开始导入'
        );
        if (!confirmed) {
            shiguangBridge.showToast('用户取消了导入');
            return;
        }

        // 2. 选择学年学期
        const xnxqdm = await selectSemester();
        if (!xnxqdm) {
            shiguangBridge.showToast('未选择学期，导入终止');
            return;
        }

        // 3. 获取课程数据
        shiguangBridge.showToast('正在获取课程数据...');
        const rows = await fetchCourses(xnxqdm);
        if (rows.length === 0) {
            shiguangBridge.showToast('该学期暂无课程数据');
            return;
        }

        // 4. 解析并构建课程列表
        const grouped = groupCoursesByCode(rows);
        const courses = buildCourseList(grouped);
        if (courses.length === 0) {
            shiguangBridge.showToast('课程数据解析失败');
            return;
        }

        // 5. 导入课程
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result !== true) {
            shiguangBridge.showToast('课程导入失败，请重试');
            return;
        }

        // 6. 导入时间段配置
        await importTimeSlots();

        // 7. 完成
        shiguangBridge.showToast(`成功导入 ${courses.length} 门课程`);
        shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error('XJTU导入错误:', error);
        shiguangBridge.showToast('导入出错: ' + error.message);
    }
}

// 启动导入
importXJTUCourses();
