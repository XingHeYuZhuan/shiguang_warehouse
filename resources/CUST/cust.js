// 文件: school.js
// 长春理工大学教务系统课程表导入脚本

// 检查是否在正确的页面
function isOnStudentPage() {
    const url = window.location.href;
    return /jwgls[0-4]\.cust\.edu\.cn\/Student/i.test(url);
}

// 解析周数字符串（如 "1-8周[1-2节]" -> [1,2,3,4,5,6,7,8]）
function parseWeeks(timeStr) {
    const weeks = [];
    const weekMatch = timeStr.match(/(\d+)(?:-(\d+))?周/);
    if (weekMatch) {
        const start = parseInt(weekMatch[1]);
        const end = weekMatch[2] ? parseInt(weekMatch[2]) : start;
        for (let i = start; i <= end; i++) {
            weeks.push(i);
        }
    }
    return weeks;
}

// 解析节次字符串（如 "第1-2节" -> {start: 1, end: 2}）
function parseSections(sectionStr) {
    const match = sectionStr.match(/第(\d+)(?:-(\d+))?节/);
    if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : start;
        return { start, end };
    }
    return null;
}

// 从API响应中提取并转换课程数据
function convertScheduleData(apiData) {
    const coursesMap = new Map(); // 使用Map来临时存储和合并课程
    const timeSlots = new Set();

    // 遍历每一天
    apiData.data.AdjustDays.forEach(day => {
        const dayIndex = day.WIndex; // 1=周一, 7=周日

        // 处理所有时间段
        const allTimePieces = [
            ...(day.AM__TimePieces || []),
            ...(day.PM__TimePieces || []),
            ...(day.EV__TimePieces || [])
        ];

        allTimePieces.forEach(timePiece => {
            // 记录时间段
            if (timePiece.StartSection && timePiece.EndSection) {
                timeSlots.add(JSON.stringify({
                    startSection: timePiece.StartSection,
                    endSection: timePiece.EndSection,
                    startTime: timePiece.StartTime,
                    endTime: timePiece.EndTime
                }));
            }

            // 处理课程
            if (timePiece.Dtos && timePiece.Dtos.length > 0) {
                timePiece.Dtos.forEach(dto => {
                    const content = dto.Content || [];

                    // 提取课程信息
                    let courseName = '';
                    let teacher = [];
                    let room = '';
                    let weeks = [];
                    let timeInfo = '';

                    content.forEach(item => {
                        switch(item.Key) {
                            case 'Lesson':
                                courseName = item.Name;
                                break;
                            case 'Teacher':
                                teacher.push(item.Name);
                                break;
                            case 'Room':
                                room = item.Name;
                                break;
                            case 'Time':
                                timeInfo = item.Name;
                                weeks = parseWeeks(item.Name);
                                break;
                        }
                    });

                    if (courseName && weeks.length > 0) {
                        // 创建唯一键来识别相同的课程（同一天、同一课程、同一老师、同一地点、同一周次）
                        const courseKey = `${dayIndex}-${courseName}-${teacher.join('、')}-${room}-${weeks.join(',')}`;

                        if (coursesMap.has(courseKey)) {
                            // 如果已存在，更新节次范围
                            const existingCourse = coursesMap.get(courseKey);
                            existingCourse.startSection = Math.min(existingCourse.startSection, timePiece.StartSection);
                            existingCourse.endSection = Math.max(existingCourse.endSection, timePiece.EndSection);
                        } else {
                            // 如果不存在，创建新课程
                            coursesMap.set(courseKey, {
                                name: courseName,
                                teacher: teacher.join('、'),
                                position: room || '未指定',
                                day: dayIndex,
                                startSection: timePiece.StartSection,
                                endSection: timePiece.EndSection,
                                weeks: weeks
                            });
                        }
                    }
                });
            }
        });
    });

    // 将Map转换为数组
    const courses = Array.from(coursesMap.values());

    // 按照星期和节次排序
    courses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.endSection - b.endSection;
    });

    console.log(`合并后的课程数量: ${courses.length}`);

    return { courses, timeSlots: Array.from(timeSlots).map(s => JSON.parse(s)) };
}

