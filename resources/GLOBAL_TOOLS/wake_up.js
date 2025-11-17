// 拾光课程表适配 Wakeup 课表分享口令

/**
 * 验证用户输入，确保 Key 不为空。
 * 该函数必须在全局作用域中定义。
 * @param {string} key 用户输入的分享 Key
 * @returns {false|string} 验证成功返回 false，否则返回错误信息。
 */
function validateKey(key) {
    if (key === null || key.trim().length === 0) {
        return "课表分享 Key 不能为空！";
    }
    return false; // 验证通过
}

/**
 * 将原始 JSON 字符串数组解析成各个部分。
 * 原始数据是多个 JSON 块用换行符分隔。
 * @param {string} rawData 原始的 JSON 字符串，包含多个部分。
 * @returns {object} 包含解析后数据的对象。
 */
function parseRawScheduleData(rawData) {
    AndroidBridge.showToast("正在解析原始数据...");
    
    const parts = rawData.trim().split('\n');
    if (parts.length < 5) { // 至少需要 5 个部分
        throw new Error("数据格式不完整，预期至少包含 5 个部分。");
    }
    
    // 尝试解析关键部分
    const baseConfig = JSON.parse(parts[0]);
    const timeSlotsRaw = JSON.parse(parts[1]);
    const uiConfig = JSON.parse(parts[2]);
    const coursesRaw = JSON.parse(parts[3]);
    const courseDetailRaw = JSON.parse(parts[4]);
    
    return {
        baseConfig,
        timeSlotsRaw,
        uiConfig,
        coursesRaw,
        courseDetailRaw
    };
}

/**
 * 格式化日期对象为 YYYY-MM-DD 字符串。
 * @param {Date} dateObj 日期对象
 * @returns {string} YYYY-MM-DD 格式的字符串
 */
function formatDateToYYYYMMDD(dateObj) {
    const year = dateObj.getFullYear();
    // 确保月份和日期带有前导零（例如 9 -> 09）
    const month = String(dateObj.getMonth() + 1).padStart(2, '0'); 
    const day = String(dateObj.getDate()).padStart(2, '0');       
    return `${year}-${month}-${day}`;
}

/**
 * 尝试将原始日期值转换为 YYYY-MM-DD 格式的字符串。
 * @param {*} rawDate 原始日期值 
 * @returns {string|null} YYYY-MM-DD 格式的日期字符串，或 null。
 */
function convertToSemesterStartDate(rawDate) {
    if (!rawDate) {
        return null;
    }
    
    let dateString = String(rawDate).trim();
    if (dateString.length === 0) {
        return null;
    }

    // 尝试替换斜杠为短横线
    dateString = dateString.replace(/\//g, '-');
    
    // 尝试解析为 Date 对象
    const dateObj = new Date(dateString);

    if (isNaN(dateObj.getTime())) {
        console.warn(`WARN: 无法将原始日期值 "${rawDate}" 转换为有效日期。`);
        return null; 
    }

    return formatDateToYYYYMMDD(dateObj);
}


/**
 * 网络请求、数据解析和转换。
 * @param {string} shareKey 用户输入的 Key。
 * @returns {object|null} 包含转换后的 timeSlots 和 config 数据的对象，失败返回 null。
 */
async function fetchAndParseData(shareKey) {
    try {
        const apiUrl = `https://i.wakeup.fun/share_schedule/get?key=${shareKey.trim()}`;
        console.log("正在请求课表数据:", apiUrl);
        AndroidBridge.showToast("正在请求课表数据...");

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`网络请求失败，状态码: ${response.status}`);
        }
        
        const apiJson = await response.json();

        if (apiJson.status !== 1) {
            throw new Error(`API 返回失败信息: ${apiJson.message}`);
        }
        
        const rawData = apiJson.data;
        const parsedData = parseRawScheduleData(rawData);
        
        // --- 转换数据结构 ---
        let rawNodes = parsedData.uiConfig.nodes;

        if (!Array.isArray(rawNodes)) {
             if (typeof rawNodes === 'number' && rawNodes > 0) {
                 console.warn(`WARN: uiConfig.nodes 预期为数组，但获取到总节数: ${rawNodes}。正在生成 1 到 ${rawNodes} 的节次列表。`);
                 
                 rawNodes = Array.from({ length: rawNodes }, (_, i) => i + 1);
             } else {
                 // 既不是数组也不是有效数字，退回空数组
                 console.warn(`WARN: uiConfig.nodes 数据无效 (${rawNodes})，已重置为空数组。`);
                 rawNodes = [];
             }
        }

        const validNodes = new Set(rawNodes);

        // 1. 转换预设时间段 (TimeSlotJsonModel)
        const timeSlots = parsedData.timeSlotsRaw
            .filter(slot => slot.startTime !== "00:00" && slot.endTime !== "00:00")
            .filter(slot => validNodes.has(slot.node)) 
            .map(slot => ({
                "number": slot.node,
                "startTime": slot.startTime,
                "endTime": slot.endTime
            }));
            
        const semesterStartDate = convertToSemesterStartDate(parsedData.uiConfig.startDate);
        
        const courseConfig = {
            "semesterStartDate": semesterStartDate,
            "semesterTotalWeeks": parsedData.uiConfig.maxWeek, 
            "defaultClassDuration": parsedData.baseConfig.courseLen, 
            "defaultBreakDuration": parsedData.baseConfig.theBreakLen, 
        };
        
        const courses = convertToCourseJsonModel(parsedData);
        
        AndroidBridge.showToast(`数据解析成功，共 ${courses.length} 门课程`);
        
        return { timeSlots, courseConfig, courses };

    } catch (error) {
        console.error("数据获取或解析失败:", error);
        AndroidBridge.showToast("数据获取或解析失败: " + error.message);
        return null; // 失败时返回 null
    }
}

