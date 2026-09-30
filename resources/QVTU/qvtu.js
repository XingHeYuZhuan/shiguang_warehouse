// ============================================================
// 泉州职业技术大学（jw.qvtu.edu.cn/jsxsd，强智教务）
// 拾光课程表适配脚本
//
// 参照拾光官方开发文档（sgschedule.jursin.top/guide/developer/school-adaptation）
// 与官方仓库适配编写：保存顺序为 学期配置 → 课程 → 作息时间（可选，失败不阻止完成）；
// notifyTaskCompletion 只在流程成功后调用。
// 无学期专属常量：开学日期、总周数在运行时从教务接口自动推算，
// 任何学期直接可用；作息时间为学校级配置。
// 出现问题请联系开发者或提交 PR 更改。
// ============================================================

// 整体包一层 IIFE：本脚本会被反复注入同一页面（测试器每次点击都会
// 重新注入且不刷新页面），顶层 const/function 会与上一次注入冲突
// （Identifier has already been declared），也会覆盖教务页面自己的全局函数。
(function () {

// ================= 配置 =================

// 作息时间：来自教务首页课表的"大节"时段，小节按"45 分钟上课 + 15 分钟休息"拆分。
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
const QVTU_LOADKB_URL = "/jsxsd/framework/main_index_loadkb.jsp"; // 首页周课表接口（POST rq=日期）
const QVTU_MAIN_NEW_URL = "/jsxsd/framework/xsMain_new.jsp?t1=1"; // 首页框架页（提取 sjmsValue）

const QVTU_REQUEST_TIMEOUT = 8000; // 单请求超时（毫秒）
const QVTU_TOTAL_DEADLINE = 40000; // 抓取总时限（毫秒），须小于运行器 60 秒上限
const QVTU_WAVE_SIZE = 6; // 并行请求批大小

// ================= 工具函数 =================

function toast(message) {
  window.shiguangBridge.showToast(message);
}

// 生命周期结束信号：只在全部数据保存成功后调用（官方约定）
function notifyDone() {
  window.shiguangBridge.notifyTaskCompletion();
}

// 时间源（个别环境禁用 Date.now，逐级降级）
function now() {
  try {
    return Date.now();
  } catch (e) { /* 忽略 */ }
  try {
    return new Date().getTime();
  } catch (e) { /* 忽略 */ }
  return 0; // 拿不到时间时超时保护自动失效，不影响正常导入
}

// 今天的日期（YYYY-MM-DD）；调试可设 window.QVTU_TODAY_OVERRIDE = "2026-09-23" 模拟指定日期
function todayStr() {
  try {
    if (window.QVTU_TODAY_OVERRIDE) return String(window.QVTU_TODAY_OVERRIDE);
  } catch (e) { /* 忽略 */ }
  const d = new Date();
  const mo = d.getMonth() + 1, da = d.getDate();
  return d.getFullYear() + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (da < 10 ? "0" + da : da);
}

// 日期加减（UTC 计算，避免时区偏移）
function addDays(dateStr, days) {
  const p = String(dateStr).split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + days * 86400000);
  const mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  return d.getUTCFullYear() + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (da < 10 ? "0" + da : da);
}

// 某日期所在周的周一
function mondayOf(dateStr) {
  const p = String(dateStr).split("-");
  const wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); // 0=周日
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
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
// xskb_list.do 的格子用 class="kbcontent"，loadkb 周课表用 class="kb_table"，两者都认。
function hasCourse(text) {
  return /课程名称：|kbcontent|kb_table/.test(String(text || ""));
}

// 首页框架页缓存：getSjmsValue 抓到的页面同时作为周次标签的备用来源
let mainPageHtml = null;

// loadkb 接口的"时间模式"令牌：优先取页面已选值，否则从首页框架页解析
async function getSjmsValue() {
  try {
    const el = document.getElementById("sjms");
    if (el && el.value) return el.value;
  } catch (e) { /* 忽略 */ }
  try {
    const main = await fetchText(location.origin + QVTU_MAIN_NEW_URL, null, "首页框架页");
    mainPageHtml = main;
    const sel = main.match(/<select[^>]*name="sjms"[\s\S]*?<\/select>/i);
    if (!sel) return "";
    let first = "";
    for (const opt of sel[0].match(/<option[^>]*>/gi) || []) {
      const v = (opt.match(/value="([^"]*)"/i) || [])[1];
      if (v === undefined || v === "qb") continue;
      if (/selected/i.test(opt)) return v;
      if (!first) first = v;
    }
    return first;
  } catch (e) {
    return "";
  }
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

// 从课表页提取"第X周 / 共Y周"标签（兼容 span 包裹、"共Y周"等写法）
function parseWeekLabel(html) {
  const t = String(html || "");
  const m = t.match(/第(\d+)周<\/span>\s*\/\s*(\d+)周/) ||
            t.match(/第\s*(\d{1,2})\s*周(?:\s*<[^>]*>\s*)?\/\s*(?:共\s*)?(\d{1,2})\s*周/);
  if (!m || +m[1] < 1 || +m[1] > 30) return null;
  return { week: +m[1], total: +m[2] || 0 };
}

// 按日期取某周课表 HTML
async function fetchWeekHtml(rq, sjmsValue) {
  const html = await fetchText(location.origin + QVTU_LOADKB_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: "rq=" + encodeURIComponent(rq) + "&sjmsValue=" + encodeURIComponent(sjmsValue || "")
  }, rq);
  return hasCourse(html) ? html : null;
}

// 问首页接口"今天是第几周/共几周"——开学日期与总周数都从这里推算，任何学期通用。
// 门户页面切换时站点脚本会中断进行中的请求（PORTAL_NAVIGATED 等），故失败重试一次；
// 失败时区分"未登录"、"接口内容异常"、"缺少周次标签"，给出可定位的错误提示。
async function fetchCurrentWeek(sjmsValue) {
  const rq = todayStr();
  const postBody = {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: "rq=" + encodeURIComponent(rq) + "&sjmsValue=" + encodeURIComponent(sjmsValue || "")
  };

  let html = null, lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      html = await fetchText(location.origin + QVTU_LOADKB_URL, postBody, "当前周课表");
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    throw new Error("获取当前周课表失败（" + (lastErr && lastErr.message ? lastErr.message : "网络错误") +
      "）。请在教务页面停留几秒后重新运行。");
  }

  if (!hasCourse(html)) {
    if (/用户登录|请登录|loginForm|passwd/i.test(String(html))) {
      throw new Error("教务会话已过期或尚未登录（接口返回登录页）。请重新登录教务系统，停留在登录后的学生页面再运行。");
    }
    console.warn("[泉州职业技术大学适配器] 当前周接口返回了意外内容（前 300 字符）：",
      String(html || "").replace(/\s+/g, " ").slice(0, 300));
    throw new Error("当前周课表接口返回了无法识别的内容，请按 F12 打开控制台，把警告信息发给开发者核对。");
  }

  let label = parseWeekLabel(html);
  if (!label && mainPageHtml) label = parseWeekLabel(mainPageHtml); // 备用：首页框架页里的周次标签
  if (!label) {
    console.warn("[泉州职业技术大学适配器] 课表页里没找到周次标签（前 300 字符）：",
      String(html || "").replace(/\s+/g, " ").slice(0, 300));
    throw new Error("课表页里没有找到\"第X周/共Y周\"周次标签，站点结构可能已调整，请按 F12 把控制台警告发给开发者核对。");
  }
  return { rq, week: label.week, total: label.total };
}

