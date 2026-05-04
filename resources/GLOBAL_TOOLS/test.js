// 基于 HTML 页面抓取的拾光课表正方适配脚本

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const WEEKDAY_TBODY_START = 1; // kblist_table 中，星期从第 1 个 tbody 开始
const WEEKDAY_TBODY_END = 7;   // 到第 7 个 tbody 结束（对应周一到周日）

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 解析节次字符串，例如 "1-4" → [1, 2, 3, 4]
 */
function parseSections(str) {
    if (!str) return [];
    const [start, end] = str.replace(/节/g, '').split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start > end) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * 解析周次字符串，支持逗号分隔、连续区间、单双周标记
 * 例如 "1-8周(单),10-16周" → [1, 3, 5, 7, 10, 11, 12, 13, 14, 15, 16]
 */
function parseWeeks(str) {
    if (!str) return [];

    const weeksSet = new Set(); // 用 Set 替代 includes 去重，语义更清晰

    for (const segment of str.split(',')) {
        const cleanSegment = segment.replace(/周/g, '').trim();

        // 使用 matchAll 替代带 g 标志的 exec 循环，避免 lastIndex 状态污染
        for (const match of cleanSegment.matchAll(/(\d+)(?:-(\d+))?\s*(\([单双]\))?/g)) {
            const start = parseInt(match[1]);
            const end   = match[2] ? parseInt(match[2]) : start;
            const flag  = match[3]?.includes('单') ? 'odd'
                        : match[3]?.includes('双') ? 'even'
                        : 'all';

            for (let i = start; i <= end; i++) {
                if (flag === 'odd'  && i % 2 === 0) continue; // 仅单周
                if (flag === 'even' && i % 2 !== 0) continue; // 仅双周
                weeksSet.add(i);
            }
        }
    }

    return [...weeksSet].sort((a, b) => a - b);
}

// ─── 解析器 ────────────────────────────────────────────────────────────────────

/**
 * 解析列表视图（type === 'list'）
 */
function parseList($) {
    const regexName     = /[●★○]/g;
    const regexWeekNum  = /周数：|周/g;
    const regexPosition = /上课地点：/g;
    const regexTeacher  = /教师 ：/g;

    const courseInfoList = [];

    $('#kblist_table tbody').each((tbodyIndex, tbody) => {
        if (tbodyIndex < WEEKDAY_TBODY_START || tbodyIndex > WEEKDAY_TBODY_END) return;

        const day = tbodyIndex; // tbody 索引即对应的星期数
        let currentSections = [];

        $(tbody).find('tr:not(:first-child)').each((_, tr) => {
            const $td = $(tr).find('td');
            let name, $font;

            if ($td.length > 1) {
                // 该行含节次列 + 课程列
                currentSections = parseSections($td.eq(0).text().trim());
                name  = $td.eq(1).find('.title').text().replace(regexName, '').trim();
                $font = $td.eq(1).find('p font');
            } else {
                // 该行只有课程列（节次沿用上一行）
                name  = $td.eq(0).find('.title').text().replace(regexName, '').trim();
                $font = $td.eq(0).find('p font');
            }

            if (!name || currentSections.length === 0) return;

            // 保护性检查：确保 font 元素数量足够，避免越界
            if ($font.length < 3) {
                console.warn(`JS: 课程 "${name}" 的 font 元素不足 3 个，跳过该条目。`);
                return;
            }

            const weekStr  = $font.eq(0).text().replace(regexWeekNum, '').trim();
            const weeks    = parseWeeks(weekStr);

            // 上课地点取最后一段，兼容"教学楼 A101"格式（取最后一个空格分隔 token）
            // 若格式变化可改为 positionRaw 直接使用整段文本
            const positionRaw  = $font.eq(1).text().replace(regexPosition, '').trim();
            const position     = positionRaw.split(/\s+/).pop();

            const teacher = $font.eq(2).text().replace(regexTeacher, '').trim();

            if (!weeks.length || !teacher || !position) return;

            courseInfoList.push({
                name,
                day,
                weeks,
                teacher,
                position,
                startSection: currentSections[0],
                endSection:   currentSections[currentSections.length - 1],
            });
        });
    });

    return courseInfoList;
}

/**
 * 解析表格视图（type === 'table'）
 *
 * 正方表格视图结构：
 *   - #kbgrid_table_0：外层表格，列对应星期（1-7），行对应节次块
 *   - 每个课程单元格内包含若干 .kbcontent1 div，每个 div 代表一门课
 *   - div 内容格式通常为：课程名(节次)周次<br>地点<br>教师
 */
