/**
 * 拾光课程表适配脚本
 * 平台: 正方教务系统
 * 学校: 江苏大学 (ujs.edu.cn)
 * 说明:
 * 1. 支持表格视图与列表视图自动识别
 * 2. 仅解析“已查询后”的当前页面 DOM
 * 3. 输出符合 CourseJsonModel 的课程数组
 */

const NAME_MARKERS_REGEX = /[●★○]/g;
const WEEK_SEGMENT_REGEX = /^(\d+)(?:-(\d+))?(?:\((单|双)\)|([单双]))?$/;
const DEBUG_ENABLED = false;
// 地点前缀默认策略: true=裁剪校区前缀, false=保留校区前缀。
const DEFAULT_TRIM_CAMPUS_PREFIX = true;
let trimCampusPrefix = DEFAULT_TRIM_CAMPUS_PREFIX;

function debugLog(...args) {
    if (DEBUG_ENABLED) {
        console.log("[UJS-DEBUG]", ...args);
    }
}

function normalizeText(str) {
    return (str || "").replace(/\s+/g, " ").trim();
}

function normalizeName(name) {
    return normalizeText(name).replace(NAME_MARKERS_REGEX, "").trim();
}

function normalizePosition(position) {
    let result = normalizeText(position)
        .replace(/^上课地点[:：]?/, "")
        .replace(/^地点[:：]?/, "");

    if (trimCampusPrefix) {
        result = result.replace(/^(本部|北固|桃花坞|中山|梦溪)\s*/, "");
    }

    return result;
}

function parseSections(raw) {
    const text = normalizeText(raw).replace(/[节次]/g, "");
    const match = text.match(/(\d+)(?:-(\d+))?/);
    if (!match) return [];
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2] || match[1], 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function parseWeeks(raw) {
    const text = normalizeText(raw)
        .replace(/周数[:：]?/g, "")
        .replace(/第/g, "")
        .replace(/[\s、；;]/g, "")
        .replace(/，/g, ",")
        .replace(/[~～—–－]/g, "-")
        .replace(/至/g, "-");

    const cleaned = text
        .replace(/周/g, "")
        .replace(/单周/g, "单")
        .replace(/双周/g, "双");
    const weeksSet = new Set();

    // 使用全局扫描提取所有周次片段，避免依赖 split/filter 等可能被页面污染的方法。
    const tokenRegex = /(\d+)(?:-(\d+))?(?:[\(（]?(单|双)[\)）]?)?/g;
    const matches = Array.from(String(cleaned).matchAll(tokenRegex));

    for (const m of matches) {
        const start = parseInt(m[1], 10);
        const end = parseInt(m[2] || m[1], 10);
        const marker = m[3] || "";
        if (Number.isNaN(start) || Number.isNaN(end) || start > end) continue;

        for (let w = start; w <= end; w += 1) {
            if (marker === "单" && w % 2 === 0) continue;
            if (marker === "双" && w % 2 !== 0) continue;
            weeksSet.add(w);
        }
    }

    if (weeksSet.size === 0 && raw) {
        debugLog("parseWeeks empty result", {
            raw,
            text,
            cleaned,
            matches: matches.map((m) => m[0]),
            codePoints: Array.from(String(raw)).map((ch) => `${ch}:${ch.charCodeAt(0)}`),
            typeofSplit: typeof "".split,
            splitProbe: String(cleaned).split(",")
        });
    }

    return Array.from(weeksSet).sort((a, b) => a - b);
}

function extractLineByLabel($, $course, labelKeywords) {
    let result = "";
    $course.find("p").each((_, p) => {
        const $tip = $(p).find("span[data-toggle='tooltip']").first();
        const title = normalizeText(
            $tip.attr("title") || $tip.attr("data-original-title") || ""
        );

        if (labelKeywords.some((kw) => title.includes(kw))) {
            result = normalizeText($(p).text());
            return false;
        }
        return true;
    });
    return result;
}

function extractLineByIcon($, $course, iconClass) {
    let result = "";
    $course.find("p").each((_, p) => {
        if ($(p).find(`.${iconClass}`).length > 0) {
            result = normalizeText($(p).text());
            return false;
        }
        return true;
    });
    return result;
}