// 抓取并解析：优先"学期理论课表"（整学期带周次区间）；
// 失败则以第 1 周周一为锚点按周并行扫描，周次以每周返回的"第X周"标签为准。
// 开学日期 = 某周标签反推第 1 周周一；总周数 = 课程最大周与标签总周数取大。
async function fetchAndParseCourses() {
  if (!QVTU_ORIGIN_CHECK.test(location.hostname)) {
    throw new Error("请先在浏览器打开教务网站（https://jw.qvtu.edu.cn/jsxsd）并登录，再运行。当前页面：" + location.href);
  }
  const deadline = now() + QVTU_TOTAL_DEADLINE;
  const sjmsValue = await getSjmsValue();

  // 当前周信息
  const cur = await fetchCurrentWeek(sjmsValue);
  const weekSamples = [{ rq: cur.rq, week: cur.week }];
  let labelTotal = cur.total;

  // 1) 直读"学期理论课表"
  const merged = {};
  let directOk = false;
  try {
    const page = await fetchText(location.origin + QVTU_XSKB_URL, null, "学期课表页");
    if (hasCourse(page)) {
      for (const c of parsePTitle(page)) mergeInto(merged, c);
      directOk = Object.keys(merged).length > 0;
    }
  } catch (e) { /* 落到按周扫描 */ }

  // 2) 回退：按周并行扫描
  if (!directOk) {
    const firstMonday = addDays(mondayOf(cur.rq), -(cur.week - 1) * 7);
    const expectTotal = cur.total > 0 ? cur.total : 25;
    const ks = [];
    for (let k = 0; k < expectTotal; k++) ks.push(k);

    const weeks = [], seen = {};
    let got = 0;
    for (let w0 = 0; w0 < ks.length; w0 += QVTU_WAVE_SIZE) {
      if (now() > deadline && got > 0) break; // 超时保护：已有部分周次就用
      const batch = await Promise.all(ks.slice(w0, w0 + QVTU_WAVE_SIZE).map(k =>
        fetchWeekHtml(addDays(firstMonday, k * 7), sjmsValue).catch(() => null)
      ));
      for (let b = 0; b < batch.length; b++) {
        const html = batch[b];
        if (!html) continue;
        const label = parseWeekLabel(html);
        const week = label ? label.week : ks[w0 + b] + 1;
        if (label && label.total > labelTotal) labelTotal = label.total;
        if (week >= 1 && week <= 30 && !seen[week]) {
          seen[week] = true;
          weeks.push({ week, html });
          weekSamples.push({ rq: addDays(firstMonday, ks[w0 + b] * 7), week });
          got++;
        }
      }
      if (got >= expectTotal) break;
    }
    if (!got) {
      throw new Error("未能获取课表数据（可能未登录或请求超时）。请先完成教务系统登录，停留在登录后的学生页面再重新运行。");
    }
    if (got < expectTotal) {
      toast("提示：仅获取到 " + got + " 个周次（网络超时），建议稍后重新运行补全。");
    }
    for (const { week, html } of weeks) {
      for (const c of parsePTitle(html)) {
        c.weeks = [week]; // 扫描模式下以该周真实周次为准
        mergeInto(merged, c);
      }
    }
  }

  // 3) 学期信息（全部来自接口标签，无写死常量）
  let start = null;
  for (const s of weekSamples) {
    if (s.week >= 1) {
      start = addDays(mondayOf(s.rq), -(s.week - 1) * 7);
      break;
    }
  }
  let total = 0;
  for (const key in merged) {
    for (const w of merged[key].weeks) if (w > total) total = w;
  }
  if (labelTotal > total) total = labelTotal;

  // 4) 转成拾光课程格式
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
  return { courses, start, total };
}

