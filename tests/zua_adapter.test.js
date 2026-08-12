const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const adapterPath = path.resolve(__dirname, "../resources/ZUA/zua.js");
const originalSource = fs.readFileSync(adapterPath, "utf8");
const sourceWithoutBootstrap = originalSource.replace(/\nrunImportFlow\(\);\s*$/, "\n");

const context = {
    console,
    URLSearchParams,
    fetch: null,
    window: { AndroidBridgePromise: {} },
    AndroidBridge: {}
};
vm.createContext(context);
vm.runInContext(sourceWithoutBootstrap, context, { filename: adapterPath });

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function bitmap(weeks, length = 20) {
    const chars = Array.from({ length }, () => "0");
    for (const week of weeks) chars[week] = "1";
    return chars.join("");
}

function activityBlock({ teacher, name, position, weeks, dayIndex, sections, remark = "" }) {
    return `
var teachers = [{id:1,name:"${teacher}"}];
var actTeachers = [{id:1,name:"${teacher}",lab:true}];
activity = new TaskActivity(
    actTeacherId.join(','),
    actTeacherName.join(','),
    "ANON.001",
    "${name}",
    "ROOM",
    "${position}",
    "${bitmap(weeks)}",
    null,
    null,
    assistantName,
    "${remark}",
    ""
);
${sections.map(section => `index = ${dayIndex} * unitCount + ${section};
table0.activities[index][table0.activities[index].length]=activity;`).join("\n")}
`;
}

