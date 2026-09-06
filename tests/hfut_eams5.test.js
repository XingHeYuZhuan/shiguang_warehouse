"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const adapter = require("../resources/HFUT/hfut_eams5.js");

const COURSE_UNITS = [
  [800, 845],
  [855, 940],
  [1000, 1045],
  [1055, 1140],
  [1400, 1445],
  [1455, 1540],
  [1550, 1635],
  [1645, 1730],
  [1740, 1825],
  [1920, 2005],
  [2015, 2100],
  [2110, 2155],
].map(([startTime, endTime]) => ({ startTime, endTime }));

test("normalizes the twelve EAMS5 course units from the saved HFUT page format", () => {
  const units = adapter.normalizeCourseUnits(COURSE_UNITS);
  assert.equal(units.length, 12);
  assert.deepEqual(units[0], {
    number: 1,
    startMinutes: 480,
    endMinutes: 525,
    startTime: "08:00",
    endTime: "08:45",
  });
  assert.equal(units[11].startTime, "21:10");
  assert.equal(units[11].endTime, "21:55");
});

test("converts per-week records and keeps Saturday, Sunday, room changes and custom times", () => {
  const lessonList = [
    { id: 1, courseName: "编译原理", teacherAssignmentList: [{ name: "张老师" }] },
    { id: 2, courseName: "周末实践", teacherAssignmentList: [{ name: "李老师" }] },
    { id: 3, courseName: "晚间讲座", teacherAssignmentList: [{ name: "王老师" }] },
    { id: 4, courseName: "未发布课程" },
  ];
  const scheduleList = [
    { lessonId: 1, scheduleGroupId: 10, weekday: 1, weekIndex: 1, startTime: 800, endTime: 940, periods: 2, personName: "张老师", room: { nameZh: "翠八教101" } },
    { lessonId: 1, scheduleGroupId: 10, weekday: 1, weekIndex: 2, startTime: 800, endTime: 940, periods: 2, personName: "张老师", room: { nameZh: "翠八教101" } },
    { lessonId: 2, scheduleGroupId: 20, weekday: 6, weekIndex: 3, startTime: 1000, endTime: 1140, personName: "李老师", room: { nameZh: "工程训练中心" } },
    { lessonId: 2, scheduleGroupId: 20, weekday: 7, weekIndex: 4, startTime: 1000, endTime: 1140, personName: "李老师", room: { nameZh: "工程训练中心" } },
    { lessonId: 2, scheduleGroupId: 21, weekday: 7, weekIndex: 5, startTime: 1400, endTime: 1540, personName: "李老师", room: { nameZh: "A101" } },
    { lessonId: 2, scheduleGroupId: 21, weekday: 7, weekIndex: 6, startTime: 1400, endTime: 1540, personName: "李老师", room: { nameZh: "B202" } },
    { lessonId: 3, scheduleGroupId: 30, weekday: 7, weekIndex: 8, startTime: 1830, endTime: 1915, customPlace: "线上" },
    { lessonId: 4, scheduleGroupId: 40, weekday: 7, weekIndex: 1, startTime: 800, endTime: 845 },
  ];

  const courses = adapter.convertScheduleData({
    lessonList,
    scheduleList,
    courseUnits: COURSE_UNITS,
    publishedFlags: { 1: "publish", 2: "publish", 3: "publish", 4: "draft" },
    semesterStartDate: "2026-09-07",
  });

  assert.deepEqual(courses.find((course) => course.name === "编译原理").weeks, [1, 2]);
  assert.ok(courses.some((course) => course.day === 6));
  assert.equal(courses.filter((course) => course.day === 7).length, 4);
  assert.deepEqual(
    courses.filter((course) => course.name === "周末实践" && course.day === 7).map((course) => [course.position, course.weeks]),
    [["工程训练中心", [4]], ["A101", [5]], ["B202", [6]]]
  );
  assert.deepEqual(courses.find((course) => course.name === "晚间讲座"), {
    name: "晚间讲座",
    teacher: "王老师",
    position: "线上",
    day: 7,
    weeks: [8],
    isCustomTime: true,
    customStartTime: "18:30",
    customEndTime: "19:15",
  });
  assert.ok(!courses.some((course) => course.name === "未发布课程"));
});