function parseTableView($) {
    const courses = [];
    let timetableConCount = 0;
    const skipStats = {
        invalidDay: 0,
        emptyName: 0,
        emptyPosition: 0,
        emptyTeacher: 0,
        emptySections: 0,
        emptyWeeks: 0
    };

    const tableCells = $("td.td_wrap");
    debugLog("table view td_wrap count:", tableCells.length);

    tableCells.each((cellIndex, td) => {
        const id = normalizeText($(td).attr("id") || "");
        const day = parseInt(id.split("-")[0], 10);
        if (Number.isNaN(day) || day < 1 || day > 7) {
            skipStats.invalidDay += 1;
            return;
        }

        $(td).find(".timetable_con").each((__, courseNode) => {
            timetableConCount += 1;
            const $course = $(courseNode);
            const name = normalizeName($course.find(".title, .title1").first().text());

            const rawBlockText = normalizeText($course.text());
            let timeLine = extractLineByIcon($, $course, "glyphicon-time") ||
                extractLineByLabel($, $course, ["节/周", "节次", "时间"]);
            let positionLine = extractLineByIcon($, $course, "glyphicon-map-marker") ||
                extractLineByLabel($, $course, ["上课地点"]);
            let teacherLine = extractLineByIcon($, $course, "glyphicon-user") ||
                extractLineByLabel($, $course, ["教师"]);

            if (!timeLine) {
                const m = rawBlockText.match(/\((\d+(?:-\d+)?节)\)\s*([\d,，\-周单双()]+)/);
                if (m) {
                    timeLine = `(${m[1]})${m[2]}`;
                }
            }
            if (!positionLine) {
                const m = rawBlockText.match(/上课地点[:：]?\s*([^教\s].*?)(?:教师|教学班|学分|课程性质|$)/);
                if (m) {
                    positionLine = normalizeText(m[1]);
                }
            }
            if (!teacherLine) {
                const m = rawBlockText.match(/教师\s*[:：]?\s*(.*?)(?:教学班|学分|课程性质|$)/);
                if (m) {
                    teacherLine = normalizeText(m[1]);
                }
            }

            const sections = parseSections(timeLine);
            const weeksText = timeLine.includes("节)") ? timeLine.split("节)").pop() : timeLine;
            const weeks = parseWeeks(weeksText);

            const position = normalizePosition(positionLine);
            const teacher = normalizeText(teacherLine)
                .replace(/^教师\s*[:：]?/, "")
                .replace(/\s+/g, "");

            if (DEBUG_ENABLED && timetableConCount <= 8) {
                debugLog("sample course block", {
                    cellIndex,
                    cellId: id,
                    day,
                    name,
                    timeLine,
                    positionLine,
                    teacherLine,
                    sections,
                    weeks,
                    position,
                    teacher
                });
            }

            if (!name) {
                skipStats.emptyName += 1;
                return;
            }
            if (!position) {
                skipStats.emptyPosition += 1;
                return;
            }
            if (!teacher) {
                skipStats.emptyTeacher += 1;
                return;
            }
            if (sections.length === 0) {
                skipStats.emptySections += 1;
                return;
            }
            if (weeks.length === 0) {
                skipStats.emptyWeeks += 1;
                return;
            }

            courses.push({
                name,
                teacher,
                position,
                day,
                startSection: sections[0],
                endSection: sections[sections.length - 1],
                weeks
            });
        });
    });

    debugLog("table view summary", {
        timetableConCount,
        parsedCount: courses.length,
        skipStats
    });

    return courses;
}

function parseListView($) {
    const courses = [];
    let rowCount = 0;
    const skipStats = {
        invalidDay: 0,
        emptyName: 0,
        emptyPosition: 0,
        emptyTeacher: 0,
        emptySections: 0,
        emptyWeeks: 0
    };

    const tbodys = $("#kblist_table tbody");
    debugLog("list view tbody count:", tbodys.length);

    tbodys.each((index, tbody) => {
        let day = NaN;
        const dayId = normalizeText($(tbody).attr("id") || "");
        const dayMatch = dayId.match(/xq_(\d)/);
        if (dayMatch) {
            day = parseInt(dayMatch[1], 10);
        } else if (index > 0 && index < 8) {
            day = index;
        }
        if (Number.isNaN(day) || day < 1 || day > 7) {
            skipStats.invalidDay += 1;
            return;
        }

        let currentSections = [];
        $(tbody)
            .find("tr:not(:first-child)")
            .each((_, tr) => {
                rowCount += 1;
                const $tr = $(tr);
                const tds = $tr.find("td");
                if (tds.length === 0) return;

                let $contentCell = $tr.find("td:first-child");
                if (tds.length > 1) {
                    const sectionText = normalizeText($tr.find("td:first-child").text());
                    const parsed = parseSections(sectionText);
                    if (parsed.length > 0) {
                        currentSections = parsed;
                    }
                    $contentCell = $tr.find("td:nth-child(2)");
                }

                const name = normalizeName($contentCell.find(".title").first().text());
                const fonts = $contentCell.find("p font");

                let weekLine = extractLineByLabel($, $contentCell, ["周数", "节/周"]);
                let positionLine = extractLineByLabel($, $contentCell, ["上课地点"]);
                let teacherLine = extractLineByLabel($, $contentCell, ["教师"]);

                if (!weekLine && fonts.length > 0) weekLine = normalizeText($(fonts[0]).text());
                if (!positionLine && fonts.length > 1) positionLine = normalizeText($(fonts[1]).text());
                if (!teacherLine && fonts.length > 2) teacherLine = normalizeText($(fonts[2]).text());

                const weeks = parseWeeks(weekLine);
                const position = normalizePosition(positionLine);
                const teacher = normalizeText(teacherLine).replace(/^教师\s*[:：]?/, "");

                if (!name) {
                    skipStats.emptyName += 1;
                    return;
                }
                if (!position) {
                    skipStats.emptyPosition += 1;
                    return;
                }
                if (!teacher) {
                    skipStats.emptyTeacher += 1;
                    return;
                }
                if (currentSections.length === 0) {
                    skipStats.emptySections += 1;
                    return;
                }
                if (weeks.length === 0) {
                    skipStats.emptyWeeks += 1;
                    return;
                }

                courses.push({
                    name,
                    teacher,
                    position,
                    day,
                    startSection: currentSections[0],
                    endSection: currentSections[currentSections.length - 1],
                    weeks
                });
            });
    });

    debugLog("list view summary", {
        rowCount,
        parsedCount: courses.length,
        skipStats
    });

    return courses;
}

