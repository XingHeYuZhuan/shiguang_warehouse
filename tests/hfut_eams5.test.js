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

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    ...(options.useJson
      ? { json: async () => payload }
      : { text: async () => options.rawText ?? JSON.stringify(payload) }),
  };
}

function fakeCard(text) {
  return {
    classList: { contains: (name) => name === "card-view" },
    querySelector: () => ({ innerText: text }),
  };
}

function renderedDocument({ cardsByDay = {}, courseUnits = COURSE_UNITS, semesterSelect = null } = {}) {
  const columns = Array.from({ length: 7 }, (_, index) => ({
    children: (cardsByDay[index + 1] || []).map(fakeCard),
    querySelectorAll: (selector) => selector === ".blank-unit"
      ? courseUnits.map((unit) => ({
          getAttribute: (name) => name === "start-time" ? unit.startTime : unit.endTime,
        }))
      : [],
  }));
  return {
    querySelector: (selector) => selector === "#allSemesters" ? semesterSelect : null,
    querySelectorAll: (selector) => selector.includes("columns.weekday") ? columns : [],
  };
}

function addBridges(root, saved, overrides = {}) {
  root.shiguangBridgePromise = {
    showSingleSelection: async () => overrides.selectedIndex ?? 0,
    saveImportedCourses: async (json) => { saved.courses = JSON.parse(json); },
    savePresetTimeSlots: async (json) => { saved.timeSlots = JSON.parse(json); },
    saveCourseConfig: async (json) => { saved.config = JSON.parse(json); },
    showAlert: async (title, content) => { saved.alert = { title, content }; },
    ...overrides.promiseBridge,
  };
  root.shiguangBridge = {
    showToast: (message) => { saved.lastToast = message; },
    notifyTaskCompletion: () => { saved.completed = true; },
    ...overrides.bridge,
  };
  return root;
}

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

test("accepts both EAMS5 time encodings and ignores malformed course units", () => {
  assert.equal(adapter.timeToMinutes("00:00"), 0);
  assert.equal(adapter.timeToMinutes("0805"), 485);
  assert.equal(adapter.timeToMinutes(2110), 1270);
  assert.equal(adapter.timeToMinutes("24:00"), null);
  assert.equal(adapter.timeToMinutes("12:60"), null);
  assert.equal(adapter.timeToMinutes({ value: 800 }), null);

  const units = adapter.normalizeCourseUnits([
    { indexNo: "3", startTimeText: "08:00", endTimeText: "08:45" },
    null,
    { number: "invalid", startTimeText: {}, startTime: 855, endTimeText: {}, endTime: 940 },
    { index: 4, startTime: 1000, endTime: 945 },
  ]);
  assert.deepEqual(units.map((unit) => [unit.number, unit.startTime, unit.endTime]), [
    [3, "08:00", "08:45"],
    [3, "08:55", "09:40"],
  ]);
});

