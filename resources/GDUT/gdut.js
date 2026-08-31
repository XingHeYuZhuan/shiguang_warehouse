// 文件: gdut.js

if (typeof Strings === 'undefined') {
    var Strings = {
        BASE_URL: "https://jxfw.gdut.edu.cn",
        GET_WEEK_COURSES_URL: "https://jxfw.gdut.edu.cn/xsgrkbcx!getKbRq.action",
        GET_ALL_COURSES_URL: "https://jxfw.gdut.edu.cn/xsgrkbcx!getDataList.action",
        GET_ALL_COURSES_HTML_URL: "https://jxfw.gdut.edu.cn/xsgrkbcx!xsAllKbList.action",
        GET_ALL_COURSES_HTML_URL_REFERRER: "https://jxfw.gdut.edu.cn/xsgrkbcx!getXsgrbkList.action"
    };
}

async function stepDescriptionAlert() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "提示",
            "即将执行导入课程操作。请确保你已处于登录状态，无需打开课程表页面。",
            "确认"
        );
        
        return confirmed;
    } catch (error) {
        console.error("显示弹窗时发生错误:", error);
        return false;
    }
}

async function selectSemesterSelection(){
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentSemester = currentMonth >= 9 || currentMonth <= 2 ? 1 : 1;
    const nextSemester = currentSemester === 1 ? 2 : 1;

    const presetSemeters = [];
    const presetSemestersName = [];

    for (let year = currentYear; year >= currentYear - 3; year--){
        for (let semester = nextSemester; semester >= 1; semester--){
            const semesterName = `${year}-${year + 1}学年 ${semester === 1 ? "秋季" : "春季"}（第${semester}学期）`;
            presetSemeters.push({ name: semesterName, semesterId: `${year}0${semester}` });
            presetSemestersName.push(semesterName);
        }
    }

    try {
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择要导入的学期",
            JSON.stringify(presetSemestersName),
            2
        );
        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < presetSemeters.length) {
            const selecedSemester = presetSemeters[selectedIndex];
            console.log("用户选择了: " + selecedSemester.name + " (索引: " + selectedIndex + ")");
            return selecedSemester;
        } else {
            console.log("用户取消了选择。");
            return null;
        }
    } catch (error) {
        console.error("显示单选列表弹窗时发生错误:", error);
        window.shiguangBridge.showToast("Single Selection：显示列表出错！" + error.message);
        return null;
    }
}

function extractFirstDay(dateInfoJsonData) {
    try {
        const jsonArray = JSON.parse(dateInfoJsonData);

        const dateInfoArray = jsonArray[1];
        if (!Array.isArray(dateInfoArray)) {
            console.error('JSON 数据格式异常：索引 [1] 不是数组');
            return null;
        }

        // 遍历查找 xqmc === "1"（周一）的项
        for (const dateInfo of dateInfoArray) {
            if (dateInfo.xqmc === "1" && dateInfo.rq) {
                return dateInfo.rq;
            }
        }

        console.warn('未找到 xqmc=1 的日期项');
        return null;
    } catch (error) {
        console.error('解析 JSON 失败:', error);
        return null;
    }
}

async function fetchStartDate(semesterId) {
    const url = `${"https://jxfw.gdut.edu.cn"}/xsgrkbcx!getKbRq.action?xnxqdm=${semesterId}&zc=1`;
    
    try {

        console.log(`正在获取学期开始日期。学期代码：${semesterId}}`);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Referer': url
            },
            credentials: 'include'
        });

        const data = await response.text();
        
        const startDateString = extractFirstDay(data);

        // 如果提取失败，返回当前日期
        if (startDateString === null) {
            // 使用当前日期
            return new Date();
        }

        // 解析日期字符串为 Date 对象
        const date = new Date(startDateString);
        if (isNaN(date.getTime())) {
            console.warn(`日期解析失败: ${startDateString}，使用当前日期`);
            return new Date();
        }

        console.log(`成功获取学期开始日期: ${date.toISOString().split('T')[0]}`);

        return date;
    } catch (error) {
        console.error('获取学期开始日期失败，使用当前日期。错误信息:', error);
        return new Date();
    }
}

async function fetchCourses(semesterId){
    try {
        console.log(`正在获取学期 ${semesterId} 的课程数据...`);

        const rawCourses = [];

        const pageSize = 100;
        let pageIndex = 1;

        while (true) {
            const formData = new URLSearchParams();
            formData.append('xnxqdm', semesterId);
            formData.append('zc', '');
            formData.append('page', String(pageIndex));
            formData.append('rows', String(pageSize));
            formData.append('sort', 'kxh');
            formData.append('order', 'asc');

            const response = await fetch(Strings.GET_ALL_COURSES_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': Strings.BASE_URL
                },
                body: formData.toString(),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`请求失败: ${response.status}`);
            }

            const rawData = await response.json();

            if (rawData.total === 0 || rawData.rows.length === 0) {
                console.log(`学期 ${semesterId} 没有找到课程数据。`);
                if (await checkSemesterIsOpened(semesterId)) {
                    throw new Error('该学期没有找到课程，请确认选择了正确的学期');
                }
                throw new Error('学期未开放课表查询！');
            }

            for (const row of rawData.rows) {
                rawCourses.push(row);
            }

            if (rawCourses.length >= rawData.total) {
                break;
            }

            pageIndex++;

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const courses = parseCourses(rawCourses);

        return courses;

    } catch (error) {
        console.error('添加课程表失败:', error);
        return null;
    }
}

