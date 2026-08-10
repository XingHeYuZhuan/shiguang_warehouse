function findHljuTimetableRequest() {
    const resources = performance.getEntriesByType("resource");

    const matches = resources
    .map(item => item.name)
    .filter(url =>
    url.includes("TimeTableNewService/GetTimeTableByStudent")
    );

    if (matches.length === 0) {
        return null;
    }

    return matches[matches.length - 1];
}


async function fetchHljuTimetable() {
    const url = findHljuTimetableRequest();

    if (!url) {
        throw new Error(
            "没有找到课表请求。\n" +
            "请先在黑龙江大学教务系统中打开“我的课程表”，" +
            "选择学期并点击“查询”。"
        );
    }

    console.log("找到黑龙江大学课表请求。");

    const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
        }
    });

    console.log("课表 API HTTP Status:", response.status);

    if (!response.ok) {
        throw new Error(
            `课表请求失败：HTTP ${response.status}`
        );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
        throw new Error("课表接口返回的数据不是数组。");
    }

    return data;
}


function parseSections(sectionText) {
    if (!sectionText) {
        return null;
    }

    const match = sectionText.match(
        /(\d+)\s*(?:,|，|-|~|～|至)\s*(\d+)/
    );

    if (!match) {
        return null;
    }

    return {
        start: parseInt(match[1], 10),
        end: parseInt(match[2], 10)
    };
}



function parseWeeks(weekText) {
    if (!weekText) {
        return [];
    }

    let text = weekText
    .replace(/^周次\s*[:：]\s*/, "")
    .replace(/周/g, "")
    .trim();

    if (!text) {
        return [];
    }

    const weeks = new Set();


    const rangeRegex = /(\d+)\s*[-~～至]\s*(\d+)/g;

    let rangeMatch;

    while ((rangeMatch = rangeRegex.exec(text)) !== null) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);

        if (start <= end) {
            for (let i = start; i <= end; i++) {
                weeks.add(i);
            }
        } else {
            for (let i = start; i >= end; i--) {
                weeks.add(i);
            }
        }
    }

    const remainingText = text.replace(
        /(\d+)\s*[-~～至]\s*(\d+)/g,
                                       ""
    );

    const numberMatches = remainingText.match(/\d+/g);

    if (numberMatches) {
        for (const number of numberMatches) {
            weeks.add(parseInt(number, 10));
        }
    }

    return Array.from(weeks).sort((a, b) => a - b);
}


function parseCourseBlock(block, weekday, sections) {
    const lines = block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

    if (lines.length < 2) {
        return null;
    }


    const name = lines[0];

    if (!name) {
        return null;
    }


    const teacherLine = lines[1] || "";

    let teacher = teacherLine
    .split(/\s+/)[0]
    .trim();

    // 查找地点
    let position = "";

    for (const line of lines) {
        const match = line.match(/^地点\s*[:：]\s*(.*)$/);

        if (match) {
            position = match[1].trim();
            break;
        }
    }

    // 查找周次
    let weeks = [];

    for (const line of lines) {
        const match = line.match(/^周次\s*[:：]\s*(.*)$/);

        if (match) {
            weeks = parseWeeks(match[1]);
            break;
        }
    }


    let courseSections = sections;

    for (const line of lines) {
        const match = line.match(/^节次\s*[:：]\s*(.*)$/);

        if (match) {
            const parsed = parseSections(match[1]);

            if (parsed) {
                courseSections = parsed;
            }

            break;
        }
    }

    if (!courseSections) {
        console.warn("无法解析课程节次：", block);
        return null;
    }

    if (weeks.length === 0) {
        console.warn("无法解析课程周次：", block);
        return null;
    }

    return {
        name: name,
        teacher: teacher,
        position: position,
        day: weekday,
        startSection: courseSections.start,
        endSection: courseSections.end,
        weeks: weeks
    };
}


function parseCourseCell(content, weekday, sections) {
    if (
        content === null ||
        content === undefined ||
        typeof content !== "string"
    ) {
        return [];
    }

    const text = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

    if (!text) {
        return [];
    }

    const blocks = text
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(block => block.length > 0);

    const courses = [];

    for (const block of blocks) {
        const course = parseCourseBlock(
            block,
            weekday,
            sections
        );

        if (course) {
            courses.push(course);
        }
    }

    return courses;
}


