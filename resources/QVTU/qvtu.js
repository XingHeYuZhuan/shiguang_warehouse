// ============================================================
// 泉州职业技术大学（jw.qvtu.edu.cn/jsxsd，强智教务）
// 拾光课程表适配脚本
//
// 数据源：仅"学期理论课表"（xskb_list.do，整学期带周次区间）。
// App 只导入当前学期，不引入首页周课表等冗余数据源。
// 流程遵循官方开发文档约定：学期配置 → 课程 → 作息时间（可选，失败不阻止完成）；
// notifyTaskCompletion 只在流程成功后调用。
// 总周数取课程最大周次；开学日期教务接口无可靠来源，不提交（App 里可手动设置）。
// 出现问题请联系开发者或提交 PR 更改。
// ============================================================

// 整体包一层 IIFE：本脚本可能被反复注入同一页面（测试器每次点击都会
// 重新注入且不刷新页面），顶层 const/function 会与上一次注入冲突
// （Identifier has already been declared），也会覆盖教务页面自己的全局函数。
(function () {

// ================= 配置 =================

// 作息时间：来自教务"大节"时段，小节按"45 分钟上课 + 15 分钟休息"拆分。
// 注：站点里"第七大节(13,14小节) 12:00-13:59"与晚间节次时间重叠，
//     会被拾光"时间段不可重叠"校验拒绝，故不提供 13、14 节时间（当前无课程使用）。
const QVTU_TIME_SLOTS = [
  { number: 1, startTime: "08:10", endTime: "08:55" },
  { number: 2, startTime: "09:10", endTime: "09:55" },
  { number: 3, startTime: "10:10", endTime: "10:55" },
  { number: 4, startTime: "11:10", endTime: "11:55" },
  { number: 5, startTime: "14:10", endTime: "14:55" },
  { number: 6, startTime: "15:10", endTime: "15:55" },
  { number: 7, startTime: "16:10", endTime: "16:55" },
  { number: 8, startTime: "17:10", endTime: "17:55" },
  { number: 9, startTime: "19:10", endTime: "19:55" },
  { number: 10, startTime: "20:10", endTime: "20:55" },
  { number: 11, startTime: "21:10", endTime: "21:55" },
  { number: 12, startTime: "22:10", endTime: "22:55" }
];

// 教务系统地址与接口
const QVTU_ORIGIN_CHECK = /jw\.qvtu\.edu\.cn$/i; // 只在教务站点上运行
const QVTU_XSKB_URL = "/jsxsd/xskb/xskb_list.do"; // 学期理论课表（整学期，带周次区间）

const QVTU_REQUEST_TIMEOUT = 8000; // 单请求超时（毫秒）

// ================= 工具函数 =================

function toast(message) {
  window.shiguangBridge.showToast(message);
}

// 生命周期结束信号：只在流程成功后调用（官方约定）
function notifyDone() {
  window.shiguangBridge.notifyTaskCompletion();
}

// 带超时保护的 fetch
function fetchText(url, options, tag) {
  const p = fetch(url, options || { method: "GET", credentials: "include" }).then(r => r.text());
  if (typeof setTimeout !== "function") return p; // 无定时器环境跳过（浏览器始终可用）
  return Promise.race([p, new Promise((_, reject) => {
    setTimeout(() => reject(new Error("请求超时：" + tag)), QVTU_REQUEST_TIMEOUT);
  })]);
}

// 只认可解析得了的课表（登录页/错误页不含这些标记）。
// xskb_list.do 的格子用 class="kbcontent"，其他课表视图可能用 class="kb_table"，两者都认。
function hasCourse(text) {
  return /课程名称：|kbcontent|kb_table/.test(String(text || ""));
}

// ================= 核心解析逻辑 =================

// 本站课表单元格式：
// <p title='课程学分：2<br/>课程名称：大学英语3（25工B4班）<br/>上课时间：第3周 星期一 [01-02]节<br/>上课地点：B216教室'>
function parsePTitle(html) {
  const merged = {};
  const re = /<p\b[^>]*title\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = m[1] != null ? m[1] : m[2];
    if (!title || !/课程名称：|上课时间：/.test(title)) continue;

    const lines = title.split(/<br\s*\/?\s*>/i).map(s => s.trim()).filter(Boolean);
    let name = "", timeStr = "", position = "", teacher = "";
    for (const line of lines) {
      if (/^课程名称[:：]/.test(line)) name = line.replace(/^课程名称[:：]/, "");
      else if (/^上课时间[:：]/.test(line)) timeStr = line.replace(/^上课时间[:：]/, "");
      else if (/^上课地点[:：]/.test(line)) position = line.replace(/^上课地点[:：]/, "");
      else if (/^(?:授课|任课)?教师[:：]/.test(line)) teacher = line.replace(/^(?:授课|任课)?教师[:：]/, "");
    }
    if (!name || !timeStr) continue;

    const star = timeStr.indexOf("星期");
    const weeks = parseWeeks(star >= 0 ? timeStr.slice(0, star) : timeStr);
    const day = dayFrom(star >= 0 ? timeStr.slice(star) : "");
    const sections = sectionsFrom(star >= 0 ? timeStr.slice(star) : timeStr);
    if (!weeks.length || !day || !sections.length) continue;

    // 同名同天同节次同地点 → 合并周次
    const key = [name.trim(), day, sections.join("-"), position.trim()].join("|");
    if (!merged[key]) {
      merged[key] = { name: name.trim(), teacher: teacher.trim(), position: position.trim(), day, weeks, sections };
    } else {
      for (const w of weeks) if (!merged[key].weeks.includes(w)) merged[key].weeks.push(w);
      merged[key].weeks.sort((a, b) => a - b);
    }
  }
  return Object.values(merged);
}

// "第3周"、"第1-16周"、"第1,3,5-8周"、"第1-15周(单周)" → [3] / [1..16] / 奇数周…
function parseWeeks(text) {
  let t = String(text || "").replace(/\s/g, "");
  const parity = t.indexOf("单周") >= 0 ? 1 : t.indexOf("双周") >= 0 ? 2 : 0;
  t = t.replace(/[（(][^）)]*[）)]/g, "");
  const set = {};
  const rangeRe = /(\d+)\s*[-–—~]\s*(\d+)/g;
  let m;
  while ((m = rangeRe.exec(t)) !== null) {
    for (let w = Math.min(+m[1], +m[2]); w <= Math.max(+m[1], +m[2]); w++) set[w] = 1;
  }
  for (const s of t.replace(rangeRe, " ").match(/\d+/g) || []) set[+s] = 1;
  const weeks = [];
  for (const k in set) {
    const n = +k;
    if (n >= 1 && n <= 30 && !(parity === 1 && n % 2 === 0) && !(parity === 2 && n % 2 === 1)) weeks.push(n);
  }
  return weeks.sort((a, b) => a - b);
}