test("parses ranges, odd/even weeks, individual weeks and invalid input", () => {
  assert.deepEqual(adapter.parseWeekText("第1至7周（单周）"), [1, 3, 5, 7]);
  assert.deepEqual(adapter.parseWeekText("2—8双周"), [2, 4, 6, 8]);
  assert.deepEqual(adapter.parseWeekText("1、3，3；5"), [1, 3, 5]);
  assert.deepEqual(adapter.parseWeekText("8~3周"), []);
  assert.deepEqual(adapter.parseWeekText("无"), []);
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

test("normalizes weekday and week variants and derives missing values from the date", () => {
  const courses = adapter.convertScheduleData({
    lessonList: [],
    courseUnits: COURSE_UNITS,
    semesterStartDate: "2026-09-07",
    scheduleList: [
      {
        lessonId: 1,
        courseName: "周六双周课",
        weekday: "星期六",
        weekIndexes: [],
        weekIndices: "2~6双周",
        startTime: 800,
        endTime: 845,
      },
      {
        lessonId: 2,
        lessonName: "日期推导课",
        weekday: null,
        weekIndex: 0,
        date: "2026-09-13",
        startTimeText: "10:00",
        endTimeText: "10:45",
      },
      { lessonId: 3, courseName: "错误星期", weekday: "2026", weekIndex: 1, startTime: 800, endTime: 845 },
      { lessonId: 4, courseName: "错误时间", weekday: 1, weekIndex: 1, startTime: 2500, endTime: 2600 },
      { lessonId: 5, weekday: 1, weekIndex: 1, startTime: 800, endTime: 845 },
    ],
  });

  assert.deepEqual(courses.map((course) => [course.name, course.day, course.weeks]), [
    ["周六双周课", 6, [2, 4, 6]],
    ["日期推导课", 7, [1]],
  ]);
});

test("combines concurrent teachers and rooms without stringifying empty room objects", () => {
  const lessonList = [
    { id: 1, courseName: "联合授课", teacherAssignmentList: [{ person: { nameZh: "王老师" } }] },
    { id: 2, courseName: "无地点课程" },
    { id: 3, courseName: "字符串地点课程" },
  ];
  const nestedRoom = {
    nameZh: "101",
    building: { nameZh: "综合楼", campus: { nameZh: "翡翠湖校区" } },
  };
  const scheduleList = [
    { lessonId: 1, scheduleGroupId: 1, weekday: 2, weekIndex: 1, startTime: 800, endTime: 845, personName: "张老师", room: nestedRoom },
    { lessonId: 1, scheduleGroupId: 1, weekday: 2, weekIndex: 1, startTime: 800, endTime: 845, teacher: { nameZh: "李老师" }, room: nestedRoom },
    { lessonId: 1, scheduleGroupId: 1, weekday: 2, weekIndex: 2, startTime: 800, endTime: 845, room: { id: 99 }, customPlace: {}, placeName: "操场" },
    { lessonId: 2, scheduleGroupId: 2, weekday: 2, weekIndex: 1, startTime: 855, endTime: 940, room: { id: 100 } },
    { lessonId: 3, scheduleGroupId: 3, weekday: 2, weekIndex: 1, startTime: 1000, endTime: 1045, room: "临时教室" },
  ];

  const courses = adapter.convertScheduleData({ lessonList, scheduleList, courseUnits: COURSE_UNITS });
  const firstWeek = courses.find((course) => course.name === "联合授课" && course.weeks[0] === 1);
  const secondWeek = courses.find((course) => course.name === "联合授课" && course.weeks[0] === 2);
  const noLocation = courses.find((course) => course.name === "无地点课程");
  const stringLocation = courses.find((course) => course.name === "字符串地点课程");
  assert.deepEqual(firstWeek, {
    name: "联合授课",
    teacher: "张老师、李老师",
    position: "翡翠湖校区 综合楼 101",
    day: 2,
    weeks: [1],
    startSection: 1,
    endSection: 1,
  });
  assert.equal(secondWeek.teacher, "王老师");
  assert.equal(secondWeek.position, "操场");
  assert.equal(noLocation.position, "");
  assert.equal(stringLocation.position, "临时教室");
  assert.ok(courses.every((course) => !course.position.includes("[object Object]")));
});

test("sorts standard sections and custom times on the same minute scale", () => {
  const lessonList = [
    { id: 1, courseName: "晚间标准课" },
    { id: 2, courseName: "清晨自定义课" },
    { id: 3, courseName: "上午标准课" },
    { id: 4, courseName: "午间自定义课" },
  ];
  const scheduleList = [
    { lessonId: 1, weekday: 1, weekIndex: 1, startTime: 1920, endTime: 2005 },
    { lessonId: 2, weekday: 1, weekIndex: 1, startTime: 730, endTime: 745 },
    { lessonId: 3, weekday: 1, weekIndex: 1, startTime: 800, endTime: 845 },
    { lessonId: 4, weekday: 1, weekIndex: 1, startTime: 1200, endTime: 1230 },
  ];

  const courses = adapter.convertScheduleData({ lessonList, scheduleList, courseUnits: COURSE_UNITS });
  assert.deepEqual(courses.map((course) => course.name), [
    "清晨自定义课",
    "上午标准课",
    "午间自定义课",
    "晚间标准课",
  ]);
});

test("uses periods to recover a section span when the reported end time is not a unit boundary", () => {
  const courses = adapter.convertScheduleData({
    lessonList: [{ id: 1, courseName: "两节课" }],
    scheduleList: [{ lessonId: 1, weekday: "MONDAY", weekIndex: "3", startTime: 800, endTime: 930, periods: 2 }],
    courseUnits: COURSE_UNITS,
  });
  assert.equal(courses[0].startSection, 1);
  assert.equal(courses[0].endSection, 2);
  assert.equal(courses[0].isCustomTime, undefined);
});

test("supports Map and map-like publication flags without dropping falsey values", () => {
  const base = {
    lessonList: [
      { id: 1, courseName: "已发布" },
      { id: 2, courseName: "未发布" },
      { id: 3, courseName: "缺少发布状态" },
    ],
    scheduleList: [
      { lessonId: 1, weekday: 1, weekIndex: 1, startTime: 800, endTime: 845 },
      { lessonId: 2, weekday: 1, weekIndex: 1, startTime: 855, endTime: 940 },
      { lessonId: 3, weekday: 1, weekIndex: 1, startTime: 1000, endTime: 1045 },
    ],
    courseUnits: COURSE_UNITS,
  };
  const mapCourses = adapter.convertScheduleData({
    ...base,
    publishedFlags: new Map([["1", { flag: "publish" }], [2, { state: "draft" }]]),
  });
  assert.deepEqual(mapCourses.map((course) => course.name), ["已发布"]);

  const missingFlagCourses = adapter.convertScheduleData({
    ...base,
    publishedFlags: { 1: "publish" },
  });
  assert.deepEqual(missingFlagCourses.map((course) => course.name), ["已发布"]);

  const values = { 1: "publish", 2: false };
  const mapLikeCourses = adapter.convertScheduleData({
    ...base,
    publishedFlags: { get: (key) => typeof key === "string" ? values[key] : undefined },
  });
  assert.deepEqual(mapLikeCourses.map((course) => course.name), ["已发布"]);
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

test("parses single, ranged and multi-period EAMS5 rendered section labels", () => {
  assert.deepEqual(
    adapter.parseRenderedCardText("单节课\nA101 (1,3周) 星期六 (5节)", 6),
    {
      name: "单节课",
      teacher: "",
      position: "A101",
      day: 6,
      startSection: 5,
      endSection: 5,
      weeks: [1, 3],
    }
  );
  assert.deepEqual(
    adapter.parseRenderedCardText("长课\n实验室 (2~8双周) 周日 (从第 3 节开始，连 3 节)", 7),
    {
      name: "长课",
      teacher: "",
      position: "实验室",
      day: 7,
      startSection: 3,
      endSection: 5,
      weeks: [2, 4, 6, 8],
    }
  );
  assert.equal(adapter.parseRenderedCardText("错误范围\nA101 (1~4周) 1 (第5至3节)", 1), null);
});

test("uses the final week group when a rendered room label contains its own week annotation", () => {
  const course = adapter.parseRenderedCardText(
    "轮换教室\nA101(1~4周),B202(5~8周) (1~8周) 7 (10~12节)",
    7
  );
  assert.equal(course.position, "A101(1~4周),B202(5~8周)");
  assert.deepEqual(course.weeks, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(course.startSection, 10);
  assert.equal(course.endSection, 12);
});

test("rejects incomplete rendered cards and out-of-range weekday columns", () => {
  assert.equal(adapter.parseRenderedCardText("只有课程名", 1), null);
  assert.equal(adapter.parseRenderedCardText("课程\n教室 (无周次周) 1 (1,2)", 1), null);
  assert.equal(adapter.parseRenderedCardText("课程\n教室 (1~2周) 1 (1,2)", 8), null);
  assert.deepEqual(adapter.parseRenderedSchedule(null), []);
});

test("the rendered-page fallback scans all seven weekday columns", () => {
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

test("keeps the global semester list when Selectize collapses the native select", () => {
  const semesterSelect = {
    value: "334",
    options: [{ value: "334", textContent: "当前显示学期" }],
  };
  const context = adapter.extractPageContext({
    CONTEXT_PATH: "/eams5-student",
    studentId: "12345",
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 334 },
    semesters: [
      { id: 354, nameZh: "第一学期", startDate: "2026-09-07" },
      { id: 334, nameZh: "第二学期", startDate: "2026-03-02" },
    ],
    document: renderedDocument({ semesterSelect }),
  });

  assert.deepEqual(context.semesters.map((semester) => semester.id), ["354", "334"]);
  assert.deepEqual(context.semesters.map((semester) => semester.label), ["第一学期", "当前显示学期"]);
  assert.equal(context.selectedSemesterId, "334");
  assert.equal(context.defaultSemesterIndex, 1);
});

test("supports DOM-only semester options and student IDs from course-table URLs", () => {
  const semesterSelect = {
    value: "354",
    options: [
      { value: "", textContent: "请选择" },
      { value: "354", textContent: "第一学期" },
      { value: "334", textContent: "第二学期" },
    ],
  };
  const context = adapter.extractPageContext({
    location: { pathname: "/eams5-student/for-std/course-table/semester/354/print/12345" },
    semesters: [],
    currentSemester: { id: 354 },
    document: renderedDocument({ semesterSelect }),
  });
  assert.equal(context.studentId, 12345);
  assert.deepEqual(context.semesters.map((semester) => semester.id), ["354", "334"]);
  assert.throws(
    () => adapter.extractPageContext({ location: { pathname: "/dashboard" }, semesters: [], document: {} }),
    /个人课表/
  );
});

test("fetches an empty-semester snapshot without unnecessary datum or layout requests", async () => {
  const calls = [];
  const root = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        result: {
          lessonIds: [],
          lessons: [{ id: 1, courseName: "仅元数据课程" }],
          weekIndices: [1, 2],
        },
      }, { useJson: true });
    },
  };
  const snapshot = await adapter.fetchEams5Snapshot(
    root,
    { contextPath: "/eams5-student", studentId: 12345 },
    { id: "354" }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(snapshot.lessonList[0].courseName, "仅元数据课程");
  assert.deepEqual(snapshot.scheduleList, []);
  assert.deepEqual(snapshot.courseUnits, []);
  assert.equal(snapshot.layoutUnavailable, false);
});

test("keeps datum records when only the optional timetable-layout request fails", async () => {
  const root = {
    fetch: async (url) => {
      if (url.includes("get-data")) {
        return jsonResponse({ lessonIds: [1], timeTableLayoutId: 9, weekIndices: [1] });
      }
      if (url.includes("/datum")) {
        return jsonResponse({ result: { lessonList: [{ id: 1, courseName: "课程" }], scheduleList: [{ lessonId: 1 }] } });
      }
      return jsonResponse({}, { ok: false, status: 503 });
    },
  };
  const snapshot = await adapter.fetchEams5Snapshot(
    root,
    { contextPath: "/eams5-student", studentId: 12345 },
    { id: "354" }
  );
  assert.equal(snapshot.lessonList[0].courseName, "课程");
  assert.equal(snapshot.scheduleList.length, 1);
  assert.deepEqual(snapshot.courseUnits, []);
  assert.equal(snapshot.layoutUnavailable, true);
});

test("does not hide a required datum request failure", async () => {
  const root = {
    fetch: async (url) => url.includes("get-data")
      ? jsonResponse({ lessonIds: [1], timeTableLayoutId: null })
      : jsonResponse({}, { ok: false, status: 401 }),
  };
  await assert.rejects(
    adapter.fetchEams5Snapshot(
      root,
      { contextPath: "/eams5-student", studentId: 12345 },
      { id: "354" }
    ),
    /HTTP 401/
  );
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

test("falls back to the current rendered page after an API error and saves rendered time slots", async () => {
  const saved = {};
  const root = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [{ id: 354, nameZh: "当前学期", startDate: "2026-09-07", endDate: "2027-01-17" }],
    document: renderedDocument({
      cardsByDay: { 7: ["周日课程\n实验楼 (1~3周) 7 (1,2)"] },
    }),
    fetch: async () => jsonResponse({}, { ok: false, status: 500 }),
  }, saved);

  const result = await adapter.runImportFlow(root);
  assert.equal(result.success, true);
  assert.equal(result.fallbackUsed, true);
  assert.equal(saved.courses[0].day, 7);
  assert.equal(saved.courses[0].teacher, "");
  assert.equal(saved.timeSlots.length, 12);
  assert.match(saved.alert.content, /教师信息可能为空/);
  assert.equal(saved.completed, true);
});

test("falls back when the current-semester API succeeds but yields no course records", async () => {
  const saved = {};
  const root = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [{ id: 354, nameZh: "当前学期", startDate: "2026-09-07" }],
    document: renderedDocument({ cardsByDay: { 6: ["周六课程\n体育场 (2周) 6 (5节)"] } }),
    fetch: async (url) => url.includes("get-data")
      ? jsonResponse({ lessonIds: [], timeTableLayoutId: null, weekIndices: [1, 2] })
      : jsonResponse({}),
  }, saved);

  const result = await adapter.runImportFlow(root);
  assert.equal(result.success, true);
  assert.equal(result.fallbackUsed, true);
  assert.equal(saved.courses[0].day, 6);
  assert.deepEqual(saved.courses[0].weeks, [2]);
});

test("never reuses the current page DOM when a different selected semester fails", async () => {
  const saved = {};
  const root = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [
      { id: 354, nameZh: "当前学期", startDate: "2026-09-07" },
      { id: 334, nameZh: "历史学期", startDate: "2026-03-02" },
    ],
    document: renderedDocument({ cardsByDay: { 7: ["当前课程\n教室 (1周) 7 (1节)"] } }),
    fetch: async () => jsonResponse("登录页", { rawText: "<html>login</html>" }),
  }, saved, { selectedIndex: 1 });

  const result = await adapter.runImportFlow(root);
  assert.equal(result.success, false);
  assert.match(result.error, /非 JSON/);
  assert.equal(saved.courses, undefined);
  assert.equal(saved.completed, undefined);
});