async function checkSemesterIsOpened(semesterId) {
    console.log(`正在检查学期 ${semesterId} 是否已开放课表查询...`);

    const url = `${Strings.GET_ALL_COURSES_HTML_URL}?xnxqdm=${semesterId}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Referer': Strings.GET_ALL_COURSES_HTML_URL_REFERRER
        },
        credentials: 'include'
    });
    
    const html = await response.text();

    // 如果不包含"未开放"文字，说明已开放
    return !html.includes("本学期课表还未开放，请稍后查询！");
}

function parseCourses(rawCourses){
    console.log(`正在解析课程数据，共 ${rawCourses.length} 条原始记录...`);

    const courses = [];
    for (const raw of rawCourses) {
        const sectionMatch = raw.jcdm.match(/\d{2}/g);
        if (!sectionMatch) continue;
        
        const sections = sectionMatch.map(Number);
        const startSection = sections[0];
        const endSection = sections[sections.length - 1];
        
        // 周次
        const week = Number(raw.zc);
        if (isNaN(week)) continue;

        courses.push({
            name: raw.kcmc.trim(),
            teacher: (raw.teaxms || "").trim(),
            position: (raw.jxcdmc || "").trim(),
            day: Number(raw.xq),
            startSection: startSection,
            endSection: endSection,
            weeks: [week],
            isCustomTime: false
        });
    }

    return courses;
}

async function saveCourses(courses){
    try {
        console.log("正在尝试导入课程...");
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            console.log("课程导入成功！");
        } else {
            console.log("课程导入未成功，结果：" + result);
            window.shiguangBridge.showToast("课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        window.shiguangBridge.showToast("导入课程失败: " + error.message);
    }
}

async function setPresetTimeSlots() {
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "09:15" },
        { "number": 2, "startTime": "09:20", "endTime": "10:05" },
        { "number": 3, "startTime": "10:25", "endTime": "11:10" },
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "13:50", "endTime": "14:35" },
        { "number": 6, "startTime": "14:40", "endTime": "15:25" },
        { "number": 7, "startTime": "15:30", "endTime": "16:15" },
        { "number": 8, "startTime": "16:30", "endTime": "17:15" },
        { "number": 9, "startTime": "17:20", "endTime": "18:05" },
        { "number": 10, "startTime": "18:30", "endTime": "19:15" },
        { "number": 11, "startTime": "19:20", "endTime": "20:05" },
        { "number": 12, "startTime": "20:10", "endTime": "20:55" },
        { "number": 13, "startTime": "21:00", "endTime": "21:45" },
        { "number": 14, "startTime": "21:50", "endTime": "22:35" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试时间段导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

async function saveConfig(config) {
    try {
        console.log("正在尝试导入课表配置...");
        const configJsonString = JSON.stringify(config);

        const result = await window.shiguangBridgePromise.saveCourseConfig(configJsonString);

        if (result === true) {
            console.log("课表配置导入成功！");
        } else {
            console.log("课表配置导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试配置导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入配置时发生错误:", error);
        window.shiguangBridge.showToast("导入配置失败: " + error.message);
    }
}

/**
 * 编排这些异步操作，并在用户取消时停止后续执行。
 */
async function runImportFlow() {
    var result = await stepDescriptionAlert();

    if (!result) {
        console.log("用户取消了操作，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    const semester = await selectSemesterSelection();

    if (!semester) {
        console.log("用户取消了学期选择，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    const startDate = await fetchStartDate(semester.semesterId);

    const config = {
        semesterStartDate: startDate.toISOString().split('T')[0], // 转换为 YYYY-MM-DD 格式
        semesterTotalWeeks: 20,
        defaultClassDuration: 45,
        defaultBreakDuration: 5,
        firstDayOfWeek: 1
    }

    await saveConfig(config);

    const courses = await fetchCourses(semester.semesterId);

    if (!courses) {
        console.log(`未能获取课程数据，停止后续执行。`);
        return; // 获取课程失败，立即退出函数
    }

    await saveCourses(courses);
    await setPresetTimeSlots();

    window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);

    // 发送最终的生命周期完成信号
    window.shiguangBridge.notifyTaskCompletion();
}

// 入口函数，开始执行导入流程
runImportFlow();