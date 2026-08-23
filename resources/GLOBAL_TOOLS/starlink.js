/**
 * 星链课表分享导入脚本
 */

// 输入验证
function validateInput(input) {
    if (!input || input.trim().length === 0) return "请输入分享码！";
    return false;
}

// 提取分享码
function extractShareCode(text) {
    const structuredRegex = /输入：\s*([^（\s]+)/;
    const fallbackRegex = /([a-zA-Z0-9-]{5,20})/;

    const matchA = text.match(structuredRegex);
    if (matchA && matchA[1]) return matchA[1].trim();

    const matchB = text.match(fallbackRegex);
    if (matchB) return matchB[1].trim();

    return text.trim();
}

// 课程去重与合并
function processAndMergeCourses(courses) {
    if (!courses || courses.length === 0) return [];

    // 排序：星期 > 课程名 > 教师 > 教室 > 周次 > 起始节次
    courses.sort((a, b) => 
        a.day - b.day || 
        (a.name || "").localeCompare(b.name || "") || 
        (a.teacher || "").localeCompare(b.teacher || "") || 
        (a.position || "").localeCompare(b.position || "") || 
        JSON.stringify(a.weeks).localeCompare(JSON.stringify(b.weeks)) ||
        a.startSection - b.startSection
    );

    const mergedResults = [];
    courses.forEach(current => {
        if (mergedResults.length === 0) {
            mergedResults.push(current);
            return;
        }

        const last = mergedResults[mergedResults.length - 1];

        // 完全重复过滤
        const isDuplicate = 
            last.day === current.day &&
            last.name === current.name &&
            last.teacher === current.teacher &&
            last.position === current.position &&
            last.startSection === current.startSection &&
            last.endSection === current.endSection &&
            JSON.stringify(last.weeks) === JSON.stringify(current.weeks);

        if (isDuplicate) return;

        // 连堂课合并
        const canMerge = 
            last.day === current.day &&
            last.name === current.name &&
            last.teacher === current.teacher &&
            last.position === current.position &&
            JSON.stringify(last.weeks) === JSON.stringify(current.weeks) &&
            current.startSection <= last.endSection + 1; 

        if (canMerge) {
            last.endSection = Math.max(last.endSection, current.endSection);
        } else {
            mergedResults.push(current);
        }
    });

    return mergedResults;
}

// 主程序
async function runStarlinkImport() {
    try {
        const userInput = await window.shiguangBridgePromise.showPrompt(
            "导入星链课表",
            "请粘贴分享文案（包含分享码）",
            "",
            "validateInput"
        );

        if (!userInput) return;

        const shareCode = extractShareCode(userInput);
        const apiUrl = `https://api.starlinkkb.cn/share/curriculum/${shareCode}`;
        
        window.shiguangBridge.showToast("正在同步云端数据...");

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("分享码已失效或网络异常");

        const resJson = await response.json();
        const data = resJson.data;

        // 数据映射
        const rawCourses = data.courses.map(c => ({
            name: c.name,
            teacher: (c.teacher && c.teacher !== "无") ? c.teacher : "未知",
            position: (c.location && c.location.replace(/^@/, '').trim() !== "") 
                        ? c.location.replace(/^@/, '').trim() 
                        : "未排地点",
            day: c.weekday,
            startSection: c.startSection,
            endSection: c.endSection,
            weeks: c.weeks
        }));

        const finalCourses = processAndMergeCourses(rawCourses);

        const config = {
            semesterStartDate: data.startDate ? data.startDate.substring(0, 10) : null,
            semesterTotalWeeks: data.totalWeeks || 20
        };

        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        const success = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

        if (success) {
            window.shiguangBridge.showToast("导入成功！");
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        await window.shiguangBridgePromise.showAlert("导入失败", e.message, "确定");
    }
}

runStarlinkImport();