test("uses rendered units when the optional layout endpoint fails", async () => {
  const saved = {};
  const root = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [{ id: 354, nameZh: "当前学期", startDate: "2026-09-07" }],
    document: renderedDocument(),
    fetch: async (url) => {
      if (url.includes("get-data")) {
        return jsonResponse({ lessonIds: [1], timeTableLayoutId: 9, lessonId2Flag: { 1: "publish" }, weekIndices: [1] });
      }
      if (url.includes("/datum")) {
        return jsonResponse({
          result: {
            lessonList: [{ id: 1, courseName: "接口课程" }],
            scheduleList: [{ lessonId: 1, weekday: 1, weekIndex: 1, startTime: 800, endTime: 940 }],
          },
        });
      }
      return jsonResponse({}, { ok: false, status: 503 });
    },
  }, saved);

  const result = await adapter.runImportFlow(root);
  assert.equal(result.success, true);
  assert.equal(result.fallbackUsed, false);
  assert.equal(saved.courses[0].startSection, 1);
  assert.equal(saved.courses[0].endSection, 2);
  assert.equal(saved.timeSlots.length, 12);
  assert.match(saved.alert.content, /教务作息接口不可用/);
});

test("treats time-slot and course-config save failures as non-fatal warnings", async () => {
  const saved = {};
  const root = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [{ id: 354, nameZh: "当前学期", startDate: "2026-09-07" }],
    document: renderedDocument(),
    fetch: async (url) => {
      if (url.includes("get-data")) return jsonResponse({ lessonIds: [1], timeTableLayoutId: 9, weekIndices: [1] });
      if (url.includes("/datum")) {
        return jsonResponse({ result: {
          lessonList: [{ id: 1, courseName: "课程" }],
          scheduleList: [{ lessonId: 1, weekday: 1, weekIndex: 1, startTime: 800, endTime: 845 }],
        } });
      }
      return jsonResponse({ result: { courseUnitList: COURSE_UNITS } });
    },
  }, saved, {
    promiseBridge: {
      savePresetTimeSlots: async () => { throw new Error("slot failure"); },
      saveCourseConfig: async () => { throw new Error("config failure"); },
    },
  });

  const result = await adapter.runImportFlow(root);
  assert.equal(result.success, true);
  assert.deepEqual(result.warnings, ["作息时间保存失败", "学期配置保存失败"]);
  assert.match(saved.alert.content, /作息时间保存失败；学期配置保存失败/);
  assert.equal(saved.completed, true);
});

