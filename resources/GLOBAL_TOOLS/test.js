class CourseModel {
  name = ""; // 课程名称 (String)
  teacher = ""; // 教师姓名 (String)
  position = ""; // 上课地点 (String)
  day = 0; //星期几 (Int, 1=周一, 7=周日)
  startSection = 0; // 开始节次 (Int, 如果 isCustomTime 为 false 或未提供，则必填)
  endSection = 0; // 结束节次 (Int, 如果 isCustomTime 为 false 或未提供，则必填)
  weeks = [0]; // 上课周数 (Int Array, 必须是数字数组，例如 [1, 3, 5, 7])
  isCustomTime = false; // 是否使用自定义时间 (Boolean, 可选，默认为 false。如果为 true，则 customStartTime 和 customEndTime 必填；如果为 false 或未提供，则 startSection 和 endSection 必填)
  customStartTime = ""; // 自定义开始时间 (String, 格式 HH:mm, 如果 isCustomTime 为 true 则必填)
  customEndTime = ""; // 自定义结束时间 (String, 格式 HH:mm, 如果 isCustomTime 为 true 则必填)
  constructor(
    name, // 课程名称 (String)
    teacher, // 教师姓名 (String)
    position, // 上课地点 (String)
    day, // 星期几 (Int, 1=周一,7=周日)
    startSection, // 开始节次 (Int)
    endSection, // 结束节次 (Int)
    weeks = [], // 上课周数 (Int Array)
    isCustomTime = false, // 是否自定义时间 (Boolean，默认false)
    customStartTime = "", // 自定义开始时间 (可选)
    customEndTime = "", // 自定义结束时间 (可选)
  ) {
    // 1. 基础字段赋值（必选参数）
    this.name = name;
    this.teacher = teacher;
    this.position = position;
    this.day = day;
    this.startSection = startSection;
    this.endSection = endSection;
    this.weeks = weeks;
    this.isCustomTime = isCustomTime;
    this.customStartTime = customStartTime;
    this.customEndTime = customEndTime;
  }
}
class CustomTimeModel {
  number = 0;
  startTime = ""; // 开始时间 (String, 格式 HH:mm)
  endTime = ""; // 结束时间 (String, 格式 HH:mm)
  constructor(num, start, end) {
    this.number = num;
    this.startTime = start;
    this.endTime = end;
  }
}

function checkLoginEnvironment() {
  const currentUrl = window.location.href;
  const loginUrl =
    "https://sso.ujn.edu.cn/tpass/login?service=http%3A%2F%2Fjwgl.ujn.edu.cn%2Fsso%2Fdriotlogin";
  if (currentUrl === loginUrl) {
    AndroidBridge.showToast("请先登录再导入");
    return false;
  } else {
    return true;
  }
}

//解析周数据
function parseWeekText(text) {
  if (!text) return [];
  text = text.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "").trim();

  const allWeeks = new Set();
  const noJie = text.replace(/\(\d+-\d+节\)/g, " ");

  const rangePattern = /(\d+)-(\d+)周(?:\((单|双)\))?/g;
  const singlePattern = /(\d+)周(?:\((单|双)\))?/g;

  let match;
  while ((match = rangePattern.exec(noJie)) !== null) {
    const [, start, end, type] = match;
    for (let w = parseInt(start, 10); w <= parseInt(end, 10); w++) {
      if (
        !type ||
        (type === "单" && w % 2 === 1) ||
        (type === "双" && w % 2 === 0)
      ) {
        allWeeks.add(w);
      }
    }
  }

  const processedRanges = [];
  rangePattern.lastIndex = 0;
  while ((match = rangePattern.exec(noJie)) !== null) {
    processedRanges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  singlePattern.lastIndex = 0;
  while ((match = singlePattern.exec(noJie)) !== null) {
    const weekNum = parseInt(match[1], 10);
    const type = match[2];

    // 检查这个匹配是否已经被范围正则匹配过了（简单判断：如果包含"-"就跳过）
    const matchStr = match[0];
    if (matchStr.includes("-")) continue;

    if (
      !type ||
      (type === "单" && weekNum % 2 === 1) ||
      (type === "双" && weekNum % 2 === 0)
    ) {
      allWeeks.add(weekNum);
    }
  }

  return [...allWeeks].sort((a, b) => a - b);
}
function offsetColByRow(row) {
  row = row - 2;
  if (row % 4 == 0) {
    return 0;
  }
  if (row % 4 == 2) {
    return 1;
  }
}
function analyzeCourseModel(item) {
  let td = item.closest("td");
  let elements = item.querySelectorAll("p");
  if (!td) {
    console.error("找不到单元格");
  }
  let tr = td.parentElement;
  let site = {
    row: tr.rowIndex, //第几行
    rowSpan: td.rowSpan || 1, //跨几行
    col: td.cellIndex, //第几列
    colSpan: td.colSpan || 1, //跨几列
    cell: td, //本身
  };
  let currentItem = item.querySelector(".title");
  let name = currentItem.textContent;
  let teacher = elements[2].lastElementChild.innerText;
  let position = elements[1].lastElementChild.innerText;
  let weeks = parseWeekText(elements[0].lastElementChild.innerText);
  return new CourseModel(
    name.replace(/[■☆★◆]/g, ""),
    teacher.trim(),
    position.trim(),
    site.col - 1 + offsetColByRow(site.row),
    site.row - 1,
    site.row + site.rowSpan - 2,
    [...weeks],
  );
}

