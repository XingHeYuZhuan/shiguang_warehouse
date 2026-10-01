/**
 * 定义一个全局的学年验证函数。
 * 这个函数会在 Android 的 Compose UI PromptDialog 中被调用。
 */
function validateYearInput(input) {
    console.log("JS: validateYearInput 被调用，输入: " + input);
    if (/^[0-9]{4}$/.test(input)) {
        console.log("JS: validateYearInput 验证通过。");
        // 返回字符串 "false" 表示验证通过
        return false;
    } else {
        console.log("JS: validateYearInput 验证失败。");
        // 返回错误信息字符串
        return "请输入四位数字的学年！";
    }
}

/**
 * 公告的函数。
 */
async function demoAlert() {
    try {
        const confirmed = await window.AndroidBridgePromise.showAlert(
            "公告",
            "欢迎使用教务导入",
            "开始"
        );
        if (confirmed) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        return false;
    }
}

/**
 * 解析课程数据的函数。
 */
function parseShzqCourseData(rawData) {
    const importedCourses = [];
    console.log("JS: parseShzqCourseData: 正在解析原始数据...");

    if (rawData && rawData.kbList && Array.isArray(rawData.kbList)) {
        rawData.kbList.forEach(courseItem => {
            try {
                const name = courseItem.kcmc || "未知课程";
                const teacher = courseItem.xm || "未知教师";
                const position = courseItem.cdmc || "未知地点";
                const day = parseInt(courseItem.xqj, 10);
                if (isNaN(day)) {
                    console.warn(`JS: 无效的星期几数据: ${courseItem.xqj}，课程:${name}`);
                }
                const rawJcs = String(courseItem.jcs);
                let startLesson = 0;
                let endLesson = 0;
                const jcsRangeMatch = rawJcs.match(/(\d+)-(\d+)/);
                if (jcsRangeMatch) {
                    startLesson = parseInt(jcsRangeMatch[1], 10);
                    endLesson = parseInt(jcsRangeMatch[2], 10);
                } else if (rawJcs.length === 2) {
                    startLesson = parseInt(rawJcs, 10);
                    endLesson = startLesson;
                } else if (rawJcs.length === 4) {
                    startLesson = parseInt(rawJcs.substring(0, 2), 10);
                    endLesson = parseInt(rawJcs.substring(2, 4), 10);
                } else {
                    console.warn(`JS: 未知 jcs 格式: ${rawJcs}`);
                }
                const rawWeeks = courseItem.zcd;
                const weeks = [];
                if (rawWeeks) {
                    const weekMatchRange = rawWeeks.match(/(\d+)-(\d+)周/);
                    const weekMatchSingle = rawWeeks.match(/\d+/g);
                    if (weekMatchRange) {
                        const startWeek = parseInt(weekMatchRange[1], 10);
                        const endWeek = parseInt(weekMatchRange[2], 10);
                        for (let i = startWeek; i <= endWeek; i++) {
                            if (rawWeeks.includes("(单)") && i % 2 === 0) continue;
                            if (rawWeeks.includes("(双)") && i % 2 !== 0) continue;
                            weeks.push(i);
                        }
                    } else if (weekMatchSingle) {
                        weekMatchSingle.forEach(w => weeks.push(parseInt(w, 10)));
                    }
                }
                importedCourses.push({
                    name: name, teacher: teacher, position: position, day: day,
                    startSection: startLesson, endSection: endLesson, weeks: weeks
                });
            } catch (e) {
                console.warn("JS: 解析单门课程时出错:", e);
            }
        });
    } else {
        console.warn("JS: rawData 结构不符合预期或 kbList 不存在:", rawData);
    }
    console.log("JS: parseShzqCourseData: 解析完成，课程数:", importedCourses.length);
    return importedCourses;
}

/**
 * 检查当前页面是否为登录页面。
 * @returns {boolean} 如果是登录页面则返回 true。
 */
function isLoginPage() {
    const url = window.location.href;
    // 检查 URL 是否包含特定的登录页面路径
    return url.includes('jw.shzq.edu.cn/jwglxt/xtgl/login_slogin.html');
}

/**
 * 步骤 1: 异步获取学年和学期。
 * @returns {{xnm: string, xqm: string}|null} 返回包含学年和学期码的对象，如果用户取消则返回 null。
 */