test("handles selection cancellation, missing bridges and genuinely empty semesters", async () => {
  let fetchCalled = false;
  const cancelledRoot = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [{ id: 354, nameZh: "当前学期" }],
    document: renderedDocument(),
    fetch: async () => { fetchCalled = true; return jsonResponse({}); },
  }, {}, { selectedIndex: -1 });
  assert.deepEqual(await adapter.runImportFlow(cancelledRoot), { cancelled: true });
  assert.equal(fetchCalled, false);

  const missingBridge = await adapter.runImportFlow({});
  assert.equal(missingBridge.success, false);
  assert.match(missingBridge.error, /Bridge/);

  const dismissedError = await adapter.runImportFlow(addBridges({
    location: { pathname: "/dashboard" },
    semesters: [],
    document: { querySelector: () => null },
  }, {}, {
    promiseBridge: { showAlert: async () => { throw new Error("dismissed"); } },
  }));
  assert.equal(dismissedError.success, false);
  assert.match(dismissedError.error, /个人课表/);

  const saved = {};
  const emptyRoot = addBridges({
    CONTEXT_PATH: "/eams5-student",
    studentId: 12345,
    location: { pathname: "/eams5-student/for-std/course-table/info/12345" },
    currentSemester: { id: 354 },
    semesters: [{ id: 354, nameZh: "当前学期" }],
    document: renderedDocument({ courseUnits: [] }),
    fetch: async () => jsonResponse({ lessonIds: [], timeTableLayoutId: null }),
  }, saved);
  const emptyResult = await adapter.runImportFlow(emptyRoot);
  assert.equal(emptyResult.success, false);
  assert.match(emptyResult.error, /没有可导入/);
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