test("parses rendered EAMS5 card text without assuming weekdays only", () => {
  assert.deepEqual(
    adapter.parseRenderedCardText("数据结构\n翠八教负09* (1~8周) 7 (3,4)", 7),
    {
      name: "数据结构",
      teacher: "",
      position: "翠八教负09*",
      day: 7,
      startSection: 3,
      endSection: 4,
      weeks: [1, 2, 3, 4, 5, 6, 7, 8],
    }
  );
  assert.deepEqual(adapter.parseWeekText("1~15单周,2~16双周"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test("the rendered-page fallback scans all seven weekday columns", () => {
  const fakeCard = (text) => ({
    classList: { contains: (name) => name === "card-view" },
    querySelector: () => ({ innerText: text }),
  });
  const columns = Array.from({ length: 7 }, (_, index) => ({
    children: index === 5
      ? [fakeCard("周六课程\n翡翠湖校区 (2~4周) 6 (1,2)")]
      : index === 6
        ? [fakeCard("周日课程\n屯溪路校区 (1,3,5周) 7 (11,12)")]
        : [],
  }));
  const documentObject = {
    querySelectorAll: (selector) => selector.includes("columns.weekday") ? columns : [],
  };

  const courses = adapter.parseRenderedSchedule(documentObject);
  assert.deepEqual(courses.map((course) => course.day), [6, 7]);
  assert.deepEqual(courses[1].weeks, [1, 3, 5]);
  assert.equal(courses[1].endSection, 12);
});

test("runs the complete bridge flow against mocked EAMS5 endpoints", async () => {
  const saved = {};
  const requests = [];
  const responses = {
    "get-data": {
      timeTableLayoutId: 99,
      lessonIds: [7],
      lessons: [{ id: 7, courseName: "周日实验", teacherAssignmentList: [{ name: "陈老师" }] }],
      lessonId2Flag: { 7: "publish" },
      weekIndices: Array.from({ length: 20 }, (_, index) => index + 1),
    },
    datum: {
      result: {
        lessonList: [{ id: 7, courseName: "周日实验", teacherAssignmentList: [{ name: "陈老师" }] }],
        scheduleList: [
          { lessonId: 7, scheduleGroupId: 1, weekday: 7, weekIndex: 2, startTime: 800, endTime: 940, room: { nameZh: "实验楼201" } },
        ],
      },
    },
    layout: { result: { courseUnitList: COURSE_UNITS } },
  };
  const root = {
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [
      { id: 354, nameZh: "2026-2027学年第一学期", startDate: "2026-09-07", endDate: "2027-01-17", weekStartOnSunday: false },
    ],
    document: { querySelector: () => null },
    fetch: async (url, init) => {
      requests.push({ url, init });
      const payload = url.includes("get-data") ? responses["get-data"] : url.includes("/datum") ? responses.datum : responses.layout;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    },
    shiguangBridgePromise: {
      showSingleSelection: async () => 0,
      saveImportedCourses: async (json) => { saved.courses = JSON.parse(json); },
      savePresetTimeSlots: async (json) => { saved.timeSlots = JSON.parse(json); },
      saveCourseConfig: async (json) => { saved.config = JSON.parse(json); },
      showAlert: async () => true,
    },
    shiguangBridge: {
      showToast: () => {},
      notifyTaskCompletion: () => { saved.completed = true; },
    },
  };

  const result = await adapter.runImportFlow(root);
  assert.equal(result.success, true);
  assert.equal(saved.courses[0].day, 7);
  assert.deepEqual(saved.courses[0].weeks, [2]);
  assert.equal(saved.timeSlots.length, 12);
  assert.deepEqual(saved.config, {
    semesterStartDate: "2026-09-07",
    semesterTotalWeeks: 20,
    defaultClassDuration: 45,
    defaultBreakDuration: 10,
    firstDayOfWeek: 1,
  });
  assert.equal(saved.completed, true);
  assert.match(requests[0].url, /bizTypeId=2&semesterId=354&dataId=12345$/);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    lessonIds: [7],
    studentId: 12345,
    weekIndex: "",
  });
  assert.deepEqual(JSON.parse(requests[2].init.body), { timeTableLayoutId: 99 });
});

test("derives an inclusive semester length when week indices are unavailable", () => {
  const config = adapter.buildCourseConfig(
    { startDate: "2026-09-07", endDate: "2027-01-17", weekStartOnSunday: false },
    { weekIndices: [] },
    [],
    adapter.normalizeCourseUnits(COURSE_UNITS)
  );
  assert.equal(config.semesterTotalWeeks, 19);
});
