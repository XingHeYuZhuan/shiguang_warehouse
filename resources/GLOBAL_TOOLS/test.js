/**
 * 枣庄学院 (uzz.edu.cn) 拾光课程表专用适配脚本
 * 基于正方教务系统 API 接口 (JSON 数据解析)
 */

const UZZ_BASE_URL = window.location.origin; // 自动获取当前教务系统域名

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const segments = weekStr.split(',');
    let weeks = [];
    // 匹配 1-18周(单), 2-18周(双), 1-18周 等
    const segmentRegex = /(\d+)(?:-(\d+))?\s*周?(\([单双]\))?/g;
    for (const segment of segments) {
        segmentRegex.lastIndex = 0;
        let match;
        while ((match = segmentRegex.exec(segment)) !== null) {
            const start = parseInt(match[1]);
            const end = match[2] ? parseInt(match[2]) : start;
            const flagStr = match[3] || '';
            let flag = 0;
            if (flagStr.includes('单')) flag = 1;
            else if (flagStr.includes('双')) flag = 2;

            for (let i = start; i <= end; i++) {
                if (flag === 1 && i % 2 !== 1) continue;
                if (flag === 2 && i % 2 !== 0) continue;
                if (!weeks.includes(i)) weeks.push(i);
            }
        }
    }
    return weeks.sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const finalCourseList = [];
    for (const item of jsonData.kbList) {
        // kcmc:课名, xm:教师, cdmc:教室, xqj:星期几, jcs:节次(如"1-2"), zcd:周次描述
        const weeks = parseWeeks(item.zcd);
        const sectionParts = item.jcs.split('-');
        const startSection = parseInt(sectionParts[0]);
        const endSection = parseInt(sectionParts[sectionParts.length - 1]);
        const day = parseInt(item.xqj);

        if (weeks.length > 0 && !isNaN(day)) {
            finalCourseList.push({
                name: item.kcmc.trim(),
                teacher: item.xm ? item.xm.trim() : "未知",
                position: item.cdmc ? item.cdmc.trim() : "未知",
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }
    }
    return finalCourseList;
}

// 枣庄学院作息时间表：1节课1h40m，课间30m
const TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "09:40" },
    { number: 2, startTime: "10:10", endTime: "11:50" },
    { number: 3, startTime: "14:30", endTime: "16:10" },
    { number: 4, startTime: "16:40", endTime: "18:20" },
    { number: 5, startTime: "19:30", endTime: "21:10" } // 假设晚间档
];

async function runImportFlow() {
    const alertConfirmed = await window.AndroidBridgePromise.showAlert(
        "枣庄学院课表导入",
        "请确保您已登录教务系统，并在导入过程中保持网络畅通。",
        "开始导入"
    );
    if (!alertConfirmed) return;

    // 1. 获取学年 (例如 2025)
    const currentYear = new Date().getFullYear().toString();
    const academicYear = await window.AndroidBridgePromise.showPrompt(
        "选择学年",
        "请输入起始学年 (如 2025-2026 填 2025):",
        currentYear,
        "" 
    );
    if (!academicYear) return;

    // 2. 选择学期
    const semesterIdx = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期"]),
        0
    );
    if (semesterIdx === null || semesterIdx === -1) return;
    const xqm = semesterIdx === 0 ? "3" : "12"; // 正方规范: 3是秋季，12是春季

    AndroidBridge.showToast("正在通过 API 获取原始数据...");
    
    try {
        const apiUrl = `${UZZ_BASE_URL}/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;
        const body = `xnm=${academicYear}&xqm=${xqm}&kzlx=ck&xsdm=&kclbdm=`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: body
        });

        const json = await response.json();
        const courses = parseJsonData(json);

        if (courses.length === 0) {
            AndroidBridge.showToast("未找到课程，请确认学年学期是否有误。");
            return;
        }

        // 3. 保存课程数据
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        // 4. 保存作息时间
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));

        AndroidBridge.showToast(`成功导入 ${courses.length} 门课程并同步作息时间！`);
        AndroidBridge.notifyTaskCompletion();
    } catch (e) {
        AndroidBridge.showToast("接口请求失败，请检查登录状态");
        console.error(e);
    }
}

runImportFlow();