function parseHljuTimetable(data) {
    const weekdayFields = [
        { field: "Monday", day: 1 },
        { field: "Tuesday", day: 2 },
        { field: "Wednesday", day: 3 },
        { field: "Thursday", day: 4 },
        { field: "Friday", day: 5 },
        { field: "Saturday", day: 6 },
        { field: "Sunday", day: 7 }
    ];

    const courses = [];

    for (const row of data) {
        if (!row || typeof row !== "object") {
            continue;
        }

        // 当前这一行代表的节次，例如 "5,6"
        const sections = parseSections(row.JieCi);

        if (!sections) {
            console.warn("无法解析节次：", row.JieCi);
            continue;
        }

        for (const weekday of weekdayFields) {
            const content = row[weekday.field];

            if (
                content === null ||
                content === undefined ||
                content === ""
            ) {
                continue;
            }

            const cellCourses = parseCourseCell(
                content,
                weekday.day,
                sections
            );

            courses.push(...cellCourses);
        }
    }

    return courses;
}


function validateCourses(courses) {
    if (!Array.isArray(courses)) {
        throw new Error("解析结果不是课程数组。");
    }

    if (courses.length === 0) {
        throw new Error(
            "没有解析到任何课程。\n" +
            "请确认当前学期已经查询成功，并且课表中有课程。"
        );
    }

    for (const course of courses) {
        if (!course.name) {
            throw new Error("存在课程名称为空的课程。");
        }

        if (!course.teacher) {
            console.warn("课程没有解析出教师：", course.name);
        }

        if (!course.position) {
            console.warn("课程没有解析出地点：", course.name);
        }

        if (
            !Number.isInteger(course.day) ||
            course.day < 1 ||
            course.day > 7
        ) {
            throw new Error(
                `课程“${course.name}”的星期数据非法。`
            );
        }

        if (
            !Number.isInteger(course.startSection) ||
            !Number.isInteger(course.endSection)
        ) {
            throw new Error(
                `课程“${course.name}”的节次数据非法。`
            );
        }

        if (
            !Array.isArray(course.weeks) ||
            course.weeks.length === 0
        ) {
            throw new Error(
                `课程“${course.name}”没有有效周次。`
            );
        }
    }
}


function printCourses(courses) {
    console.log(
        "========== 黑龙江大学解析后的拾光课程 =========="
    );

    console.table(
        courses.map(course => ({
            课程: course.name,
            教师: course.teacher,
            地点: course.position,
            星期: course.day,
            开始节次: course.startSection,
            结束节次: course.endSection,
            周次: course.weeks.join(",")
        }))
    );

    console.log(
        "完整 CourseJsonModel：",
        courses
    );

    console.log(
        "================================================"
    );
}



async function saveHljuCourses(courses) {
    try {
        await window.AndroidBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );

        AndroidBridge.showToast(
            `成功导入 ${courses.length} 个课程时段！`
        );

        console.log(
            `成功导入 ${courses.length} 个课程时段。`
        );

        return true;

    } catch (error) {
        console.error("保存课程失败：", error);

        AndroidBridge.showToast(
            "课程保存失败：" + error.message
        );

        return false;
    }
}



async function runImportFlow() {
    try {
        AndroidBridge.showToast(
            "正在获取黑龙江大学课表..."
        );


        const timetable = await fetchHljuTimetable();

        console.log(
            "黑龙江大学原始课表数据：",
            timetable
        );


        const courses = parseHljuTimetable(
            timetable
        );

        validateCourses(courses);



        printCourses(courses);

        AndroidBridge.showToast(
            `解析成功，共 ${courses.length} 个课程时段`
        );



        const saveSuccess = await saveHljuCourses(
            courses
        );

        if (!saveSuccess) {
            return;
        }



        AndroidBridge.showToast(
            "黑龙江大学课表导入成功！"
        );

        console.log(
            "黑龙江大学课程导入全部完成。"
        );

        // 只有全部成功后才发送结束信号
        AndroidBridge.notifyTaskCompletion();

    } catch (error) {
        console.error(
            "========== 黑龙江大学课表导入失败 ==========",
            error
        );

        AndroidBridge.showToast(
            "课表导入失败：" + error.message
        );
    }
}


runImportFlow();