function detectViewType() {
    const typeButton = document.querySelector("#shcPDF");
    const dataType = normalizeText(typeButton?.dataset?.type || "");
    debugLog("detectViewType", {
        url: window.location.href,
        shcPDFExists: !!typeButton,
        shcPDFDataType: dataType,
        hasKbGrid0: !!document.querySelector("#kbgrid_table_0"),
        hasKbList: !!document.querySelector("#kblist_table"),
        tdWrapCount: document.querySelectorAll("td.td_wrap").length,
        timetableConCount: document.querySelectorAll(".timetable_con").length
    });
    if (dataType === "list" || dataType === "table") return dataType;

    if (document.querySelector("#kbgrid_table_0")) return "table";
    if (document.querySelector("#kblist_table")) return "list";
    return null;
}

function deduplicateCourses(courses) {
    const seen = new Set();
    const result = [];

    for (const c of courses) {
        const key = [
            c.name,
            c.teacher,
            c.position,
            c.day,
            c.startSection,
            c.endSection,
            c.weeks.join("-")
        ].join("|");

        if (!seen.has(key)) {
            seen.add(key);
            result.push(c);
        }
    }
    return result;
}

async function scrapeAndParseCourses() {
    const $ = window.jQuery;
    debugLog("scrapeAndParseCourses start", {
        jQueryExists: !!$,
        readyState: document.readyState,
        title: document.title
    });
    if (!$) {
        await window.AndroidBridgePromise.showAlert(
            "导入失败",
            "页面缺少 jQuery 依赖，请刷新页面后重试。",
            "确定"
        );
        return null;
    }

    const type = detectViewType();
    if (!type) {
        await window.AndroidBridgePromise.showAlert(
            "导入失败",
            "未找到课表主体区域，请确认你已进入课表查询页面并点击查询。",
            "确定"
        );
        return null;
    }

    let parsedCourses = [];
    if (type === "list") {
        parsedCourses = parseListView($);
    } else {
        parsedCourses = parseTableView($);
    }

    const courses = deduplicateCourses(parsedCourses);
    debugLog("deduplicate summary", {
        rawCount: parsedCourses.length,
        deduplicatedCount: courses.length
    });
    if (courses.length === 0) {
        AndroidBridge.showToast("未解析到课程，请确认学年学期与页面展示是否正确。");
        debugLog("parse result empty, abort import");
        return null;
    }

    console.log(`JS: 识别视图 ${type}，解析得到 ${courses.length} 条课程`);
    return courses;
}

async function saveCourses(courses) {
    AndroidBridge.showToast(`正在保存 ${courses.length} 门课程...`);
    try {
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        console.error("JS: 保存课程失败", error);
        AndroidBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

async function runImportFlow() {
    const confirmed = await window.AndroidBridgePromise.showAlert(
        "江苏大学课表导入",
        "请先在教务系统课表页选择学年学期并点击查询，确认课表已显示后再导入。",
        "开始导入"
    );

    if (!confirmed) {
        AndroidBridge.showToast("用户取消导入。");
        return;
    }

    const campusPrefixOptions = [
        "保留地点校区前缀（如 本部、北固）",
        "裁剪地点校区前缀（如 本部、北固）"
    ];
    const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
        "地点处理方式",
        JSON.stringify(campusPrefixOptions),
        DEFAULT_TRIM_CAMPUS_PREFIX ? 1 : 0
    );

    if (selectedIndex === 0) {
        trimCampusPrefix = false;
    } else if (selectedIndex === 1) {
        trimCampusPrefix = true;
    } else {
        trimCampusPrefix = DEFAULT_TRIM_CAMPUS_PREFIX;
        AndroidBridge.showToast("未选择地点处理方式，已使用默认策略。");
    }

    const courses = await scrapeAndParseCourses();
    if (!courses) {
        return;
    }

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    AndroidBridge.showToast(`导入成功，共 ${courses.length} 门课程。`);
    AndroidBridge.notifyTaskCompletion();
}

runImportFlow();