// "[01-02]节"、"第1-2节"、"01,02节" → [1, 2]
function sectionsFrom(text) {
  const t = String(text || "").replace(/\s/g, "");
  let m = t.match(/\[\s*(\d+)\s*[-–,，]\s*(\d+)\s*\]/) || t.match(/(?:第)?(\d+)\s*[-–]\s*(\d+)\s*节/);
  if (m) {
    const arr = [];
    for (let w = Math.min(+m[1], +m[2]); w <= Math.max(+m[1], +m[2]); w++) arr.push(w);
    return arr;
  }
  m = t.match(/(\d+)\s*[，,]\s*(\d+)/);
  if (m) return [+m[1], +m[2]];
  m = t.match(/(?:第|\[)?(\d{1,2})(?:节|\])?/);
  return m && +m[1] >= 1 && +m[1] <= 14 ? [+m[1]] : [];
}

// 星期一/二/…/日 → 1..7
function dayFrom(text) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const m = String(text || "").match(/星期\s*([一二三四五六日天])/);
  return m ? map[m[1]] : 0;
}

// 把解析结果合并进总表
function mergeInto(merged, course) {
  const key = [course.name, course.day, course.sections.join("-"), course.position].join("|");
  if (!merged[key]) {
    merged[key] = course;
  } else {
    for (const w of course.weeks) if (!merged[key].weeks.includes(w)) merged[key].weeks.push(w);
    merged[key].weeks.sort((a, b) => a - b);
  }
}

// ================= 数据抓取 =================

// 抓取学期课表页（失败重试一次；门户切换页面时站点脚本会中断进行中的请求）
async function fetchXskbPage() {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchText(location.origin + QVTU_XSKB_URL, null, "学期课表页");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error("获取学期课表失败（" + (lastErr && lastErr.message ? lastErr.message : "网络错误") +
    "）。请在教务页面停留几秒后重新运行。");
}