async function getYearAndSemester() {
    try {
        let currentYear = new Date().getFullYear();
        const yearSelection = await AndroidBridgePromise.showPrompt(
            "选择学年", "请输入要导入课程的学年（如 " + currentYear + "）:",
            String(currentYear), "validateYearInput"
        );
        if (yearSelection === null) {
            AndroidBridge.showToast("导入取消：未选择学年。");
            return null;
        }
        const xnm = yearSelection;

        const semesters = ["1（第一学期）", "2（第二学期）"];
        const semesterIndex = await AndroidBridgePromise.showSingleSelection(
            "选择学期", JSON.stringify(semesters), -1
        );
        if (semesterIndex === null || semesterIndex === -1) {
            AndroidBridge.showToast("导入取消：未选择学期。");
            return null;
        }
        const xqmMapping = { 0: "3", 1: "12" };
        const xqm = xqmMapping[semesterIndex];

        return { xnm, xqm };
    } catch (error) {
        console.error("JS: 获取学年学期时出错:", error);
        AndroidBridge.showToast("获取学年学期失败：" + error.message);
        return null;
    }
}

/**
 * 步骤 2: 异步发送网络请求获取课程数据。
 * @param {string} xnm 学年
 * @param {string} xqm 学期码
 * @returns {Array<object>|null} 返回解析后的课程列表，如果失败则返回 null。
 */
async function fetchCourses(xnm, xqm) {
    try {
        AndroidBridge.showToast(`正在获取学期课程...`);
        const requestBody = `xnm=${xnm}&xqm=${xqm}&kzlx=ck&xsdm=`;
        const response = await fetch("https://jw.shzq.edu.cn/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: requestBody
        });
        if (!response.ok) {
            throw new Error(`网络请求失败，状态码: ${response.status}`);
        }
        const data = await response.json();
        const courses = parseShzqCourseData(data);
        if (courses.length === 0) {
            AndroidBridge.showToast("未找到任何课程数据，请检查学年学期或登录状态。");
            return null;
        }
        return courses;
    } catch (error) {
        console.error("JS: 获取课程数据时出错:", error);
        AndroidBridge.showToast(`获取课程失败: ${error.message || error}`);
        return null;
    }
}

/**
 * 步骤 3: 异步保存课程数据。
 * @param {Array<object>} courses 要保存的课程列表。
 * @returns {boolean} 保存成功返回 true，否则返回 false。
 */
async function saveCourses(courses) {
    try {
        await AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
        AndroidBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        return true;
    } catch (error) {
        console.error("JS: 保存课程时出错:", error);
        AndroidBridge.showToast(`保存失败: ${error.message || error}`);
        return false;
    }
}

async function importPresetTimeSlots() {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:35", "endTime": "09:15" },
        { "number": 2, "startTime": "09:15", "endTime": "09:55" },
        { "number": 3, "startTime": "10:10", "endTime": "10:50" },
        { "number": 4, "startTime": "10:50", "endTime": "11:30" },
        { "number": 5, "startTime": "12:35", "endTime": "13:15" },
        { "number": 6, "startTime": "13:15", "endTime": "13:55" },
        { "number": 7, "startTime": "14:10", "endTime": "14:50" },
        { "number": 8, "startTime": "14:50", "endTime": "15:30" },
        { "number": 9, "startTime": "15:45", "endTime": "16:25" },
        { "number": 10, "startTime": "16:25", "endTime": "17:05" },
        { "number": 11, "startTime": "18:15", "endTime": "18:55" },
        { "number": 12, "startTime": "18:55", "endTime": "19:35" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.AndroidBridge.showToast("测试时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.AndroidBridge.showToast("测试时间段导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.AndroidBridge.showToast("导入时间段失败: " + error.message);
    }
}
/**
 * 编排所有异步操作，并按顺序执行，用户取消则停止。
 */
async function runImportShzqCourses() {
    if (isLoginPage()) {
        AndroidBridge.showToast("导入失败：请先登录教务系统！");
        console.log("检测到当前在登录页面，终止导入。");
        return;
    }

    // 公告弹窗
    const alertResult = await demoAlert();
    if (!alertResult) {
        return;
    }

    // 1. 获取学年和学期，如果用户取消则停止
    const params = await getYearAndSemester();
    if (!params) {
        console.log("用户取消了学年/学期选择，停止导入。");
        return;
    }
    const { xnm, xqm } = params;

    // 2. 获取课程数据，如果获取失败则停止
    const courses = await fetchCourses(xnm, xqm);
    if (!courses) {
        console.log("获取课程数据失败，停止导入。");
        return;
    }

    // 3. 保存课程数据，如果保存失败则停止
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("保存课程数据失败，停止导入。");
        return;
    }
    // 时间段
    await importPresetTimeSlots();

    console.log("JS: 所有导入步骤完成。");

    // 发送最终的生命周期完成信号
    AndroidBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportShzqCourses();
