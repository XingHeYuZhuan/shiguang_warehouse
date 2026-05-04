// 基于 HTML 页面抓取的拾光课表正方适配脚本

// ─── 常量 ───────────────────────────────────────────────────────────────────────
const WEEKDAY_TBODY_START = 1;
const WEEKDAY_TBODY_END   = 7;

// ─── 工具函数 ───────────────────────────────────────────────────────────────────

/**
 * 解析节次字符串，例如 "1-4" → [1, 2, 3, 4]
 */
function parseSections(str) {
    const [start, end] = str.split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start > end) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * 解析周次字符串，支持逗号分隔、连续区间、单双周标记
 * 例如 "1-8(单),10-16" → [1, 3, 5, 7, 10, 11, 12, 13, 14, 15, 16]
 */
function parseWeeks(str) {
    if (!str) return [];

    const weeksSet = new Set();

    for (const segment of str.split(',')) {
        const cleanSegment = segment.replace(/周/g, '').trim();

        // 用 matchAll 替代带 g 标志的 exec 循环，避免 lastIndex 状态污染
        for (const match of cleanSegment.matchAll(/(\d+)(?:-(\d+))?\s*(\([单双]\))?/g)) {
            const start   = parseInt(match[1]);
            const end     = match[2] ? parseInt(match[2]) : start;
            const flagStr = match[3] || '';
            const flag    = flagStr.includes('单') ? 'odd'
                          : flagStr.includes('双') ? 'even'
                          : 'all';

            for (let i = start; i <= end; i++) {
                if (flag === 'odd'  && i % 2 === 0) continue;
                if (flag === 'even' && i % 2 !== 0) continue;
                weeksSet.add(i);
            }
        }
    }

    return [...weeksSet].sort((a, b) => a - b);
}

// ─── 解析器 ─────────────────────────────────────────────────────────────────────

/**
 * 解析列表视图（type === 'list'）
 * 核心逻辑与原版保持一致，仅做无破坏性的小调整
 */
function parseList() {
    const regexName     = /[●★○]/g;
    const regexWeekNum  = /周数：|周/g;
    const regexPosition = /上课地点：/g;
    const regexTeacher  = /教师 ：/g;

    const $ = window.jQuery;
    if (!$) return [];

    const courseInfoList = [];

    $('#kblist_table tbody').each((tbodyIndex, tbody) => {
        if (tbodyIndex < WEEKDAY_TBODY_START || tbodyIndex > WEEKDAY_TBODY_END) return;

        const day = tbodyIndex;
        let sections; // 与原版一致：跨行持久化当前节次

        $(tbody).find('tr:not(:first-child)').each((_, tr) => {
            let name, font;

            if ($(tr).find('td').length > 1) {
                // 该行含节次列 + 课程列
                sections = parseSections($(tr).find('td:first-child').text());
                name     = $(tr).find('td:nth-child(2)').find('.title').text().replace(regexName, '').trim();
                font     = $(tr).find('td:nth-child(2)').find('p font');
            } else {
                // 该行只有课程列，节次沿用上一行
                name = $(tr).find('td').find('.title').text().replace(regexName, '').trim();
                font = $(tr).find('td').find('p font');
            }

            // font 元素不足时打印警告但不强行跳过，交由后续字段校验过滤
            if (font.length < 3) {
                console.warn(`JS: 课程 "${name}" 的 font 元素仅 ${font.length} 个，可能解析不完整。`);
            }

            const weekStr     = $(font[0]).text().replace(regexWeekNum, '').trim();
            const weeks       = parseWeeks(weekStr);

            // 上课地点取最后一段空白分隔的 token
            const positionRaw = $(font[1]).text().replace(regexPosition, '').trim();
            const position    = positionRaw.split(/\s+/).pop();

            const teacher = $(font[2]).text().replace(regexTeacher, '').trim();

            if (name && sections && weeks.length && teacher && position) {
                courseInfoList.push({
                    name,
                    day,
                    weeks,
                    teacher,
                    position,
                    startSection: sections[0],
                    endSection:   sections[sections.length - 1],
                });
            }
        });
    });

    return courseInfoList;
}