async function run() {
    const parameterHtml = `
        <input id="semesterBar20826294511Semester" value="999">
        <script>bg.form.addInput(form,"ids","123456");</script>
    `;
    assert.deepEqual(plain(context.parseParameters(parameterHtml)), {
        ids: "123456",
        tagId: "semesterBar20826294511Semester",
        currentSemesterId: "999"
    });

    let detectedRequest;
    context.fetch = async (url, options) => {
        detectedRequest = { url, options };
        return { ok: true, status: 200, text: async () => parameterHtml };
    };
    assert.equal((await context.detectParameters()).ids, "123456");
    assert.equal(detectedRequest.url, "http://jwglxt.zua.edu.cn/eams/courseTableForStd.action");
    assert.equal(detectedRequest.options.credentials, "include");

    const semesterRaw = `{
        semesters:{
            y25:[
                {id:257,schoolYear:"2025-2026",name:"1"},
                {id:277,schoolYear:"2025-2026",name:"2"}
            ],
            y26:[{id:999,schoolYear:"2026-2027",name:"1"}]
        },
        yearIndex:"26",
        termIndex:"0",
        semesterId:"999"
    }`;
    const parsedSemesters = plain(context.parseSemesterResponse(semesterRaw));
    assert.deepEqual(parsedSemesters.semesters.map(item => item.name), [
        "2026-2027 第1学期",
        "2025-2026 第2学期",
        "2025-2026 第1学期"
    ]);
    assert.equal(parsedSemesters.currentSemesterId, "999");

    assert.deepEqual(plain(context.parseCalendarInfo("开始/结束日期：2026-9-7~2027-2-21 (24)")), {
        semesterStartDate: "2026-09-07",
        semesterEndDate: "2027-02-21",
        semesterTotalWeeks: 24,
        firstDayOfWeek: 1
    });
    assert.deepEqual(plain(context.parseCalendarInfo(`
        <th>开始/结束日期：</th>
        <td>2026-10-12 &nbsp; ~ &nbsp; 2027-01-31&nbsp;(16)</td>
    `)), {
        semesterStartDate: "2026-10-12",
        semesterEndDate: "2027-01-31",
        semesterTotalWeeks: 16,
        firstDayOfWeek: 1
    });
    assert.deepEqual(plain(context.parseCalendarInfo("开始/结束日期：2026 - 2 - 3~2026 - 6 - 28(21)")), {
        semesterStartDate: "2026-02-03",
        semesterEndDate: "2026-06-28",
        semesterTotalWeeks: 21,
        firstDayOfWeek: 1
    });
    assert.deepEqual(plain(context.parseCalendarInfo(`
        <div>页面生成日期：2025-01-01~2025-01-07 (1)</div>
        <th>开始/结束日期：</th>
        <td>2026-9-7~2027-2-21 (24)</td>
    `)), {
        semesterStartDate: "2026-09-07",
        semesterEndDate: "2027-02-21",
        semesterTotalWeeks: 24,
        firstDayOfWeek: 1
    });
    assert.equal(context.parseCalendarInfo("开始/结束日期：2026-2-30~2026-7-1 (20)"), null);
    assert.equal(context.parseCalendarInfo("开始/结束日期：2026-2-3~2026-6-28 (0)"), null);
    assert.equal(context.parseCalendarInfo("开始/结束日期：2026-2-3~2026-6-28 (61)"), null);
    assert.equal(context.parseCalendarInfo("2026-9-7~2027-2-21 (24)"), null);
    assert.equal(context.parseCalendarInfo("calendar unavailable"), null);

    const timeSlots = plain(context.getZuaTimeSlots());
    assert.equal(timeSlots.length, 10);
    assert.deepEqual(timeSlots.map(slot => slot.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    const toMinutes = value => {
        const [hour, minute] = value.split(":").map(Number);
        return hour * 60 + minute;
    };
    timeSlots.forEach((slot, index) => {
        assert.match(slot.startTime, timePattern);
        assert.match(slot.endTime, timePattern);
        assert.ok(toMinutes(slot.startTime) < toMinutes(slot.endTime));
        if (index > 0) assert.ok(toMinutes(timeSlots[index - 1].endTime) <= toMinutes(slot.startTime));
    });

    const html = `var unitCount = 10;
${activityBlock({
    teacher: "教师甲",
    name: "大学物理（二）(26271.KB006C.008)",
    position: "01B204（智慧教室）",
    weeks: [1, 3, 5],
    dayIndex: 3,
    sections: [0, 1]
})}
${activityBlock({
    teacher: "教师乙",
    name: "嵌入式系统设计(ANON.COURSE.001)",
    position: "08B407(机电仿真中心)",
    weeks: [1, 3],
    dayIndex: 1,
    sections: [2, 3],
    remark: "匿名实验项目一"
})}
${activityBlock({
    teacher: "教师乙",
    name: "嵌入式系统设计(ANON.COURSE.001)",
    position: "08B407(机电仿真中心)",
    weeks: [1, 3],
    dayIndex: 1,
    sections: [2, 3],
    remark: "匿名实验项目二"
})}
${activityBlock({
    teacher: "教师乙",
    name: "嵌入式系统设计(ANON.COURSE.001)",
    position: "02A203(听力)",
    weeks: [2, 4],
    dayIndex: 1,
    sections: [2, 3]
})}`;

    const courses = plain(context.parseTaskActivities(html));
    const physics = courses.find(course => course.name === "大学物理（二）");
    assert.ok(physics);
    assert.equal(physics.teacher, "教师甲");
    assert.equal(physics.position, "01B204（智慧教室）");
    assert.equal(physics.day, 4);
    assert.equal(physics.startSection, 1);
    assert.equal(physics.endSection, 2);
    assert.deepEqual(physics.weeks, [1, 3, 5]);

    const labs = courses.filter(course => course.name === "嵌入式系统设计");
    assert.equal(labs.length, 2, "不同 remark 不应重复，同名课程的不同教室不得合并");
    const simulationLab = labs.find(course => course.position === "08B407(机电仿真中心)");
    const listeningLab = labs.find(course => course.position === "02A203(听力)");
    assert.deepEqual(simulationLab.weeks, [1, 3]);
    assert.deepEqual(listeningLab.weeks, [2, 4]);
    assert.equal(simulationLab.startSection, 3);
    assert.equal(simulationLab.endSection, 4);

    assert.deepEqual(plain(context.parseWeeksBitmap(bitmap([1, 3, 5, 7]))), [1, 3, 5, 7]);
    assert.deepEqual(plain(context.parseWeeksBitmap(bitmap([2, 4, 6, 8]))), [2, 4, 6, 8]);
    assert.deepEqual(
        plain(context.parseWeeksBitmap(bitmap([0, 1, 1, 60, 61], 63))),
        [1, 60],
        "第 0 周是占位，第 61 周及以后必须被过滤"
    );
    assert.deepEqual(plain(context.parseWeeksBitmap("x1x")), [1], "异常字符不得生成非法周数");

    const sharedTeacherHtml = `var unitCount = 10;
var teachers = [{id:1,name:"共享教师"}];
var actTeachers = [{id:1,name:"共享教师",lab:true}];
activity = new TaskActivity(null, null, "A.001", "课程A(编号A)", "ROOM", "教室A", "${bitmap([1, 2])}", null, null, null, "", "");
index = 0 * unitCount + 0;
table0.activities[index][table0.activities[index].length]=activity;
activity = new TaskActivity(null, null, "B.001", "课程B(编号B)", "ROOM", "教室B", "${bitmap([3, 4])}", null, null, null, "", "");
index = 1 * unitCount + 2;
table0.activities[index][table0.activities[index].length]=activity;`;
    const sharedTeacherCourses = plain(context.parseTaskActivities(sharedTeacherHtml));
    assert.deepEqual(sharedTeacherCourses, [
        {
            name: "课程A",
            teacher: "共享教师",
            position: "教室A",
            day: 1,
            startSection: 1,
            endSection: 1,
            weeks: [1, 2]
        },
        {
            name: "课程B",
            teacher: "共享教师",
            position: "教室B",
            day: 2,
            startSection: 3,
            endSection: 3,
            weeks: [3, 4]
        }
    ], "同一 teachers block 内的多个活动必须各自拥有对应 index");

    const sharedTeacherDifferentRoomsHtml = `var unitCount = 10;
var teachers = [{id:1,name:"同一教师"}];
var actTeachers = [{id:1,name:"同一教师",lab:true}];
activity = new TaskActivity(null, null, "C.001", "实验课(编号C)", "ROOM", "实验室一", "${bitmap([1])}", null, null, null, "", "");
index = 2 * unitCount + 0;
table0.activities[index][table0.activities[index].length]=activity;
activity = new TaskActivity(null, null, "C.002", "实验课(编号D)", "ROOM", "实验室二", "${bitmap([1])}", null, null, null, "", "");
index = 2 * unitCount + 1;
table0.activities[index][table0.activities[index].length]=activity;`;
    const sharedTeacherDifferentRooms = plain(context.parseTaskActivities(sharedTeacherDifferentRoomsHtml));
    assert.equal(sharedTeacherDifferentRooms.length, 2, "同教师同课程的不同教室不得错误合并");
    assert.deepEqual(sharedTeacherDifferentRooms.map(course => course.position), ["实验室一", "实验室二"]);

    const indexBoundaryHtml = `var unitCount = 10;
${activityBlock({
    teacher: "边界教师",
    name: "非法星期(编号)",
    position: "边界教室",
    weeks: [1],
    dayIndex: 7,
    sections: [0]
})}
${activityBlock({
    teacher: "边界教师",
    name: "非法节次(编号)",
    position: "边界教室",
    weeks: [1],
    dayIndex: 0,
    sections: [10]
})}
${activityBlock({
    teacher: "边界教师",
    name: "合法边界(编号)",
    position: "边界教室",
    weeks: [1],
    dayIndex: 6,
    sections: [9]
})}`;
    const indexBoundaryCourses = plain(context.parseTaskActivities(indexBoundaryHtml));
    assert.deepEqual(indexBoundaryCourses, [{
        name: "合法边界",
        teacher: "边界教师",
        position: "边界教室",
        day: 7,
        startSection: 10,
        endSection: 10,
        weeks: [1]
    }]);

    let selectionItems;
    let semesterRequest;
    context.fetch = async (url, options) => {
        semesterRequest = { url, options };
        return { ok: true, status: 200, text: async () => semesterRaw };
    };
    context.window.AndroidBridgePromise.showSingleSelection = async (title, items, defaultIndex) => {
        selectionItems = { title, items: JSON.parse(items), defaultIndex };
        return defaultIndex;
    };
    const selectedSemester = await context.getSelectedSemester("semesterBar20826294511Semester", "999");
    assert.equal(selectedSemester.id, "999");
    assert.equal(selectionItems.defaultIndex, 0);
    assert.match(semesterRequest.options.body, /tagId=semesterBar20826294511Semester/);
    assert.match(semesterRequest.options.body, /value=999/);
    assert.match(semesterRequest.options.body, /empty=false/);
    assert.equal(semesterRequest.options.credentials, "include");

    let courseRequest;
    context.fetch = async (url, options) => {
        courseRequest = { url, options };
        return { ok: true, status: 200, text: async () => html };
    };
    const fetchedCourses = plain(await context.fetchAndParseCourses("999", "123456"));
    assert.deepEqual(fetchedCourses, courses);
    assert.equal(courseRequest.url, "http://jwglxt.zua.edu.cn/eams/courseTableForStd!courseTable.action");
    assert.match(courseRequest.options.body, /ignoreHead=1/);
    assert.match(courseRequest.options.body, /setting\.kind=std/);
    assert.match(courseRequest.options.body, /startWeek=/);
    assert.match(courseRequest.options.body, /semester\.id=999/);
    assert.match(courseRequest.options.body, /ids=123456/);
    assert.equal(courseRequest.options.credentials, "include");

    let calendarRequest;
    context.fetch = async (url, options) => {
        calendarRequest = { url, options };
        return { ok: true, status: 200, text: async () => "开始/结束日期：2026-9-7~2027-2-21 (24)" };
    };
    assert.deepEqual(plain(await context.fetchCalendarInfo("999")), {
        semesterStartDate: "2026-09-07",
        semesterEndDate: "2027-02-21",
        semesterTotalWeeks: 24,
        firstDayOfWeek: 1
    });
    assert.equal(calendarRequest.url, "http://jwglxt.zua.edu.cn/eams/base/calendar-info.action");
    assert.match(calendarRequest.options.body, /version=1/);
    assert.match(calendarRequest.options.body, /semesterId=999/);
    assert.equal(calendarRequest.options.credentials, "include");

    const runFlow = async ({
        failCalendar = false,
        failTimeSlots = false,
        calendarSaveResult = true,
        timeSlotSaveResult = true
    }) => {
        const calls = [];
        const toasts = [];
        context.fetch = async (url, options) => {
            if (url.endsWith("/eams/courseTableForStd.action")) {
                return { ok: true, status: 200, text: async () => parameterHtml };
            }
            if (url.endsWith("/eams/dataQuery.action")) {
                return { ok: true, status: 200, text: async () => semesterRaw };
            }
            if (url.endsWith("/eams/courseTableForStd!courseTable.action")) {
                return { ok: true, status: 200, text: async () => html };
            }
            if (url.endsWith("/eams/base/calendar-info.action")) {
                return failCalendar
                    ? { ok: false, status: 503, text: async () => "" }
                    : { ok: true, status: 200, text: async () => "开始/结束日期：2026-9-7~2027-2-21 (24)" };
            }
            throw new Error(`unexpected request: ${url} ${options?.method || "GET"}`);
        };
        context.window.AndroidBridgePromise = {
            showSingleSelection: async () => 0,
            saveImportedCourses: async () => { calls.push("courses"); return true; },
            saveCourseConfig: async value => {
                calls.push(["config", JSON.parse(value)]);
                return calendarSaveResult;
            },
            savePresetTimeSlots: async value => {
                calls.push(["timeSlots", JSON.parse(value)]);
                if (failTimeSlots) throw new Error("time slots unavailable");
                return timeSlotSaveResult;
            }
        };
        context.AndroidBridge = {
            showToast: message => toasts.push(message),
            notifyTaskCompletion: () => calls.push("complete")
        };
        await context.runImportFlow();
        return { calls, toasts };
    };

    const successfulFlow = await runFlow({});
    assert.deepEqual(successfulFlow.calls.map(call => Array.isArray(call) ? call[0] : call), [
        "courses", "config", "timeSlots", "complete"
    ]);
    assert.deepEqual(successfulFlow.calls[1][1], {
        semesterStartDate: "2026-09-07",
        semesterTotalWeeks: 24,
        firstDayOfWeek: 1
    });
    assert.equal(successfulFlow.toasts.at(-1), "成功导入课表、学期信息和郑航作息");

    const calendarFailureFlow = await runFlow({ failCalendar: true });
    assert.deepEqual(calendarFailureFlow.calls.map(call => Array.isArray(call) ? call[0] : call), [
        "courses", "timeSlots", "complete"
    ]);
    assert.equal(calendarFailureFlow.toasts.at(-1), "课表已导入，学期日期获取失败，请在设置中确认");

    const timeSlotFailureFlow = await runFlow({ failTimeSlots: true });
    assert.deepEqual(timeSlotFailureFlow.calls.map(call => Array.isArray(call) ? call[0] : call), [
        "courses", "config", "timeSlots", "complete"
    ]);
    assert.equal(timeSlotFailureFlow.toasts.at(-1), "课表已导入，作息时间设置失败，请在设置中确认");

    const resolvedFalseFlow = await runFlow({ calendarSaveResult: false, timeSlotSaveResult: false });
    assert.deepEqual(resolvedFalseFlow.calls.map(call => Array.isArray(call) ? call[0] : call), [
        "courses", "config", "timeSlots", "complete"
    ]);
    assert.equal(
        resolvedFalseFlow.toasts.at(-1),
        "课表已导入，学期日期和作息时间设置失败，请在设置中确认"
    );

    assert.ok(!/addInput\([^\n]+["']ids["'][^\n]+["']\d{5,}["']/.test(originalSource));
    const forbiddenSecurityTerms = ["JSESSION" + "ID", "Author" + "ization", "pass" + "word"];
    assert.ok(!new RegExp(forbiddenSecurityTerms.join("|"), "i").test(originalSource));
    console.log("ZUA adapter tests passed");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
