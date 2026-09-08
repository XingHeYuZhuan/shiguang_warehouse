// ============================================================================
// 中国地质大学（武汉）正方教务系统 拾光课程表适配脚本
// ----------------------------------------------------------------------------
// 适用学校：中国地质大学（武汉）南望山校区 / 未来城校区
// 系统类型：正方教务系统（jwglxt）—— 学生课表查询
// 解析策略：优先使用列表视图（#kblist_table）解析，回退使用网格视图（#kbgrid_table_0）
// 作息支持：
//   1. 南望山校区 · 秋冬季作息（上午 08:00，下午 14:00，共 10 节）
//   2. 南望山校区 · 春夏季作息（5月1日后，上午 08:00，下午 14:30，共 10 节）
//   3. 未来城校区 · 标准作息（上午 08:30，下午 14:00，晚上 18:30，共 12 节）
// ============================================================================

/** 南望山校区 · 秋冬季作息（共12节） */
const CUG_NANWANGSHAN_AUTUMN = [
  { number: 1,  startTime: "08:00", endTime: "08:45" },
  { number: 2,  startTime: "08:50", endTime: "09:35" },
  { number: 3,  startTime: "10:05", endTime: "10:50" },
  { number: 4,  startTime: "10:55", endTime: "11:40" },
  { number: 5,  startTime: "14:00", endTime: "14:45" },
  { number: 6,  startTime: "14:50", endTime: "15:35" },
  { number: 7,  startTime: "16:00", endTime: "16:45" },
  { number: 8,  startTime: "16:50", endTime: "17:35" },
  { number: 9,  startTime: "19:00", endTime: "19:45" },
  { number: 10, startTime: "19:50", endTime: "20:35" },
  { number: 11, startTime: "20:40", endTime: "21:25" },
  { number: 12, startTime: "21:30", endTime: "22:15" }
];

/** 南望山校区 · 春夏季作息（5月1日后执行，下午推迟30分钟，共12节） */
const CUG_NANWANGSHAN_SUMMER = [
  { number: 1,  startTime: "08:00", endTime: "08:45" },
  { number: 2,  startTime: "08:50", endTime: "09:35" },
  { number: 3,  startTime: "10:05", endTime: "10:50" },
  { number: 4,  startTime: "10:55", endTime: "11:40" },
  { number: 5,  startTime: "14:30", endTime: "15:15" },
  { number: 6,  startTime: "15:20", endTime: "16:05" },
  { number: 7,  startTime: "16:35", endTime: "17:20" },
  { number: 8,  startTime: "17:25", endTime: "18:10" },
  { number: 9,  startTime: "19:30", endTime: "20:15" },
  { number: 10, startTime: "20:20", endTime: "21:05" },
  { number: 11, startTime: "21:10", endTime: "21:55" },
  { number: 12, startTime: "22:00", endTime: "22:45" }
];

/** 未来城校区 · 标准作息（全年统一，12节） */
const CUG_FUTURE_CITY = [
  { number: 1,  startTime: "08:30", endTime: "09:15" },
  { number: 2,  startTime: "09:20", endTime: "10:05" },
  { number: 3,  startTime: "10:15", endTime: "11:00" },
  { number: 4,  startTime: "11:05", endTime: "11:50" },
  { number: 5,  startTime: "14:00", endTime: "14:45" },
  { number: 6,  startTime: "14:50", endTime: "15:35" },
  { number: 7,  startTime: "15:45", endTime: "16:30" },
  { number: 8,  startTime: "16:35", endTime: "17:20" },
  { number: 9,  startTime: "18:30", endTime: "19:15" },
  { number: 10, startTime: "19:20", endTime: "20:05" },
  { number: 11, startTime: "20:15", endTime: "21:00" },
  { number: 12, startTime: "21:05", endTime: "21:50" }
];

/** 作息方案选项 */
const SCHEDULE_OPTIONS = [
  { name: "南望山校区 · 秋冬季作息（下午 14:00 上课）", slots: CUG_NANWANGSHAN_AUTUMN },
  { name: "南望山校区 · 春夏季作息（5月1日后，下午 14:30 上课）", slots: CUG_NANWANGSHAN_SUMMER },
  { name: "未来城校区 · 标准作息（上午 08:30 上课，全天12节）", slots: CUG_FUTURE_CITY }
];