function parseTable($) {
    const courseInfoList = [];

    // 列索引 0 为节次标题列，1-7 对应周一到周日
    $('#kbgrid_table_0 tr').each((rowIndex, tr) => {
        $(tr).find('td').each((colIndex, td) => {
            const day = colIndex; // 列索引即星期数（1=周一）
            if (day < WEEKDAY_TBODY_START || day > WEEKDAY_TBODY_END) return;

            $(td).find('.kbcontent1').each((_, div) => {
                const raw = $(div).text().trim();
                if (!raw) return;

                // 典型格式：课程名称(1-2节)1-16周 教学楼A101 张老师
                // 用括号内节次作为锚点分割
                const sectionMatch = raw.match(/\((\d+-\d+)节\)/);
                if (!sectionMatch) return;

                const sections    = parseSections(sectionMatch[1]);
                const afterParen  = raw.split('节)')[1] || '';

                // 周次：节)之后到第一个非数字非"-""单""双""周""," 之前
                const weekMatch   = afterParen.match(/^([\d,\-单双周()\s]+)/);
                const weeks       = weekMatch ? parseWeeks(weekMatch[1]) : [];

                // 剩余部分按空白分割取地点和教师
                const rest   = afterParen.replace(weekMatch?.[0] || '', '').trim().split(/\s+/);
                const position = rest[0] || '';
                const teacher  = rest[1] || '';

                // 课程名称：括号前的部分
                const name = raw.split('(')[0].trim();

                if (!name || !sections.length || !weeks.length || !position || !teacher) return;

                courseInfoList.push({
                    name,
                    day,
                    weeks,
                    teacher,
                    position,
                    startSection: sections[0],
                    endSection:   sections[sections.length - 1],
                });
            });
        });
    });

    return courseInfoList;
}

// ─── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 抓取并解析当前页面的课程数据
 */
async function scrapeAndParseCourses() {
    AndroidBridge.showToast("正在检查页面并抓取课程数据...");

    const guide = "1.登陆教务系统\n2.导航到学生课表查询页面\n3.等待课表信息加载，选择对应学年、学期，确认无误后点击【查询】\n4.确保页面上显示了课程表\n5.点击下方【一键导入】";

    try {
        // 直接检查 DOM，无需再 fetch 一次当前页面（避免重复请求）
        if (!document.body.innerText.includes("课表查询")) {
            console.warn("JS: 页面内容检查失败，可能不是课表页面。");
            await window.AndroidBridgePromise.showAlert(
                "导入失败",
                "当前页面似乎不是学生课表查询页面。请检查：\n" + guide,
                "确定"
            );
            return null;
        }

        const typeElement = document.querySelector('#shcPDF');
        if (!typeElement) {
            console.warn("JS: 未找到视图类型元素 (#shcPDF)。");
            await window.AndroidBridgePromise.showAlert(
                "导入失败",
                "未能识别课表视图类型，请确认您已点击查询且课表已加载完毕。",
                "确定"
            );
            return null;
        }

        const type         = typeElement.dataset['type'];
        const tableSelector = type === 'list' ? '#kblist_table' : '#kbgrid_table_0';
        const tableElement  = document.querySelector(tableSelector);

        if (!tableElement) {
            console.warn(`JS: 未找到课表主体 (${tableSelector})。`);
            await window.AndroidBridgePromise.showAlert(
                "导入失败",
                `未能找到课表主体 (${type} 视图)，请确认您已点击查询且课表已加载完毕。`,
                "确定"
            );
            return null;
        }

        const $ = window.jQuery;
        const result = type === 'list' ? parseList($) : parseTable($);

        if (result.length === 0) {
            AndroidBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${result.length} 门课程。`);
        return { courses: result };

    } catch (error) {
        console.error('JS: Scrape/Parse Error:', error);
        AndroidBridge.showToast(`抓取或解析失败: ${error.message}`);
        await window.AndroidBridgePromise.showAlert(
            "抓取或解析失败",
            `发生错误：${error.message}。请重试或联系开发者。`,
            "确定"
        );
        return null;
    }
}

/**
 * 将解析出的课程列表保存到 Android 端
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

    // jQuery 依赖检查提前，避免进入解析逻辑后才发现
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