// 获取课表数据
async function fetchScheduleData() {
    try {
        console.log('正在获取课表数据...');

        // 构建请求参数（完整的参数结构）
        const requestData = {
            "param": "JTdCJTdE",
            "__permission": {
                "MenuID": "00000000-0000-0000-0000-000000000000",
                "Operate": "select",
                "Operation": 0
            },
            "__log": {
                "MenuID": "00000000-0000-0000-0000-000000000000",
                "Logtype": 6,
                "Context": "查询"
            }
        };

        // 获取当前域名
        const currentHost = window.location.hostname;
        const apiUrl = `https://${currentHost}/api/ClientStudent/Home/StudentHomeApi/QueryStudentScheduleData`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json;charset=UTF-8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            credentials: 'include',
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.state !== 0) {
            throw new Error(data.message || '获取课表失败');
        }

        console.log('成功获取课表数据:', data);
        return data;

    } catch (error) {
        console.error('获取课表数据失败:', error);
        window.shiguangBridge.showToast('获取课表失败: ' + error.message);
        return null;
    }
}

// 生成时间段配置
function generateTimeSlots(timeSlotsFromAPI) {
    const defaultTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:35" },
        { "number": 3, "startTime": "10:05", "endTime": "10:50" },
        { "number": 4, "startTime": "11:00", "endTime": "11:40" },
        { "number": 5, "startTime": "13:30", "endTime": "14:15" },
        { "number": 6, "startTime": "14:25", "endTime": "15:05" },
        { "number": 7, "startTime": "15:35", "endTime": "16:20" },
        { "number": 8, "startTime": "16:30", "endTime": "17:10" },
        { "number": 9, "startTime": "18:00", "endTime": "18:45" },
        { "number": 10, "startTime": "18:45", "endTime": "19:35" },
        { "number": 11, "startTime": "19:45", "endTime": "20:30" },
        { "number": 12, "startTime": "20:30", "endTime": "21:20" }
    ];

    // 如果API提供了时间信息，更新默认时间
    if (timeSlotsFromAPI && timeSlotsFromAPI.length > 0) {
        timeSlotsFromAPI.forEach(slot => {
            for (let i = slot.startSection; i <= slot.endSection; i++) {
                const timeSlot = defaultTimeSlots.find(t => t.number === i);
                if (timeSlot && i === slot.startSection) {
                    timeSlot.startTime = slot.startTime;
                }
                if (timeSlot && i === slot.endSection) {
                    timeSlot.endTime = slot.endTime;
                }
            }
        });
    }

    return defaultTimeSlots;
}