/** 列表视图信息块里出现的字段标签 */
const LABELS = ["周数", "校区", "上课地点", "教师", "教学班"];

/**
 * 从纯文本中抽取指定标签的值，直到下一个已知标签或文本结束
 */
function labeled(text, label) {
  if (!text) return "";
  const others = LABELS.filter(l => l !== label).join("|");
  const re = new RegExp(
    label + "\\s*[：:]\\s*(.+?)(?=(?:\\s*(?:" + others + ")\\s*[：:])|$)",
    "s"
  );
  const m = text.match(re);
  return m ? (m[1] || "").trim() : "";
}

/**
 * 解析周次字符串："7-13周" / "7-8周,10-12周" / "7-10周,16周" / "1-16周(单)"
 */
function parseWeeks(weekStr) {
  if (!weekStr) return [];
  const weeks = [];
  String(weekStr).split(/[,，]/).forEach(part => {
    let p = (part || "").replace(/周/g, "").trim();
    if (!p) return;
    const single = p.includes("(单)");
    const double = p.includes("(双)");
    p = p.replace(/\(单\)|\(双\)/g, "").trim();
    let s, e;
    const range = p.match(/(\d+)\s*-\s*(\d+)/);
    if (range) {
      s = +range[1];
      e = +range[2];
    } else if (/^\d+$/.test(p)) {
      s = e = +p;
    } else {
      return;
    }
    for (let w = s; w <= e; w++) {
      if (single && w % 2 === 0) continue;
      if (double && w % 2 !== 0) continue;
      weeks.push(w);
    }
  });
  return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 从文本中收集所有周次标记并解析（避免把“周学时”等非周次词误判）
 */
function weeksFromText(text) {
  if (!text) return [];
  const tokens = text.match(/\d+\s*[-–]\s*\d+\s*周(?:\((单|双)\))?(?![\u4e00-\u9fa5])|\d+\s*周(?:\((单|双)\))?(?![\u4e00-\u9fa5])/g) || [];
  const weeks = [];
  tokens.forEach(t => weeks.push(...parseWeeks(t)));
  return [...new Set(weeks)].sort((a, b) => a - b);
}

/** 基础课程对象构造 */
function commonBlock(name, text, day, startSection, endSection) {
  const weeks = weeksFromText(text);
  if (!weeks.length || !name) return null;
  return {
    name: name,
    teacher: "",
    position: "",
    day: day,
    startSection: startSection,
    endSection: endSection,
    weeks: weeks,
    isCustomTime: false
  };
}

/**
 * 解析列表视图信息块（带“校区：/教师：/上课地点：”标签）
 */
function parseCourseBlockList(info, day, startSection, endSection) {
  const titleEl = info.querySelector(".title");
  const name = titleEl ? (titleEl.textContent || "").trim() : "";
  const text = info.textContent || "";
  const base = commonBlock(name, text, day, startSection, endSection);
  if (!base) return null;

  base.teacher = labeled(text, "教师");
  const pos = labeled(text, "上课地点");
  const campus = labeled(text, "校区");
  base.position = campus ? (campus + " " + pos).trim() : pos;
  return base;
}

/**
 * 解析网格视图信息块（字段来自 tooltip 的 title 属性）
 */
function parseCourseBlockGrid(info, day, startSection, endSection) {
  const titleEl = info.querySelector(".title");
  const name = titleEl ? (titleEl.textContent || "").trim() : "";
  const text = info.textContent || "";
  const base = commonBlock(name, text, day, startSection, endSection);
  if (!base) return null;

  let teacher = "", position = "", campus = "";
  info.querySelectorAll("p").forEach(p => {
    const span = p.querySelector("span[data-toggle='tooltip']");
    if (!span) return;
    const t = (span.getAttribute("title") || "").trim();
    const val = (p.textContent || "").replace(span.textContent || "", "").trim();
    if (t.indexOf("教师") === 0) teacher = val;
    else if (t.indexOf("上课地点") === 0) position = val;
    else if (t.indexOf("校区") === 0) campus = val;
  });

  base.teacher = teacher;
  base.position = campus ? (campus + " " + position).trim() : position;
  return base;
}

/** 解析列表视图（#kblist_table） */
function parseFromListTable() {
  const list = document.querySelector("#kblist_table");
  if (!list) return null;
  const courses = [];
  list.querySelectorAll("tbody[id^='xq_']").forEach(tb => {
    const day = parseInt((tb.id || "").replace("xq_", ""), 10);
    if (isNaN(day) || day < 1 || day > 7) return;
    tb.querySelectorAll("tr").forEach(tr => {
      const jc = tr.querySelector("[id^='jc_']");
      const info = tr.querySelector(".timetable_con");
      if (!jc || !info) return;
      const m = (jc.id || "").match(/jc_(\d+)-(\d+)-(\d+)$/);
      if (!m) return;
      const c = parseCourseBlockList(info, day, +m[2], +m[3]);
      if (c) courses.push(c);
    });
  });
  return courses.length ? courses : null;
}

/** 解析网格视图（#kbgrid_table_0） */
function parseFromGridTable() {
  const grid = document.querySelector("#kbgrid_table_0");
  if (!grid) return null;
  const courses = [];
  grid.querySelectorAll("td.td_wrap[id]").forEach(td => {
    const m = (td.id || "").match(/(\d+)-(\d+)$/);
    if (!m) return;
    const day = +m[1];
    const rowspan = parseInt(td.getAttribute("rowspan") || "1", 10);
    td.querySelectorAll(".timetable_con").forEach(info => {
      const text = info.textContent || "";
      const sec = text.match(/\((\d+)-(\d+)节\)/);
      const start = sec ? +sec[1] : +m[2];
      const end = sec ? +sec[2] : (+m[2] + rowspan - 1);
      const c = parseCourseBlockGrid(info, day, start, end);
      if (c) courses.push(c);
    });
  });
  return courses.length ? courses : null;
}

/** 合并去重：同名同师同地同天同节次合并周次 */
function mergeAndDistinctCourses(courses) {
  if (!Array.isArray(courses) || courses.length <= 1) return courses;
  const out = [];
  courses.forEach(c => {
    const weeks = Array.isArray(c.weeks) ? [...c.weeks] : [];
    const idx = out.findIndex(x =>
      x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
      x.day === c.day && x.startSection === c.startSection && x.endSection === c.endSection
    );
    if (idx >= 0) {
      out[idx].weeks = [...new Set([...out[idx].weeks, ...weeks])].sort((a, b) => a - b);
    } else {
      out.push({ ...c, weeks: weeks });
    }
  });
  return out;
}

/** 读取当前页面的学年学期 */
function readCurrentTerm() {
  const xnm = document.querySelector("#xnm");
  const xqm = document.querySelector("#xqm");
  let academicYear = xnm && xnm.value && xnm.value.trim() ? xnm.value.trim() : null;
  let semesterCode = xqm && xqm.value && xqm.value.trim() ? xqm.value.trim() : null;

  const titleEl = document.querySelector(".timetable_title h6, .timetable_title");
  const title = titleEl ? (titleEl.textContent || "") : "";
  const ym = title.match(/(\d{4})\s*-\s*(\d{4})\s*学年/);
  const sem = title.match(/第(\d)学期/);
  if (!academicYear && ym) academicYear = ym[1];
  if (!semesterCode && sem) {
    const map = { 1: "3", 2: "12", 3: "16" };
    semesterCode = map[+sem[1]] || null;
  }
  const label = title.trim() || "当前学期";
  return { academicYear, semesterCode, label };
}

/** 调用正方接口获取开学第1周日期作为 semesterStartDate */
async function fetchSemesterStartDate(academicYear, semesterCode) {
  if (!academicYear || !semesterCode) return null;
  const url = window.location.origin + "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
      },
      body: "xnm=" + encodeURIComponent(academicYear) + "&xqm=" + encodeURIComponent(semesterCode),
      credentials: "include"
    });
    if (resp.ok) {
      const json = await resp.json();
      if (Array.isArray(json) && json.length > 0) {
        const first = json.find(i => String(i.zs) === "1" || String(i.zsmc) === "1") || json[0];
        const raw = first && (first.rq || first.zcrq || first.ksrq);
        const m = raw && String(raw).match(/(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
      }
    }
  } catch (e) {
    console.warn("获取学期开学日期失败:", e);
  }
  return null;
}

