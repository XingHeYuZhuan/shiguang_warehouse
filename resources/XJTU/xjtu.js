/**
 * 西安交通大学教务系统课表适配脚本
 * 适配页面: https://jwxt.xjtu.edu.cn/jwapp/sys/wdkb/xskcb/xskcb.jsp
 */

// ==================== 周次解析 ====================

/**
 * 解析周次字符串，返回周次数组
 * 支持格式:
 *   "1-12周"           → [1,2,...,12]
 *   "1周,4-5周,7-12周" → [1,4,5,7,8,9,10,11,12]
 *   "2-4周(双),6-12周" → [2,4,6,7,8,9,10,11,12]
 *   "1-16周(单)"       → [1,3,5,7,9,11,13,15]
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = new Set();
    // 去除空格和"周"字，按逗号分割各段
    const cleaned = weekStr.replace(/\s/g, '').replace(/周/g, '');
    const segments = cleaned.split(',');

    for (const seg of segments) {
        if (!seg) continue;
        // 判断是单周(单)还是双周(双)
        const isOdd = /\(单\)/.test(seg);
        const isEven = /\(双\)/.test(seg);
        // 去除括号标记后提取数字范围
        const numPart = seg.replace(/\(单\)/, '').replace(/\(双\)/, '');
        const rangeMatch = numPart.match(/^(\d+)-(\d+)$/);
        const singleMatch = numPart.match(/^(\d+)$/);

        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            for (let i = start; i <= end; i++) {
                if (isOdd && i % 2 === 0) continue;
                if (isEven && i % 2 !== 0) continue;
                weeks.add(i);
            }
        } else if (singleMatch) {
            weeks.add(parseInt(singleMatch[1], 10));
        }
    }
    return Array.from(weeks).sort((a, b) => a - b);
}

// ==================== 课程信息提取 ====================

/**
 * 从课程名称 div 中提取清理后的课程名
 * 输入: "【本】INFT500227 体域网传感与通信技术导论,9-16周[01]"
 * 输出: "体域网传感与通信技术导论"
 */
function extractCourseName(kcmcText) {
    if (!kcmcText) return '';
    let text = kcmcText.trim();
    // 去除前缀 【本】【硕】【博】等
    text = text.replace(/^【[^】]*】/, '');
    // 去除课程代码 (英文+数字组合后跟空格或&nbsp;)
    text = text.replace(/^[A-Z0-9]+\s*/, '');
    // 去除周次和节次信息 (从第一个逗号或数字+周 开始截断)
    text = text.replace(/,.*$/, '');
    text = text.replace(/\d+.*周.*$/, '');
    return text.trim();
}

/**
 * 从课程名称 div 中提取周次字符串
 * 输入: "【本】INFT500227 体域网传感与通信技术导论,9-16周[01]"
 * 输出: "9-16周"
 */
function extractWeekStr(kcmcText) {
    if (!kcmcText) return '';
    // 匹配 "数字-数字周" 或 "数字周" 以及带括号的变体
    const match = kcmcText.match(/(\d[\d,\-]*周(?:\([单双]\))?)/);
    return match ? match[1] : '';
}

/**
 * 从 room div 中提取教室地点
 * 输入: "体域网传感与通信技术导论,9-16周,星期1,3-4节,西2东-316,兴庆校区"
 * 输出: "西2东-316"
 */
function extractRoom(roomText) {
    if (!roomText) return '';
    // 地点通常在倒数第二个逗号分隔段（最后一个一般是校区）
    const parts = roomText.split(',').map(s => s.trim()).filter(s => s);
    if (parts.length >= 3) {
        // 倒数第二段是教室，去掉可能的 <br> 和校区信息
        let room = parts[parts.length - 2];
        // 去除 HTML 标签残留
        room = room.replace(/<[^>]*>/g, '').trim();
        return room;
    }
    return '';
}

/**
 * 从 teacher div 中提取教师姓名
 */
function extractTeacher(teacherEl) {
    if (!teacherEl) return '';
    // 教师名可能在多个子 div 中，用逗号连接
    const nameParts = [];
    const divs = teacherEl.querySelectorAll('div[style*="inline-block"]');
    if (divs.length > 0) {
        divs.forEach(d => {
            const name = d.textContent.replace(/,/g, '').trim();
            if (name) nameParts.push(name);
        });
    } else {
        const text = teacherEl.textContent.replace(/,/g, '').trim();
        if (text) nameParts.push(text);
    }
    return nameParts.join(',');
}

// ==================== 主逻辑 ====================

async function importXJTUCourses() {
    try {
        // 1. 检查页面是否有课程表
        const table = document.querySelector('#kcb_container table.wut_table');
        if (!table) {
            shiguangBridge.showToast('未找到课程表，请确认已登录并打开课表页面');
            return;
        }

        // 2. 提取所有有课程的单元格
        const cells = document.querySelectorAll('td[data-role="item"]');
        const courses = [];
        const seen = new Set(); // 去重：同一课程在同一天同时段只导入一次

        cells.forEach(cell => {
            const day = parseInt(cell.getAttribute('data-week'), 10);
            const startSection = parseInt(cell.getAttribute('data-begin-unit'), 10);
            const endSection = parseInt(cell.getAttribute('data-end-unit'), 10);

            // 获取课程信息 div
            const items = cell.querySelectorAll('.mtt_arrange_item');
            items.forEach(item => {
                const kcmcEl = item.querySelector('.mtt_item_kcmc');
                const teacherEl = item.querySelector('.mtt_item_jxbmc');
                const roomEl = item.querySelector('.mtt_item_room');

                if (!kcmcEl) return;

                const kcmcText = kcmcEl.textContent || '';
                const name = extractCourseName(kcmcText);
                const weekStr = extractWeekStr(kcmcText);
                const teacher = extractTeacher(teacherEl);
                const room = extractRoom(roomEl ? roomEl.textContent : '');
                const weeks = parseWeeks(weekStr);

                if (!name || weeks.length === 0) return;

                // 构建唯一键用于去重
                const key = `${name}-${day}-${startSection}-${endSection}-${weeks.join(',')}`;
                if (seen.has(key)) return;
                seen.add(key);

                courses.push({
                    name: name,
                    teacher: teacher,
                    position: room,
                    day: day,
                    startSection: startSection,
                    endSection: endSection,
                    weeks: weeks
                });
            });
        });

        if (courses.length === 0) {
            shiguangBridge.showToast('未找到课程数据，请确认课表已加载');
            return;
        }

        // 3. 导入课程
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            shiguangBridge.showToast(`成功导入 ${courses.length} 门课程`);
        } else {
            shiguangBridge.showToast('课程导入失败，请重试');
        }

        // 4. 导入XJTU预设时间段
        await importXJTUTimeSlots();

        // 5. 通知完成
        shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error('XJTU导入错误:', error);
        shiguangBridge.showToast('导入出错: ' + error.message);
    }
}

/**
 * 导入西安交通大学预设时间段
 * XJTU使用11节制：上午4节 + 下午4节 + 晚上3节
 */
async function importXJTUTimeSlots() {
    const timeSlots = [
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

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (e) {
        console.warn('时间段导入失败:', e);
    }
}

// 启动导入
importXJTUCourses();
