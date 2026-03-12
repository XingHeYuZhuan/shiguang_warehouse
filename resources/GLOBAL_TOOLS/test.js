/**
 * 济南大学教务适配
 * Moyu
 */
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

async function importTime() {
  const slots = [
    new CustomTimeModel(1, "08:00", "08:50"),
    new CustomTimeModel(2, "08:55", "09:45"),
    new CustomTimeModel(3, "10:15", "11:05"),
    new CustomTimeModel(4, "11:10", "12:00"),
    new CustomTimeModel(5, "14:00", "14:50"),
    new CustomTimeModel(6, "14:55", "15:45"),
    new CustomTimeModel(7, "16:15", "17:05"),
    new CustomTimeModel(8, "17:10", "18:00"),
    new CustomTimeModel(9, "19:00", "19:50"),
    new CustomTimeModel(10, "19:55", "20:45"),
    new CustomTimeModel(11, "20:50", "21:45"),
  ];
  try {
    window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
    AndroidBridge.showToast("预设时间段导入成功！");
    return true;
  } catch (error) {
    AndroidBridge.showToast("预设时间段导入失败！");
    console.error("时间段导入失败：", error);
    return false;
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

function parseWeekText(text) {
  if (!text) return [];

  // 强制清理
  text = text.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "").trim();

  const allWeeks = new Set();

  // 先去掉节信息（如果有的话）
  const noJie = text.replace(/\(\d+-\d+节\)/g, " ");

  // 匹配两种格式：
  // 1. 范围格式：1-16周、1-16周(单)、1-16周(双)
  // 2. 单周格式：15周、8周(单)、8周(双)
  const rangePattern = /(\d+)-(\d+)周(?:\((单|双)\))?/g;
  const singlePattern = /(\d+)周(?:\((单|双)\))?/g;

  let match;

  // 处理范围格式 1-16周
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

  // 处理单周格式 15周（避免重复匹配范围中已经匹配过的）
  // 重置 lastIndex，并且需要排除已经匹配过的范围部分
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
  // 2. 获取用户输入参数。
  //   const academicYear = await getAcademicYear();
  //   if (academicYear === null) {
  //     AndroidBridge.showToast("导入已取消。");
  //     // 用户取消，直接退出
  //     return;
  //   }

  //   // 3. 获取学期。
  //   const semesterIndex = await selectSemester();
  //   if (semesterIndex === null) {
  //     AndroidBridge.showToast("导入已取消。");
  //     // 用户取消，直接退出
  //     return;
  //   }

  //   // 4. 网络请求和数据解析。
  //   const courses = await fetchAndParseCourses(academicYear, semesterIndex);
  //   if (courses === null) {
  //     // 请求失败或无数据，直接退出
  //     return;
  //   }

  //   // 5. [可选] 保存配置数据 (例如学期开始日期)
  //   const configSaveResult = await saveConfig(courses.config); // 假设 courses 对象中包含配置
  //   if (!configSaveResult) {
  //     // 保存配置失败，直接退出
  //     return;
  //   }
  // 6. 课程数据保存。
  const saveResult = await saveCourses();
  if (!saveResult) {
    // 保存课程数据失败，直接退出
    return;
  }

  // 7. [可选] 导入时间段。
  // 注意：即使时间段导入失败，通常也不阻止最终流程完成。
  await importTime();
 
  // 8. 流程**完全成功**，发送结束信号。
  AndroidBridge.showToast(`导入成功：共 ${courses.length} 门课程`);
  AndroidBridge.notifyTaskCompletion();
}

// 启动导入流程
// runImportFlow();
(async () => {
  try {
    await runImportFlow();
  } catch (error) {
    console.error("课表导入失败：", error);
    // 失败原因直接提示给用户，便于在移动端快速定位问题
    AndroidBridge.showToast(`导入失败：${error.message}`);
  }
})();