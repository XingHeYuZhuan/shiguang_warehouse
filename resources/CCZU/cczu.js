/**
 * 常州大学 (CCZU) 课表适配器
 * 系统: .NET ASPX 自研教务
 * 课表页面: /web_jxrw/cx_kb_xsgrkb.aspx (iframe)
 * 数据位置: HTML 表格 #GVxkkb
 */
(function () {
  "use strict";

  function parseWeeks(raw) {
    if (!raw || raw === "/") return [];
    const cleaned = raw.replace(/\/+$/, "").trim();
    if (!cleaned) return [];
    const weeks = [];
    const parts = cleaned.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const rangeMatch = trimmed.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let w = start; w <= end; w++) weeks.push(w);
      } else {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num)) weeks.push(num);
      }
    }
    return [...new Set(weeks)];
  }

  function parseSection(raw) {
    if (!raw) return null;
    const n = parseInt(raw.trim(), 10);
    return isNaN(n) ? null : n;
  }

  function parseCourseCell(cellText) {
    if (!cellText || cellText === "\u00a0" || cellText.trim() === "") return [];
    const courses = [];
    const entries = cellText.split("/");
    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const match = trimmed.match(
        /^(.+?)\s+([A-Za-z0-9\u4e00-\u9fff]+(?:机房|阶)?)\s+([\d,\-~]+(?:,\d+[\-~]\d+)*)\s*,?\s*(.*)$/
      );
      if (match) {
        const courseName = match[1].trim();
        const room = match[2].trim();
        const weeksRaw = match[3].trim();
        const teacher = match[4].trim().replace(/\/+$/, "").trim() || "";
        courses.push({
          courseName,
          room,
          teacher,
          weeksRaw,
          weeks: parseWeeks(weeksRaw),
        });
      } else {
        const simpleMatch = trimmed.match(/^(.+?)\s+([A-Za-z0-9\u4e00-\u9fff]+(?:机房|阶)?)\s*/);
        if (simpleMatch) {
          courses.push({
            courseName: simpleMatch[1].trim(),
            room: simpleMatch[2].trim(),
            teacher: "",
            weeksRaw: "",
            weeks: [],
          });
        }
      }
    }
    return courses;
  }

  function extractTeacherMap(doc) {
    const map = {};
    const target = doc || document;
    const table = target.getElementById("GVxkall");
    if (!table) return map;
    const rows = table.querySelectorAll("tr.dg1-item");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 6) {
        const name = cells[1]?.textContent?.trim();
        const teacher = cells[5]?.textContent?.trim();
        if (name && teacher && teacher !== "\u00a0") {
          map[name] = teacher;
        }
      }
    }
    return map;
  }

  function parseSemester(raw) {
    if (!raw) return null;
    const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d)$/);
    if (!m) return null;
    const startYear = 2000 + parseInt(m[1], 10);
    const endYear = 2000 + parseInt(m[2], 10);
    const semester = parseInt(m[3], 10);
    return { startYear, endYear, semester };
  }

  function findTable() {
    let table = document.getElementById("GVxkkb");
    if (table) return { doc: document, table };

    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (!iframeDoc) continue;
        table = iframeDoc.getElementById("GVxkkb");
        if (table) return { doc: iframeDoc, table };

        const innerIframes = iframeDoc.querySelectorAll("iframe");
        for (const inner of innerIframes) {
          try {
            const innerDoc = inner.contentDocument || inner.contentWindow.document;
            if (!innerDoc) continue;
            table = innerDoc.getElementById("GVxkkb");
            if (table) return { doc: innerDoc, table };
          } catch (e) {}
        }
      } catch (e) {}
    }
    return null;
  }

  async function runImportFlow() {
    const result = findTable();
    if (!result) {
      window.shiguangBridge.showToast("找不到课表表格，请确保已进入课表页面");
      return;
    }
    const { doc, table } = result;

    const teacherMap = extractTeacherMap(doc);
    const courses = [];
    const rows = table.querySelectorAll("tr");

    const semesterSelect = doc.getElementById("DDxq");
    const semesterRaw = semesterSelect?.value || "";
    const semester = parseSemester(semesterRaw);

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll("td");
      if (cells.length < 8) continue;

      const section = parseSection(cells[0]?.textContent);
      if (section === null) continue;

      for (let day = 1; day <= 7; day++) {
        const cellText = cells[day]?.textContent?.trim() || "";
        if (!cellText || cellText === "\u00a0") continue;

        const parsed = parseCourseCell(cellText);
        for (const c of parsed) {
          const mergedTeacher = c.teacher || teacherMap[c.courseName] || "";
          courses.push({
            name: c.courseName,
            teacher: mergedTeacher,
            position: c.room,
            day: day,
            startSection: section,
            endSection: section + 1,
            weeks: c.weeks,
          });
        }
      }
    }

    if (courses.length === 0) {
      window.shiguangBridge.showToast("未找到课程数据");
      return;
    }

    try {
      await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
      window.shiguangBridge.showToast(`课程导入成功，共 ${courses.length} 门课程！`);
      window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
      window.shiguangBridge.showToast("课程保存失败: " + error.message);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runImportFlow);
  } else {
    runImportFlow();
  }
})();