/**
 * 将课程数据从原始结构转换为 CourseJsonModel 格式。
 * @param {object} parsedData 包含 coursesRaw 和 courseDetailRaw 的解析数据。
 * @returns {Array<object>} 符合 CourseJsonModel 结构的课程数组。
 */
function convertToCourseJsonModel(parsedData) {
    const { coursesRaw, courseDetailRaw } = parsedData;
    const finalCourses = [];

    // 创建课程ID到课程信息的映射
    const courseMap = coursesRaw.reduce((map, course) => {
        map[course.id] = course;
        return map;
    }, {});

    // 遍历课程安排详情，构建最终的 CourseJsonModel
    courseDetailRaw.forEach(detail => {
        if (detail.id === undefined || detail.id === null) return;
        
        const courseInfo = courseMap[detail.id];
        if (!courseInfo) return; 

        // 计算 weeks 数组
        const weeks = [];
        for (let i = detail.startWeek; i <= detail.endWeek; i++) {
            if (detail.type === 0 || // 每周
                (detail.type === 1 && i % 2 !== 0) || // 单周 (奇数周)
                (detail.type === 2 && i % 2 === 0)) { // 双周 (偶数周)
                weeks.push(i);
            }
        }
        
        // 转换 startSection 和 endSection
        const startSection = detail.startNode;
        const endSection = detail.startNode + detail.step - 1;
        
        // 构造 CourseJsonModel 对象
        const course = {
            "name": courseInfo.courseName, 
            "teacher": detail.teacher || "",
            "position": detail.room || "",
            "day": detail.day, 
            "startSection": startSection,
            "endSection": endSection,
            "weeks": weeks
        };

        finalCourses.push(course);
    });

    return finalCourses;
}



async function saveTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        AndroidBridge.showToast("没有可导入的时间段数据。");
        return true;
    }
    try {
        console.log("正在导入时间段...");
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        AndroidBridge.showToast(`成功导入 ${timeSlots.length} 个时间段！`);
        return true;
    } catch (error) {
        console.error("导入时间段失败:", error);
        AndroidBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

async function saveConfig(configData) {
    try {
        console.log("正在导入课表配置...");
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(configData));
        AndroidBridge.showToast("课表配置（学期/时长）更新成功！");
        return true;
    } catch (error) {
        console.error("导入配置失败:", error);
        AndroidBridge.showToast("导入配置失败: " + error.message);
        return false;
    }
}

async function saveCourses(courses) {
    if (courses.length === 0) {
        AndroidBridge.showToast("没有课程数据需要导入。");
        return true;
    }
    try {
        console.log("正在导入课程数据...");
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        AndroidBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        return true;
    } catch (error) {
        console.error("导入课程失败:", error);
        AndroidBridge.showToast("导入课程失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    console.log("Wakeup 课表分享导入流程启动...");
    AndroidBridge.showToast("课表导入流程即将开始...");

    // 获取用户输入 Key
    const shareKey = await window.AndroidBridgePromise.showPrompt(
        "输入课表分享 Key",
        "请输入从分享链接中获取的 Key",
        "",
        "validateKey"
    );
    if (shareKey === null) {
        AndroidBridge.showToast("导入已取消。");
        return;
    }

    // 网络请求和数据解析
    const parsed = await fetchAndParseData(shareKey);
    if (parsed === null) {
        return;
    }

    // 导入时间段
    const timeSlotResult = await saveTimeSlots(parsed.timeSlots);
    if (!timeSlotResult) {
        return;
    }

    // 导入配置
    const configResult = await saveConfig(parsed.courseConfig);
    if (!configResult) {
        return;
    }
    
    // 导入课程数据
    const courseSaveResult = await saveCourses(parsed.courses);
    if (!courseSaveResult) {
        return;
    }

    // 流程完全成功，发送结束信号
    AndroidBridge.showToast("所有任务已成功完成！");
    AndroidBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();