test("prefers observed weeks and handles Sunday-based or invalid semester dates safely", () => {
  const observed = adapter.buildCourseConfig(
    { startDate: "2026-09-06", endDate: "2026-09-12", weekStartOnSunday: true },
    { weekIndices: ["1", "18", "invalid"] },
    [{ weeks: [20] }],
    adapter.normalizeCourseUnits(COURSE_UNITS)
  );
  assert.equal(observed.semesterTotalWeeks, 20);
  assert.equal(observed.firstDayOfWeek, 7);
  assert.equal(observed.defaultClassDuration, 45);
  assert.equal(observed.defaultBreakDuration, 10);

  const reversed = adapter.buildCourseConfig(
    { startDate: "2026-09-07", endDate: "2026-09-01", weekStartOnSunday: false },
    { weekIndices: [] },
    [],
    []
  );
  assert.equal(reversed.semesterTotalWeeks, 20);
  assert.equal(reversed.semesterStartDate, "2026-09-07");

  const invalid = adapter.buildCourseConfig(
    { startDate: "2026-02-31", endDate: "2026-06-30", weekStartOnSunday: false },
    { weekIndices: [] },
    [],
    []
  );
  assert.equal(invalid.semesterStartDate, null);
  assert.equal(invalid.semesterTotalWeeks, 20);
});