// ================= 保存步骤（顺序参照官方开发文档） =================

// 保存学期配置（开学日期/总周数来自接口推算，没拿到就不提交该字段，App 里可手动设置）
// defaultClassDuration/defaultBreakDuration 与作息表一致（45 分钟一节、小节间休息 15 分钟）
async function saveCourseConfig(start, total) {
  try {
    const config = {
      firstDayOfWeek: 1,
      defaultClassDuration: 45,
      defaultBreakDuration: 15
    };
    if (start) config.semesterStartDate = start;
    if (total) config.semesterTotalWeeks = total;
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
    const { courses, start, total } = await fetchAndParseCourses();

    // 3. 保存学期配置
    if (!await saveCourseConfig(start, total)) return;

    // 4. 保存课程数据
    toast("正在保存 " + courses.length + " 条课程安排…");
    if (!await saveCourses(courses)) return;

    // 5. 导入作息时间表（可选步骤，失败不阻止导入完成）
    if (!await savePresetTimeSlots()) {
      toast("提示：作息时间未导入，课程已保存，可在 App 里手动设置或稍后重试。");
    }

    // 6. 流程成功，发送结束信号
    toast(
      `成功导入 ${courses.length} 条课程安排！` +
      (start ? `学期 ${start} 起，共 ${total} 周。` : "开学日期未能自动获取，可在 App 里手动设置。")
    );
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