/**
 * 解析表格视图（type === 'table'）
 * TODO: 暂未实现，需要提供表格视图的 HTML 结构后补全
 */
function parseTable() {
    console.warn("JS: 表格视图解析尚未实现，请使用列表视图或提供 HTML 结构。");
    return [];
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────────

/**
 * 抓取并解析当前页面的课程数据
 */
async function scrapeAndParseCourses() {
    AndroidBridge.showToast("正在检查页面并抓取课程数据...");

    const guide = "1.登陆教务系统\n2.导航到学生课表查询页面\n3.等待课表信息加载，选择对应学年、学期，确认无误后点击【查询】\n4.确保页面上显示了课程表\n5.点击下方【一键导入】";

    try {
        // 直接检查 DOM，不再重复 fetch 当前页面
        if (!document.body.innerText.includes("课表查询")) {
            console.warn("JS: 页面内容检查失败，可能不是课表页面。");
            await window.AndroidBridgePromise.showAlert("导入失败", "当前页面似乎不是学生课表查询页面。请检查：\n" + guide, "确定");
            return null;
        }

        const typeElement = document.querySelector('#shcPDF');
        if (!typeElement) {
            console.warn("JS: 未找到视图类型元素 (#shcPDF)。");
            await window.AndroidBridgePromise.showAlert("导入失败", "未能识别课表视图类型，请确认您已点击查询且课表已加载完毕。", "确定");
            return null;
        }

        const type          = typeElement.dataset['type'];
        const tableSelector = type === 'list' ? '#kblist_table' : '#kbgrid_table_0';
        const tableElement  = document.querySelector(tableSelector);

        if (!tableElement) {
            console.warn(`JS: 未找到课表主体 (${tableSelector})。`);
            await window.AndroidBridgePromise.showAlert("导入失败", `未能找到课表主体 (${type} 视图)，请确认您已点击查询且课表已加载完毕。`, "确定");
            return null;
        }

        const result = type === 'list' ? parseList() : parseTable();

        if (result.length === 0) {
            AndroidBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${result.length} 门课程。`);
        return { courses: result };

    } catch (error) {
        console.error('JS: Scrape/Parse Error:', error);
        AndroidBridge.showToast(`抓取或解析失败: ${error.message}`);
        await window.AndroidBridgePromise.showAlert("抓取或解析失败", `发生错误：${error.message}。请重试或联系开发者。`, "确定");
        return null;
    }
}

/**
 * 保存课程到 Android 端
 */
async function saveCourses(courses) {
    AndroidBridge.showToast(`正在保存 ${courses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${courses.length} 门课程...`);
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        console.error('JS: Save Courses Error:', error);
        AndroidBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

/**
 * 完整导入流程入口
 */
async function runImportFlow() {
    const confirmed = await window.AndroidBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统，并处于课表查询页面且已点击查询。",
        "好的，开始导入"
    );
    if (!confirmed) {
        AndroidBridge.showToast("用户取消了导入。");
        return;
    }

    if (typeof window.jQuery === 'undefined') {
        const msg = "当前教务系统页面未加载 jQuery 库，本脚本依赖 jQuery 进行 DOM 解析。";
        console.error("JS: 缺少 jQuery 依赖，流程终止。");
        AndroidBridge.showToast(msg);
        await window.AndroidBridgePromise.showAlert("导入失败", msg + "\n请尝试刷新页面或使用其他导入方式。", "确定");
        return;
    }

    const result = await scrapeAndParseCourses();
    if (!result) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }

    const saved = await saveCourses(result.courses);
    if (!saved) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    AndroidBridge.showToast(`课程导入成功，共导入 ${result.courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    AndroidBridge.notifyTaskCompletion();
}

runImportFlow();
