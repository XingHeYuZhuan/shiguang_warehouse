/**
 *
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
async function importTimeSlots() {
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
  return new Promise((resolve, reject) => {
    try {
      window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
      resolve(true);
    } catch (e) {
      reject(e);
      console.log("时间导入失败");
    }
  })
    .then(() => {
      AndroidBridge.showToast("预设时间段导入成功！");
      return true;
    })
    .catch((e) => {
      console.error("时间段导入失败：", e);
      AndroidBridge.showToast("预设时间段导入失败！"); // 修复错误提示文案
      return false;
    });
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

  console.log("处理前:", JSON.stringify(text));

  // 不用 split 了，直接全局匹配周数段
  const allWeeks = new Set();
  const pattern = /(\d+)-(\d+)周(?:\((单|双)\))?/g;
  let match;

  // 先去掉节信息（如果有的话）
  const noJie = text.replace(/\(\d+-\d+节\)/g, " ");

  while ((match = pattern.exec(noJie)) !== null) {
    const [, start, end, type] = match;
    console.log("匹配:", start, end, type);
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

  return [...allWeeks].sort((a, b) => a - b);
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
    colSpan: td.colSpan, //跨几列
    cell: td, //本身
  };
  let currentItem = item.querySelector(".title");
  let name = currentItem.textContent;
  let teacher = elements[2].lastElementChild.innerText;
  let position = elements[1].lastElementChild.innerText;
  let weeks = parseWeekText(elements[0].lastElementChild.innerText);
  console.log(weeks);
  return new CourseModel(
    name,
    teacher,
    position,
    site.col - 1,
    site.row - 1,
    site.row + site.rowSpan - 2,
    [...weeks],
  );
}

async function saveCourses() {
  const elements = document.querySelectorAll(
    "#innerContainer #table1 div.timetable_con",
  );
  console.log(elements.length);
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
  await importTimeSlots();

  // 8. 流程**完全成功**，发送结束信号。
  AndroidBridge.showToast(`导入成功：共 ${courses.length} 门课程`);
  AndroidBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
