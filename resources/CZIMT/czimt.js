// 常州机电职业技术学院(czimt.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配

function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();
        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/);

        let start = 0, end = 0, processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed) {
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    console.log("JS: 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            console.warn("JS: 课程数据字段缺失，跳过:", rawCourse.kcmc || "未知课程");
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            console.warn("JS: 周次解析失败，跳过:", rawCourse.kcmc);
            continue;
        }

        const sectionParts = String(rawCourse.jcs).split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
            console.warn("JS: 课程", rawCourse.kcmc, "星期或节次数据无效，跳过。");
            continue;
        }

        const campus = rawCourse.xqmc ? String(rawCourse.xqmc).trim() : "";
        const classroom = String(rawCourse.cdmc).trim();
        const position = campus ? `${classroom}(${campus})` : classroom;

        const xslxbj = rawCourse.xslxbj ? String(rawCourse.xslxbj).trim() : "";
        const name = xslxbj ? `${String(rawCourse.kcmc).trim()}${xslxbj}` : String(rawCourse.kcmc).trim();

        finalCourseList.push({
            name: name,
            teacher: String(rawCourse.xm).trim(),
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray,
            isCustomTime: false
        });
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return "请输入四位数字的学年！";
}

async function promptUserToStart() {
    return await window.AndroidBridgePromise.showAlert(
        "常机电学生课表导入",
        "导入前请确保您已成功登录教务系统。",
        "开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2026-2027 应输入 2026）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期", "第三学期(短学期)"];
    const semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

function getSemesterCode(semesterIndex) {
    const codes = ["3", "12", "16"];
    return codes[semesterIndex] || "3";
}

async function fetchAndParseCourses(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;

    const targetUrls = [
        "https://webapp.czimt.edu.cn/http/77726476706e69737468656265737421fae042d2242a65557d468aa2/kbcx/xskbcx_cxXsgrkb.html?vpn-12-o1-jwc.czmec.cn&gnmkdm=N2151",
        "http://jwc.czmec.cn/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151"
    ];

    for (const url of targetUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" 
                },
                body: requestBody,
                credentials: "include"
            });

            if (response.ok) {
                const jsonText = await response.text();
                const jsonData = JSON.parse(jsonText);
                if (jsonData && jsonData.kbList) {
                    const parsedCourses = parseJsonData(jsonData);
                    if (parsedCourses.length > 0) {
                        return {
                            courses: parsedCourses,
                            config: {
                                semesterStartDate: null,
                                semesterTotalWeeks: 20
                            }
                        };
                    }
                }
            }
        } catch (e) {
            console.error(`Entry failed: ${url}`);
        }
    }
    AndroidBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
    return null;
}

async function saveCourses(parsedCourses) {
    AndroidBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        AndroidBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);A
        return false;
    }
}

const TimeSlots = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:05", endTime: "09:45" },
    { number: 3, startTime: "10:00", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:25" },
    { number: 5, startTime: "13:45", endTime: "14:25" },
    { number: 6, startTime: "14:30", endTime: "15:10" },
    { number: 7, startTime: "15:25", endTime: "16:05" },
    { number: 8, startTime: "16:10", endTime: "16:50" },
    { number: 9, startTime: "18:00", endTime: "18:40" },
    { number: 10, startTime: "18:45", endTime: "19:25" },
    { number: 11, startTime: "19:35", endTime: "20:15" },
    { number: 12, startTime: "20:20", endTime: "21:00" }
];

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);

    if (timeSlots.length > 0) {
        AndroidBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            AndroidBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            AndroidBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        AndroidBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        AndroidBridge.showToast("导入已取消。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        AndroidBridge.showToast("导入已取消。");
        return;
    }
    console.log(`JS: 已选择学期索引: ${semesterIndex}`);

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses, config } = result;

    const timeSlotResult = await importPresetTimeSlots(TimeSlots);
    if (!timeSlotResult) {
        console.log("JS: 预设时间段导入失败或跳过，继续导入课程...");
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    try {
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        AndroidBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        AndroidBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    AndroidBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    AndroidBridge.notifyTaskCompletion();
}

runImportFlow();