// 抓取并解析"学期理论课表"。失败时区分"未登录"与"内容异常"，并留诊断信息。
async function fetchAndParseCourses() {
  if (!QVTU_ORIGIN_CHECK.test(location.hostname)) {
    throw new Error("请先在浏览器/WebView 打开教务网站（https://jw.qvtu.edu.cn/jsxsd）并登录，再运行。当前页面：" + location.href);
  }

  const html = await fetchXskbPage();
  if (!hasCourse(html)) {
    if (/用户登录|请登录|loginForm|passwd/i.test(String(html))) {
      throw new Error("教务会话已过期或尚未登录（接口返回登录页）。请重新登录教务系统后运行。");
    }
    console.warn("[泉州职业技术大学适配器] 学期课表页返回了意外内容（前 300 字符）：",
      String(html || "").replace(/\s+/g, " ").slice(0, 300));
    throw new Error("学期课表页返回了无法识别的内容，请按 F12 打开控制台，把警告信息发给开发者核对。");
  }

  const merged = {};
  for (const c of parsePTitle(html)) mergeInto(merged, c);

  const courses = Object.values(merged).map(c => ({
    name: c.name,
    teacher: c.teacher || "",
    position: c.position || "",
    day: c.day,
    weeks: c.weeks,
    startSection: Math.min(...c.sections),
    endSection: Math.max(...c.sections)
  }));
  if (!courses.length) {
    throw new Error("教务页面里没有解析到课程。请确认当前学期已有排课，或把错误信息发给我核对。");
  }

  // 总周数取课程最大周次
  let total = 0;
  for (const c of courses) {
    for (const w of c.weeks) if (w > total) total = w;
  }
  return { courses, total };
}

// ================= 保存步骤（顺序参照官方开发文档） =================

// 保存学期配置（总周数来自课程最大周次；开学日期教务接口无可靠来源，不提交，App 里可手动设置）
// defaultClassDuration/defaultBreakDuration 与作息表一致（45 分钟一节、小节间休息 15 分钟）
async function saveCourseConfig(total) {
  try {
    const config = {
      firstDayOfWeek: 1,
      defaultClassDuration: 45,
      defaultBreakDuration: 15,
      semesterTotalWeeks: total > 0 ? total : 20
    };
    const ok = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    if (!ok) { toast("学期配置保存失败。"); return false; }
    return true;
  } catch (e) {
    toast("学期配置保存失败：" + e.message);
    return false;
  }
}

// 保存课程数据
async function saveCourses(courses) {
  try {
    const ok = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    if (!ok) { toast("课程数据保存失败。"); return false; }
    return true;
  } catch (e) {
    toast("课程数据保存失败：" + e.message);
    return false;
  }
}

// 保存作息时间表（官方文档：可选步骤，失败不阻止导入完成）
async function savePresetTimeSlots() {
  try {
    const ok = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(QVTU_TIME_SLOTS));
    if (!ok) toast("作息时间保存失败。");
    return !!ok;
  } catch (e) {
    toast("作息时间保存失败：" + e.message);
    return false;
  }
}

// ================= 流程编排 =================

// 1. 公告和前置检查
async function promptUserToStart() {
  return (await window.shiguangBridgePromise.showAlert(
    "提示",
    "请确保已成功登录泉州职业技术大学教务系统。是否开始导入？",
    "开始"
  )) === true;
}

/**
 * 编排整个课程导入流程（顺序与约定参照官方开发文档）。
 * 用户取消或关键步骤保存失败时立即结束；作息时间为可选步骤，失败不阻止完成；
 * notifyTaskCompletion 只在流程成功后调用（官方约定）。
 */
async function runImportFlow() {
  try {
    // 1. 公告和前置检查
    const confirmed = await promptUserToStart();
    if (!confirmed) {
      toast("已取消导入。");
      return;
    }

    // 2. 网络请求和数据解析
    toast("正在获取学期课表…");
    const { courses, total } = await fetchAndParseCourses();

    // 3. 保存学期配置
    if (!await saveCourseConfig(total)) return;

    // 4. 保存课程数据
    toast("正在保存 " + courses.length + " 条课程安排…");
    if (!await saveCourses(courses)) return;

    // 5. 导入作息时间表（可选步骤，失败不阻止导入完成）
    if (!await savePresetTimeSlots()) {
      toast("提示：作息时间未导入，课程已保存，可在 App 里手动设置或稍后重试。");
    }

    // 6. 流程成功，发送结束信号
    toast(`成功导入 ${courses.length} 条课程安排！共 ${total} 周。开学日期可在 App 里手动设置。`);
    notifyDone();
  } catch (error) {
    // 任何一步失败：记录并提示用户，与官方适配一致不向外抛出，也不发送完成信号
    console.error("[泉州职业技术大学适配器]", error);
    toast("导入失败：" + (error && error.message ? error.message : error));
  }
}

// 启动导入流程
runImportFlow();

})();
