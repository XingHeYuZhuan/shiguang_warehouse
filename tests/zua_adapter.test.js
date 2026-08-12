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
    window: { AndroidBridgePromise: {} }
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
        <input id="semesterBar20826294511Semester" value="297">
        <script>bg.form.addInput(form,"ids","123456");</script>
    `;
    assert.deepEqual(plain(context.parseParameters(parameterHtml)), {
        ids: "123456",
        tagId: "semesterBar20826294511Semester",
        currentSemesterId: "297"
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
            y26:[{id:297,schoolYear:"2026-2027",name:"1"}]
        },
        yearIndex:"26",
        termIndex:"0",
        semesterId:"297"
    }`;
    const parsedSemesters = plain(context.parseSemesterResponse(semesterRaw));
    assert.deepEqual(parsedSemesters.semesters.map(item => item.name), [
        "2026-2027 第1学期",
        "2025-2026 第2学期",
        "2025-2026 第1学期"
    ]);
    assert.equal(parsedSemesters.currentSemesterId, "297");

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
    const selectedSemester = await context.getSelectedSemester("semesterBar20826294511Semester", "297");
    assert.equal(selectedSemester.id, "297");
    assert.equal(selectionItems.defaultIndex, 0);
    assert.match(semesterRequest.options.body, /tagId=semesterBar20826294511Semester/);
    assert.match(semesterRequest.options.body, /value=297/);
    assert.match(semesterRequest.options.body, /empty=false/);
    assert.equal(semesterRequest.options.credentials, "include");

    let courseRequest;
    context.fetch = async (url, options) => {
        courseRequest = { url, options };
        return { ok: true, status: 200, text: async () => html };
    };
    const fetchedCourses = plain(await context.fetchAndParseCourses("297", "123456"));
    assert.deepEqual(fetchedCourses, courses);
    assert.equal(courseRequest.url, "http://jwglxt.zua.edu.cn/eams/courseTableForStd!courseTable.action");
    assert.match(courseRequest.options.body, /ignoreHead=1/);
    assert.match(courseRequest.options.body, /setting\.kind=std/);
    assert.match(courseRequest.options.body, /startWeek=/);
    assert.match(courseRequest.options.body, /semester\.id=297/);
    assert.match(courseRequest.options.body, /ids=123456/);
    assert.equal(courseRequest.options.credentials, "include");

    assert.ok(!/addInput\([^\n]+["']ids["'][^\n]+["']\d{5,}["']/.test(originalSource));
    const forbiddenSecurityTerms = ["JSESSION" + "ID", "Author" + "ization", "pass" + "word"];
    assert.ok(!new RegExp(forbiddenSecurityTerms.join("|"), "i").test(originalSource));
    console.log("ZUA adapter tests passed");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