// 主函数：导入课程
async function importCourseSchedule() {
    try {
        console.log('开始导入课程表...');
        window.shiguangBridge.showToast('正在获取课表数据...');

        // 获取课表数据
        const scheduleData = await fetchScheduleData();
        if (!scheduleData) {
            return false;
        }

        // 转换数据
        const { courses, timeSlots } = convertScheduleData(scheduleData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast('未找到课程数据');
            return false;
        }

        console.log(`找到 ${courses.length} 门课程`);
        console.log('课程数据:', courses);

        // 导入课程
        const coursesResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (coursesResult === true) {
            console.log('课程导入成功！');
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        } else {
            console.log('课程导入失败');
            window.shiguangBridge.showToast('课程导入失败');
            return false;
        }

        // 生成并导入时间段
        const finalTimeSlots = generateTimeSlots(timeSlots);
        console.log('时间段配置:', finalTimeSlots);

        const timeSlotsResult = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(finalTimeSlots));
        if (timeSlotsResult === true) {
            console.log('时间段导入成功！');
            window.shiguangBridge.showToast('时间段配置成功！');
        } else {
            console.log('时间段导入失败');
            window.shiguangBridge.showToast('时间段配置失败');
        }

        return true;

    } catch (error) {
        console.error('导入过程出错:', error);
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

// ========== 以下是原有的演示函数（保留以供测试） ==========

// 1. 显示一个公告信息弹窗
async function demoAlert() {
    try {
        console.log("即将显示公告弹窗...");
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "重要通知",
            "这是一个弹窗示例。",
            "好的"
        );
        if (confirmed) {
            console.log("用户点击了确认按钮。Alert Promise Resolved: " + confirmed);
            window.shiguangBridge.showToast("Alert：用户点击了确认！");
            return true; // 成功时返回 true
        } else {
            console.log("用户点击了取消按钮或关闭了弹窗。Alert Promise Resolved: " + confirmed);
            window.shiguangBridge.showToast("Alert：用户取消了！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示公告弹窗时发生错误:", error);
        window.shiguangBridge.showToast("Alert：显示弹窗出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

// 2. 显示带输入框的弹窗，并进行简单验证
function validateName(name) {
    if (name === null || name.trim().length === 0) {
        return "输入不能为空！";
    }
    if (name.length < 2) {
        return "姓名至少需要2个字符！";
    }
    return false;
}

async function demoPrompt() {
    try {
        console.log("即将显示输入框弹窗...");
        const name = await window.shiguangBridgePromise.showPrompt(
            "输入你的姓名",
            "请输入至少2个字符",
            "测试用户",
            "validateName"
        );
        if (name !== null) {
            console.log("用户输入的姓名是: " + name);
            window.shiguangBridge.showToast("欢迎你，" + name + "！");
            return true; // 成功时返回 true
        } else {
            console.log("用户取消了输入。");
            window.shiguangBridge.showToast("Prompt：用户取消了输入！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示输入框弹窗时发生错误:", error);
        window.shiguangBridge.showToast("Prompt：显示输入框出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

// 3. 显示一个单选列表弹窗
async function demoSingleSelection() {
    const fruits = ["苹果", "香蕉", "橙子", "葡萄", "西瓜", "芒果"];
    try {
        console.log("即将显示单选列表弹窗...");
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择你喜欢的水果",
            JSON.stringify(fruits),
            2
        );
        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < fruits.length) {
            console.log("用户选择了: " + fruits[selectedIndex] + " (索引: " + selectedIndex + ")");
            window.shiguangBridge.showToast("你选择了 " + fruits[selectedIndex]);
            return true; // 成功时返回 true
        } else {
            console.log("用户取消了选择。");
            window.shiguangBridge.showToast("Single Selection：用户取消了选择！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示单选列表弹窗时发生错误:", error);
        window.shiguangBridge.showToast("Single Selection：显示列表出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

// 仍然可以使用原始的 AndroidBridge 对象
window.shiguangBridge.showToast("这是一个来自 JS 的 Toast 消息，会很快消失！");

async function demoSaveCourses() {
    // ... 代码保持不变 ...
    console.log("正在准备测试课程数据...");
    const testCourses = [
    {
        "name": "高等数学",
        "teacher": "张教授",
        "position": "教101",
        "day": 1,
        "startSection": 1,
        "endSection": 2,
        "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    {
        "name": "大学英语",
        "teacher": "李老师",
        "position": "文史楼203",
        "day": 1,
        "startSection": 2,
        "endSection": 4,
        "weeks": [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    },
    {
        "name": "数据结构",
        "teacher": "王副教授",
        "position": "信息楼B301",
        "day": 7,
        "startSection": 2,
        "endSection": 2,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "数据结构",
        "teacher": "王副教授",
        "position": "信息楼B301",
        "day": 7,
        "startSection": 3,
        "endSection": 3,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "数据结构",
        "teacher": "王副教授",
        "position": "信息楼B301",
        "day": 7,
        "startSection": 4,
        "endSection": 4,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "数据结构",
        "teacher": "王副教授",
        "position": "信息楼B301",
        "day": 7,
        "startSection": 5,
        "endSection": 5,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "数据结构",
        "teacher": "王副教授",
        "position": "信息楼B301",
        "day": 7,
        "startSection": 6,
        "endSection": 6,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "计算机组成原理",
        "teacher": "赵教授",
        "position": "实验楼401",
        "day": 4,
        "startSection": 4,
        "endSection": 4,
        "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    {
        "name": "操作系统",
        "teacher": "钱副教授",
        "position": "信息楼C205",
        "day": 5,
        "startSection": 5,
        "endSection": 5,
        "weeks": [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    },
    {
        "name": "计算机网络",
        "teacher": "孙教授",
        "position": "信息楼D103",
        "day": 6,
        "startSection": 6,
        "endSection": 6,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "软件工程",
        "teacher": "周副教授",
        "position": "创新楼301",
        "day": 7,
        "startSection": 7,
        "endSection": 7,
        "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    {
        "name": "数据库原理",
        "teacher": "吴教授",
        "position": "信息楼E201",
        "day": 1,
        "startSection": 8,
        "endSection": 8,
        "weeks": [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    },
    {
        "name": "人工智能",
        "teacher": "郑副教授",
        "position": "智能楼101",
        "day": 2,
        "startSection": 9,
        "endSection": 9,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "机器学习",
        "teacher": "冯教授",
        "position": "智能楼203",
        "day": 3,
        "startSection": 10,
        "endSection": 10,
        "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    {
        "name": "编译原理",
        "teacher": "陈副教授",
        "position": "信息楼F105",
        "day": 4,
        "startSection": 11,
        "endSection": 11,
        "weeks": [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    },
    {
        "name": "计算机图形学",
        "teacher": "褚教授",
        "position": "图形楼301",
        "day": 5,
        "startSection": 12,
        "endSection": 12,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "网络安全",
        "teacher": "卫副教授",
        "position": "安全楼201",
        "day": 6,
        "startSection": 13,
        "endSection": 13,
        "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    {
        "name": "分布式系统",
        "teacher": "蒋教授",
        "position": "云楼101",
        "day": 7,
        "startSection": 14,
        "endSection": 14,
        "weeks": [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    },
    {
        "name": "大数据技术",
        "teacher": "沈副教授",
        "position": "数据楼301",
        "day": 1,
        "startSection": 15,
        "endSection": 15,
        "weeks": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
    },
    {
        "name": "物联网技术",
        "teacher": "韩教授",
        "position": "物联楼201",
        "day": 2,
        "startSection": 16,
        "endSection": 16,
        "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    }
    ];

    try {
        console.log("正在尝试导入课程...");
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(testCourses));
        if (result === true) {
            console.log("课程导入成功！");
            window.shiguangBridge.showToast("测试课程导入成功！");
        } else {
            console.log("课程导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        window.shiguangBridge.showToast("导入课程失败: " + error.message);
    }
}

// 5. 导入预设时间段（保持不变）
async function importPresetTimeSlots() {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:01" },
        { "number": 2, "startTime": "09:00", "endTime": "09:01" },
        { "number": 3, "startTime": "10:00", "endTime": "10:01" },
        { "number": 4, "startTime": "11:00", "endTime": "11:01" },
        { "number": 5, "startTime": "12:00", "endTime": "12:01" },
        { "number": 6, "startTime": "13:00", "endTime": "13:01" },
        { "number": 7, "startTime": "14:00", "endTime": "14:01" },
        { "number": 8, "startTime": "15:00", "endTime": "15:01" },
        { "number": 9, "startTime": "16:00", "endTime": "16:01" },
        { "number": 10, "startTime": "17:00", "endTime": "17:01" },
        { "number": 11, "startTime": "18:00", "endTime": "18:01" },
        { "number": 12, "startTime": "19:00", "endTime": "19:01" },
        { "number": 13, "startTime": "20:00", "endTime": "20:01" },
        { "number": 14, "startTime": "21:00", "endTime": "21:01" },
        { "number": 15, "startTime": "22:00", "endTime": "22:01" },
        { "number": 16, "startTime": "23:00", "endTime": "23:01" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.shiguangBridge.showToast("测试时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试时间段导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

/**
 * 编排这些异步操作，并在用户取消时停止后续执行。
 */
async function runAllDemosSequentially() {
    window.shiguangBridge.showToast("所有演示将按顺序开始...");

    // 1. 运行第一个演示：Alert
    const alertResult = await demoAlert();
    if (!alertResult) {
        console.log("用户取消了 Alert 演示，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    // 2. 运行第二个演示：Prompt
    const promptResult = await demoPrompt();
    if (!promptResult) {
        console.log("用户取消了 Prompt 演示，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    // 3. 运行第三个演示：SingleSelection
    const selectionResult = await demoSingleSelection();
    if (!selectionResult) {
        console.log("用户取消了 Single Selection 演示，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    console.log("所有弹窗演示已完成。");
    window.shiguangBridge.showToast("所有弹窗演示已完成！");

    // 以下是数据导入，与用户交互无关，可以继续
    await demoSaveCourses();
    await importPresetTimeSlots();

    // 发送最终的生命周期完成信号
    window.shiguangBridge.notifyTaskCompletion();
}

// ========== 主执行逻辑 ==========

// 检查页面并执行相应操作
if (isOnStudentPage()) {
    console.log('检测到在长春理工大学教务系统学生页面');
    window.shiguangBridge.showToast('正在准备导入课程表...');

    // 延迟一秒确保页面加载完成
    setTimeout(async () => {
        const success = await importCourseSchedule();
        if (success) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    }, 1000);

} else {
    console.log('当前不在教务系统页面，运行演示模式');
    window.shiguangBridge.showToast('请先登录教务系统！');

    // 可选：运行演示
    const runDemo = false; // 设为true可以运行演示
    if (runDemo) {
        runAllDemosSequentially();
    }
}