/** 智能推测默认作息索引 */
function inferDefaultScheduleIndex(courses) {
  if (!courses || !courses.length) return 0;
  let fcCount = 0, nwsCount = 0;
  courses.forEach(c => {
    if (c.position.includes("未来城")) fcCount++;
    if (c.position.includes("南望山")) nwsCount++;
  });
  if (fcCount > nwsCount) {
    return 2; // 未来城校区
  }
  const currentMonth = new Date().getMonth() + 1;
  if (currentMonth >= 5 && currentMonth <= 9) {
    return 1; // 南望山春夏季
  }
  return 0; // 南望山秋冬季
}

/** 主导入流程 */
async function runImportFlow() {
  console.log("正在启动中国地质大学（武汉）课表导入流程...");
  window.shiguangBridge.showToast("正在检测教务课表页面...");

  // 1. 检查是否在课表页面
  const hasList = !!document.querySelector("#kblist_table");
  const hasGrid = !!document.querySelector("#kbgrid_table_0");

  if (!hasList && !hasGrid) {
    await window.shiguangBridgePromise.showAlert(
      "未检测到课表页面",
      "您当前尚未打开课表查询页面。\n\n请在系统中依次完成：\n1. 统一身份认证登录\n2. 从信息门户进入教务系统\n3. 打开「学生课表查询」并选中目标学期点击「查询」\n\n课表显示后，再次点击导入。",
      "我知道了"
    );
    return;
  }

  const term = readCurrentTerm();

  // 2. 解析课程
  const rawCourses = parseFromListTable() || parseFromGridTable();
  if (!rawCourses || rawCourses.length === 0) {
    window.shiguangBridge.showToast("未解析到任何课程，请确认课表已加载完毕。");
    await window.shiguangBridgePromise.showAlert(
      "课表为空或未加载",
      "未能从当前页面解析出有效课程数据。请确认页面已显示课表格子，或尝试重新点击「查询」按钮。",
      "好的"
    );
    return;
  }

  const courses = mergeAndDistinctCourses(rawCourses);
  console.log(`成功解析到 ${courses.length} 条课程条目。`, courses);

  // 3. 用户确认学期并选择作息
  const defaultIdx = inferDefaultScheduleIndex(courses);
  const optionsLabels = SCHEDULE_OPTIONS.map(opt => opt.name);

  let selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
    `识别到 ${courses.length} 门课程 (${term.label})\n请选择您的校区与作息时间：`,
    JSON.stringify(optionsLabels),
    defaultIdx
  );

  if (selectedIdx === null || selectedIdx === undefined || selectedIdx < 0) {
    // 若取消，回退为智能推测选项
    selectedIdx = defaultIdx;
    window.shiguangBridge.showToast("未选择作息，已采用推荐方案: " + SCHEDULE_OPTIONS[selectedIdx].name);
  }

  const chosenSchedule = SCHEDULE_OPTIONS[selectedIdx];

  // 4. 保存课程
  try {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
  } catch (error) {
    console.error("保存课程失败:", error);
    window.shiguangBridge.showToast("课程数据保存失败: " + error.message);
    return;
  }

  // 5. 保存时间段
  try {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(chosenSchedule.slots));
  } catch (error) {
    console.error("保存作息时间段失败:", error);
    window.shiguangBridge.showToast("作息时间保存失败: " + error.message);
  }

  // 6. 保存课表配置（含开学日期）
  const startDate = await fetchSemesterStartDate(term.academicYear, term.semesterCode);
  const courseConfig = {
    semesterTotalWeeks: 20,
    firstDayOfWeek: 1
  };
  if (startDate) {
    courseConfig.semesterStartDate = startDate;
    console.log("成功获取到开学日期:", startDate);
  } else {
    console.log("未获取到开学日期，将由用户手动在App设置。");
  }

  try {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));
  } catch (error) {
    console.error("保存课表配置失败:", error);
  }

  // 7. 提示完成
  const dateTip = startDate ? `\n开学日期已自动设定为: ${startDate}` : "\n开学日期未自动获取，请在App「课表设置」中核对。";
  await window.shiguangBridgePromise.showAlert(
    "导入成功",
    `已成功导入 ${courses.length} 门课程！\n作息已设为：${chosenSchedule.name}${dateTip}`,
    "完成"
  );

  window.shiguangBridge.showToast(`导入成功，共导入 ${courses.length} 门课程！`);
  window.shiguangBridge.notifyTaskCompletion();
}

// 运行导入
runImportFlow();