async function saveCourses() {
  const elements = document.querySelectorAll(
    "#innerContainer #table1 div.timetable_con",
  );
  let courseModels = [];
  elements.forEach((item) => {
    let course = analyzeCourseModel(item);
    courseModels.push({ ...course });
  });
  console.log(courseModels);
  window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courseModels));
}

async function importPresetTimeSlots() {
  console.log("正在准备预设时间段数据...");
  const presetTimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:00", endTime: "09:45" },
    { number: 3, startTime: "10:05", endTime: "10:50" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:25", endTime: "17:10" },
    { number: 8, startTime: "17:15", endTime: "18:00" },
    { number: 9, startTime: "18:45", endTime: "19:30" },
    { number: 10, startTime: "19:35", endTime: "20:20" },
    { number: 11, startTime: "20:25", endTime: "21:10" },
  ];
  try {
    console.log("正在尝试导入预设时间段...");
    const result = await window.AndroidBridgePromise.savePresetTimeSlots(
      JSON.stringify(presetTimeSlots),
    );
    if (result === true) {
      console.log("预设时间段导入成功！");
      window.AndroidBridge.showToast("测试时间段导入成功！");
      return true;
    } else {
      console.log("预设时间段导入未成功，结果：" + result);
      window.AndroidBridge.showToast("测试时间段导入失败，请查看日志。");
      return false;
    }
  } catch (error) {
    console.error("导入时间段时发生错误:", error);
    window.AndroidBridge.showToast("导入时间段失败: " + error.message);
    return false;
  }
}

async function runImportFlow() {
  window.AndroidBridge.showToast("课程导入流程即将开始...");

  // 1. 公告和前置检查。
  if (!checkLoginEnvironment()) {
    return;
  }
  const confirmed = await window.AndroidBridgePromise.showAlert(
    "教务导入",
    "在‘个人课表’页面进行导入以确保数据导入成功。请仔细核对，本人课表比较规整，无法包含所有情况。",
    "确定",
  );
  if (!confirmed) return;
  // 6. 课程数据保存。
  const saveResult = await saveCourses();
  if (!saveResult) {
    // 保存课程数据失败，直接退出
    return;
  }
  const slots = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "08:55", endTime: "09:45" },
    { number: 3, startTime: "10:15", endTime: "11:05" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:50" },
    { number: 6, startTime: "14:55", endTime: "15:45" },
    { number: 7, startTime: "16:15", endTime: "17:05" },
    { number: 8, startTime: "17:10", endTime: "18:00" },
    { number: 9, startTime: "19:00", endTime: "19:50" },
    { number: 10, startTime: "19:55", endTime: "20:45" },
    { number: 11, startTime: "20:50", endTime: "21:45" },
  ];
  await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
  await importPresetTimeSlots();

  // 8. 流程**完全成功**，发送结束信号。
  AndroidBridge.showToast(`导入成功：共 ${courses.length} 门课程`);
  AndroidBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
