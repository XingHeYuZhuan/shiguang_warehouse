/**
 * 合肥工业大学 (HFUT) - Supwisdom EAMS5 课程表导入适配器
 *
 * 数据来源与 EAMS5 个人课表页面一致：
 *   1. /for-std/course-table/get-data
 *   2. /ws/schedule-table/datum
 *   3. /ws/schedule-table/timetable-layout
 *
 * 接口返回逐周排课记录，因此可以准确保留星期一至星期日、单双周、
 * 教师/教室按周变化和非标准上课时间。接口不可用时，仅对当前页面
 * 展示的学期启用 DOM 降级解析。
 */

(function (root, factory) {
  "use strict";

  const adapter = factory();
  if (typeof window === "undefined" && typeof module === "object" && module.exports) {
    module.exports = adapter;
  } else {
    root.runImportFlow = function () {
      return adapter.runImportFlow(root);
    };
    root.runImportFlow();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const EAMS5_CONTEXT_PATH = "/eams5-student";
  const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
  const WEEKDAY_NAMES = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "日": 7,
    "天": 7,
    "MONDAY": 1,
    "TUESDAY": 2,
    "WEDNESDAY": 3,
    "THURSDAY": 4,
    "FRIDAY": 5,
    "SATURDAY": 6,
    "SUNDAY": 7,
  };

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function cleanText(value) {
    if (value === null || value === undefined) return "";
    if (!["string", "number", "boolean", "bigint"].includes(typeof value)) return "";
    return String(value).replace(/\s+/g, " ").trim();
  }

  function firstText(values) {
    for (let index = 0; index < values.length; index += 1) {
      const text = cleanText(values[index]);
      if (text) return text;
    }
    return "";
  }

  function positiveInteger(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const text = cleanText(value);
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function uniqueSortedNumbers(values) {
    return Array.from(new Set(values.map(positiveInteger).filter(Boolean))).sort(function (a, b) {
      return a - b;
    });
  }

  function parseIsoDate(value) {
    const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? timestamp
      : null;
  }

  function weekdayFromDate(value) {
    const timestamp = parseIsoDate(value);
    if (timestamp === null) return null;
    const day = new Date(timestamp).getUTCDay();
    return day === 0 ? 7 : day;
  }

  function weekFromDate(value, semesterStartDate) {
    const timestamp = parseIsoDate(value);
    const startTimestamp = parseIsoDate(semesterStartDate);
    if (timestamp === null || startTimestamp === null || timestamp < startTimestamp) return null;
    return Math.floor((timestamp - startTimestamp) / (7 * DAY_MILLISECONDS)) + 1;
  }

  function normalizeWeekday(value, date) {
    const text = cleanText(value);
    const direct = WEEKDAY_NAMES[text.toUpperCase()];
    if (direct) return direct;

    const textMatch = text.match(/^(?:星期|周)([一二三四五六日天1-7])$/);
    if (textMatch && WEEKDAY_NAMES[textMatch[1]]) return WEEKDAY_NAMES[textMatch[1]];

    return weekdayFromDate(date);
  }

  function timeToMinutes(value) {
    if (value === null || value === undefined || value === "") return null;

    const text = cleanText(value);
    const colonMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
      const hour = Number(colonMatch[1]);
      const minute = Number(colonMatch[2]);
      return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
    }

    if (!/^\d{3,4}$/.test(text)) return null;
    const numeric = Number(text);
    const hour = Math.floor(numeric / 100);
    const minute = numeric % 100;
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
  }

  function formatMinutes(minutes) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return null;
    const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minute = String(minutes % 60).padStart(2, "0");
    return hour + ":" + minute;
  }

  function firstTimeMinutes(values) {
    for (let index = 0; index < values.length; index += 1) {
      const minutes = timeToMinutes(values[index]);
      if (minutes !== null) return minutes;
    }
    return null;
  }

  function normalizeCourseUnits(rawUnits) {
    return asArray(rawUnits)
      .map(function (unit, index) {
        const startMinutes = firstTimeMinutes([unit && unit.startTimeText, unit && unit.startTime]);
        const endMinutes = firstTimeMinutes([unit && unit.endTimeText, unit && unit.endTime]);
        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;

        return {
          number:
            positiveInteger(unit && unit.indexNo) ||
            positiveInteger(unit && unit.number) ||
            positiveInteger(unit && unit.index) ||
            index + 1,
          startMinutes: startMinutes,
          endMinutes: endMinutes,
          startTime: formatMinutes(startMinutes),
          endTime: formatMinutes(endMinutes),
        };
      })
      .filter(Boolean);
  }

  function resolveCourseSlot(schedule, units) {
    const startMinutes = firstTimeMinutes([schedule.startTimeText, schedule.startTime]);
    const endMinutes = firstTimeMinutes([schedule.endTimeText, schedule.endTime]);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;

    const startIndex = units.findIndex(function (unit) {
      return unit.startMinutes === startMinutes;
    });
    let endIndex = units.findIndex(function (unit) {
      return unit.endMinutes === endMinutes;
    });

    if (startIndex >= 0 && endIndex < startIndex) {
      const periods = positiveInteger(schedule.periods);
      if (periods && startIndex + periods - 1 < units.length) {
        endIndex = startIndex + periods - 1;
      }
    }

    if (startIndex >= 0 && endIndex >= startIndex) {
      return {
        isCustomTime: false,
        startSection: units[startIndex].number,
        endSection: units[endIndex].number,
      };
    }

    return {
      isCustomTime: true,
      customStartTime: formatMinutes(startMinutes),
      customEndTime: formatMinutes(endMinutes),
    };
  }

  function parseWeekText(value) {
    const text = cleanText(value).replace(/第|周/g, "");
    if (!text) return [];

    const weeks = [];
    const pieces = text.split(/[，,、;；]/);
    pieces.forEach(function (piece) {
      const part = piece.trim();
      let match = part.match(/(\d+)\s*[~～\-—至]\s*(\d+)/);
      if (match) {
        const start = Number(match[1]);
        const end = Number(match[2]);
        const oddOnly = /单/.test(part);
        const evenOnly = /双/.test(part);
        for (let week = start; week <= end; week += 1) {
          if ((!oddOnly || week % 2 === 1) && (!evenOnly || week % 2 === 0)) weeks.push(week);
        }
        return;
      }

      match = part.match(/\d+/g);
      if (match) weeks.push.apply(weeks, match.map(Number));
    });
    return uniqueSortedNumbers(weeks);
  }

  function scheduleWeeks(schedule, semesterStartDate) {
    const candidates = [schedule.weekIndexes, schedule.weekIndices, schedule.weekIndex];
    for (let index = 0; index < candidates.length; index += 1) {
      const raw = candidates[index];
      if (raw === null || raw === undefined || raw === "") continue;
      const weeks = Array.isArray(raw)
        ? uniqueSortedNumbers(raw)
        : /^\d+$/.test(cleanText(raw))
          ? uniqueSortedNumbers([raw])
          : parseWeekText(raw);
      if (weeks.length > 0) return weeks;
    }

    const derived = weekFromDate(schedule.date, semesterStartDate);
    return derived ? [derived] : [];
  }

  function teacherName(teacher) {
    if (!teacher || typeof teacher !== "object") return cleanText(teacher);
    return firstText([
      teacher.nameZh,
      teacher.name,
      teacher.personName,
      teacher.person && teacher.person.nameZh,
      teacher.person && teacher.person.name,
      teacher.teacher && teacher.teacher.nameZh,
      teacher.teacher && teacher.teacher.name,
    ]);
  }

  function lessonTeachers(lesson) {
    return Array.from(
      new Set(
        asArray(lesson && lesson.teacherAssignmentList)
          .map(function (teacher) {
            return teacherName(teacher);
          })
          .filter(Boolean)
      )
    ).join("、");
  }

  function scheduleTeacher(schedule, lesson) {
    return firstText([schedule.personName, schedule.teacherName]) || teacherName(schedule.teacher) || lessonTeachers(lesson);
  }

  function schedulePosition(schedule) {
    const room = schedule.room;
    if (room && typeof room === "object") {
      const roomName = firstText([room.nameZh, room.name]);
      const buildingName = firstText([room.building && room.building.nameZh, room.building && room.building.name]);
      const campus = firstText([
        room.building && room.building.campus && room.building.campus.nameZh,
        room.building && room.building.campus && room.building.campus.name,
      ]);
      if (roomName) {
        return Array.from(new Set([campus, buildingName, roomName].filter(Boolean))).join(" ");
      }
    }
    const roomText = typeof room === "string" ? room : "";
    return firstText([schedule.customPlace, schedule.placeName, schedule.roomName, roomText]);
  }

  function flagValue(flags, lessonId) {
    if (!flags) return undefined;
    if (typeof flags.get === "function") {
      if (typeof flags.has === "function") {
        if (flags.has(lessonId)) return flags.get(lessonId);
        if (flags.has(String(lessonId))) return flags.get(String(lessonId));
        return undefined;
      }
      const direct = flags.get(lessonId);
      return direct === undefined ? flags.get(String(lessonId)) : direct;
    }
    return flags[lessonId] !== undefined ? flags[lessonId] : flags[String(lessonId)];
  }

  function isPublished(flags, lessonId) {
    if (!flags) return true;
    const value = flagValue(flags, lessonId);
    if (value === undefined || value === null || value === "") return false;
    if (typeof value === "object") {
      return firstText([value.flag, value.state, value.value]).toLowerCase() === "publish";
    }
    return cleanText(value).toLowerCase() === "publish";
  }

  function courseName(schedule, lesson) {
    return firstText([
      lesson && lesson.courseName,
      lesson && lesson.nameZh,
      lesson && lesson.name,
      schedule.courseName,
      schedule.lessonName,
    ]);
  }

  function slotSignature(slot) {
    return slot.isCustomTime
      ? ["custom", slot.customStartTime, slot.customEndTime]
      : ["section", slot.startSection, slot.endSection];
  }

  function courseStartMinutes(course, units) {
    if (course.isCustomTime) {
      const customStart = timeToMinutes(course.customStartTime);
      return customStart === null ? Number.POSITIVE_INFINITY : customStart;
    }
    const unit = units.find(function (candidate) {
      return candidate.number === course.startSection;
    });
    return unit ? unit.startMinutes : Number.POSITIVE_INFINITY;
  }

  function convertScheduleData(options) {
    const lessons = asArray(options.lessonList);
    const schedules = asArray(options.scheduleList);
    const units = normalizeCourseUnits(options.courseUnits);
    const lessonMap = new Map();
    lessons.forEach(function (lesson) {
      if (lesson && lesson.id !== undefined && lesson.id !== null) lessonMap.set(String(lesson.id), lesson);
    });

    const baseGroups = new Map();
    schedules.forEach(function (schedule) {
      if (!schedule || !isPublished(options.publishedFlags, schedule.lessonId)) return;

      const lesson = lessonMap.get(String(schedule.lessonId)) || {};
      const name = courseName(schedule, lesson);
      const day = normalizeWeekday(schedule.weekday, schedule.date);
      const weeks = scheduleWeeks(schedule, options.semesterStartDate);
      const slot = resolveCourseSlot(schedule, units);
      if (!name || !day || day < 1 || day > 7 || weeks.length === 0 || !slot) return;

      const baseKey = JSON.stringify([
        String(schedule.lessonId === undefined || schedule.lessonId === null ? name : schedule.lessonId),
        String(schedule.scheduleGroupId === undefined ? "" : schedule.scheduleGroupId),
        day,
      ].concat(slotSignature(slot)));

      if (!baseGroups.has(baseKey)) {
        baseGroups.set(baseKey, {
          name: name,
          day: day,
          slot: slot,
          weekDetails: new Map(),
        });
      }

      const group = baseGroups.get(baseKey);
      const teacher = scheduleTeacher(schedule, lesson);
      const position = schedulePosition(schedule);
      weeks.forEach(function (week) {
        if (!group.weekDetails.has(week)) {
          group.weekDetails.set(week, { teachers: new Set(), positions: new Set() });
        }
        const detail = group.weekDetails.get(week);
        if (teacher) detail.teachers.add(teacher);
        if (position) detail.positions.add(position);
      });
    });

    const courses = [];
    baseGroups.forEach(function (group) {
      const detailGroups = new Map();
      group.weekDetails.forEach(function (detail, week) {
        const teacher = Array.from(detail.teachers).sort().join("、");
        const position = Array.from(detail.positions).sort().join("、");
        const detailKey = JSON.stringify([teacher, position]);
        if (!detailGroups.has(detailKey)) detailGroups.set(detailKey, { teacher: teacher, position: position, weeks: [] });
        detailGroups.get(detailKey).weeks.push(week);
      });

      detailGroups.forEach(function (detail) {
        const course = {
          name: group.name,
          teacher: detail.teacher,
          position: detail.position,
          day: group.day,
          weeks: uniqueSortedNumbers(detail.weeks),
        };
        if (group.slot.isCustomTime) {
          course.isCustomTime = true;
          course.customStartTime = group.slot.customStartTime;
          course.customEndTime = group.slot.customEndTime;
        } else {
          course.startSection = group.slot.startSection;
          course.endSection = group.slot.endSection;
        }
        courses.push(course);
      });
    });

    courses.sort(function (left, right) {
      const leftTime = courseStartMinutes(left, units);
      const rightTime = courseStartMinutes(right, units);
      return left.day - right.day || leftTime - rightTime || left.name.localeCompare(right.name, "zh-CN");
    });
    return courses;
  }

  function parseRenderedSections(value) {
    const text = cleanText(value);
    let match = text.match(/^从第\s*(\d+)\s*节开始[，,\s]*连\s*(\d+)\s*节$/);
    if (match) {
      const start = positiveInteger(match[1]);
      const count = positiveInteger(match[2]);
      return start && count ? { startSection: start, endSection: start + count - 1 } : null;
    }

    match = text.match(/^(?:第)?\s*(\d+)\s*[~～\-—至]\s*(\d+)\s*(?:节)?$/);
    if (match) {
      const start = positiveInteger(match[1]);
      const end = positiveInteger(match[2]);
      return start && end && end >= start ? { startSection: start, endSection: end } : null;
    }

    const sections = uniqueSortedNumbers(text.replace(/节/g, "").split(/[,，、\s]+/));
    return sections.length > 0
      ? { startSection: sections[0], endSection: sections[sections.length - 1] }
      : null;
  }

  function parseRenderedCardText(text, day) {
    const normalized = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(cleanText)
      .filter(Boolean);
    if (normalized.length < 2) return null;

    const name = normalized.shift();
    const details = normalized.join(" ");
    const match = details.match(/^(.*)\s*\(([^()]*)周\)\s*(?:星期|周)?[一二三四五六日天1-7]?\s*\(([^()]*)\)\s*$/);
    if (!match) return null;

    const sections = parseRenderedSections(match[3]);
    const weeks = parseWeekText(match[2]);
    if (!name || !sections || weeks.length === 0 || day < 1 || day > 7) return null;

    return {
      name: name,
      teacher: "",
      position: cleanText(match[1]),
      day: day,
      startSection: sections.startSection,
      endSection: sections.endSection,
      weeks: weeks,
    };
  }

  function hasClass(element, className) {
    return Boolean(element && element.classList && element.classList.contains(className));
  }

  function parseRenderedSchedule(documentObject) {
    if (!documentObject || typeof documentObject.querySelectorAll !== "function") return [];
    const columns = Array.from(
      documentObject.querySelectorAll(".course-table .time-table-body .columns.weekday") || []
    );
    const courses = [];
    columns.slice(0, 7).forEach(function (column, index) {
      const cards = Array.from(column.children || []).filter(function (child) {
        return hasClass(child, "card-view");
      });
      cards.forEach(function (card) {
        const paragraph = card.querySelector && card.querySelector(".card-content p");
        const course = parseRenderedCardText(paragraph && (paragraph.innerText || paragraph.textContent), index + 1);
        if (course) courses.push(course);
      });
    });
    return courses;
  }

  function renderedTimeSlots(documentObject) {
    if (!documentObject || typeof documentObject.querySelectorAll !== "function") return [];
    const firstColumn = Array.from(
      documentObject.querySelectorAll(".course-table .time-table-body .columns.weekday") || []
    )[0];
    if (!firstColumn || typeof firstColumn.querySelectorAll !== "function") return [];
    const units = Array.from(firstColumn.querySelectorAll(".blank-unit") || []).map(function (element) {
      return {
        startTime: element.getAttribute("start-time"),
        endTime: element.getAttribute("end-time"),
      };
    });
    return normalizeCourseUnits(units);
  }

  function semesterOptions(rootObject) {
    const semesterData = asArray(rootObject.semesters);
    const select = rootObject.document && rootObject.document.querySelector
      ? rootObject.document.querySelector("#allSemesters")
      : null;

    const options = [];
    const optionIndexes = new Map();
    semesterData.forEach(function (semester) {
      const id = cleanText(semester && semester.id);
      if (!id || optionIndexes.has(id)) return;
      optionIndexes.set(id, options.length);
      options.push(Object.assign({}, semester, {
        id: id,
        label: firstText([semester.nameZh, semester.name, semester.nameEn, id]),
      }));
    });

    if (select && select.options) {
      Array.from(select.options).forEach(function (option) {
        const id = cleanText(option.value);
        if (!id) return;
        const label = firstText([option.textContent, option.innerText, id]);
        if (optionIndexes.has(id)) {
          const index = optionIndexes.get(id);
          options[index] = Object.assign({}, options[index], { label: label || options[index].label });
          return;
        }
        optionIndexes.set(id, options.length);
        options.push({ id: id, label: label });
      });
    }

    const selectedId = firstText([select && select.value, rootObject.currentSemester && rootObject.currentSemester.id]);
    const defaultIndex = Math.max(0, options.findIndex(function (semester) {
      return semester.id === selectedId;
    }));
    return { options: options, selectedId: selectedId, defaultIndex: defaultIndex };
  }

  function extractPageContext(rootObject) {
    const pathname = cleanText(rootObject.location && rootObject.location.pathname);
    const contextPath = cleanText(rootObject.CONTEXT_PATH) ||
      (pathname.includes(EAMS5_CONTEXT_PATH) ? EAMS5_CONTEXT_PATH : "");
    const pathStudentMatch = pathname.match(/\/course-table\/(?:info\/|semester\/\d+\/print\/)(\d+)/);
    const studentId = positiveInteger(rootObject.studentId) || positiveInteger(pathStudentMatch && pathStudentMatch[1]);
    const terms = semesterOptions(rootObject);

    if (contextPath !== EAMS5_CONTEXT_PATH || !studentId || terms.options.length === 0) {
      throw new Error("请先登录翱翔门户，并打开“个人课表”页面后再执行导入");
    }
    return {
      contextPath: contextPath,
      studentId: studentId,
      semesters: terms.options,
      selectedSemesterId: terms.selectedId,
      defaultSemesterIndex: terms.defaultIndex,
    };
  }

  function encodeQuery(params) {
    return Object.keys(params)
      .map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
      })
      .join("&");
  }

  async function requestJson(rootObject, url, init) {
    if (typeof rootObject.fetch !== "function") throw new Error("当前 WebView 不支持 Fetch API");
    const response = await rootObject.fetch(url, Object.assign({ credentials: "same-origin" }, init || {}));
    if (!response || response.ok === false) {
      throw new Error("教务接口请求失败（HTTP " + (response && response.status ? response.status : "未知") + "）");
    }

    let payload;
    if (typeof response.text === "function") {
      const text = await response.text();
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error("登录状态已失效，或教务接口返回了非 JSON 页面");
      }
    } else if (typeof response.json === "function") {
      payload = await response.json();
    }
    if (!payload || typeof payload !== "object") throw new Error("教务接口没有返回有效数据");
    return payload;
  }

  function responseBody(payload) {
    return payload && payload.result && typeof payload.result === "object" ? payload.result : payload;
  }

  async function fetchEams5Snapshot(rootObject, pageContext, semester) {
    const base = pageContext.contextPath;
    const metadataPayload = await requestJson(
      rootObject,
      base + "/for-std/course-table/get-data?" + encodeQuery({
        bizTypeId: 2,
        semesterId: semester.id,
        dataId: pageContext.studentId,
      }),
      { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } }
    );
    const metadata = responseBody(metadataPayload);
    const lessonIds = asArray(metadata.lessonIds);

    const datumPromise = lessonIds.length === 0
      ? Promise.resolve({ result: { lessonList: asArray(metadata.lessons), scheduleList: [] } })
      : requestJson(rootObject, base + "/ws/schedule-table/datum", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({
            lessonIds: lessonIds,
            studentId: pageContext.studentId,
            weekIndex: "",
          }),
        });

    let layoutUnavailable = false;
    const layoutPromise = metadata.timeTableLayoutId === null || metadata.timeTableLayoutId === undefined
      ? Promise.resolve({ result: { courseUnitList: [] } })
      : requestJson(rootObject, base + "/ws/schedule-table/timetable-layout", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ timeTableLayoutId: metadata.timeTableLayoutId }),
        }).catch(function () {
          layoutUnavailable = true;
          return { result: { courseUnitList: [] } };
        });

    const responses = await Promise.all([datumPromise, layoutPromise]);
    const datum = responseBody(responses[0]);
    const layout = responseBody(responses[1]);
    return {
      lessonList: asArray(datum.lessonList).length ? datum.lessonList : asArray(metadata.lessons),
      scheduleList: asArray(datum.scheduleList),
      courseUnits: asArray(layout.courseUnitList),
      weekIndices: asArray(metadata.weekIndices),
      publishedFlags: metadata.lessonId2Flag,
      layoutUnavailable: layoutUnavailable,
    };
  }

  function mostCommon(values, fallback) {
    const counts = new Map();
    values.filter(function (value) {
      return Number.isInteger(value) && value > 0;
    }).forEach(function (value) {
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    let result = fallback;
    let maxCount = -1;
    counts.forEach(function (count, value) {
      if (count > maxCount || (count === maxCount && value < result)) {
        result = value;
        maxCount = count;
      }
    });
    return result;
  }

  function buildCourseConfig(semester, snapshot, courses, units) {
    const allWeeks = asArray(snapshot.weekIndices).concat(
      courses.reduce(function (result, course) {
        return result.concat(course.weeks);
      }, [])
    );
    let totalWeeks = Math.max.apply(null, uniqueSortedNumbers(allWeeks).concat([0]));
    const startTimestamp = parseIsoDate(semester.startDate);
    const endTimestamp = parseIsoDate(semester.endDate);
    if (!totalWeeks && startTimestamp !== null && endTimestamp !== null && endTimestamp >= startTimestamp) {
      totalWeeks = Math.ceil((endTimestamp - startTimestamp + DAY_MILLISECONDS) / (7 * DAY_MILLISECONDS));
    }

    const durations = units.map(function (unit) {
      return unit.endMinutes - unit.startMinutes;
    });
    const breaks = units.slice(1).map(function (unit, index) {
      return unit.startMinutes - units[index].endMinutes;
    }).filter(function (minutes) {
      return minutes > 0 && minutes <= 60;
    });

    return {
      semesterStartDate: startTimestamp === null ? null : semester.startDate,
      semesterTotalWeeks: totalWeeks || 20,
      defaultClassDuration: mostCommon(durations, 45),
      defaultBreakDuration: mostCommon(breaks, 10),
      firstDayOfWeek: semester.weekStartOnSunday ? 7 : 1,
    };
  }

  async function runImportFlow(rootObject) {
    const promiseBridge = rootObject.shiguangBridgePromise;
    const bridge = rootObject.shiguangBridge;
    try {
      if (!promiseBridge || !bridge) throw new Error("拾光课程表 JS Bridge 尚未就绪");
      const pageContext = extractPageContext(rootObject);
      const labels = pageContext.semesters.map(function (semester) {
        return semester.label;
      });
      const selected = await promiseBridge.showSingleSelection(
        "选择学期",
        JSON.stringify(labels),
        pageContext.defaultSemesterIndex
      );
      if (selected === null || selected === undefined || Number(selected) < 0) return { cancelled: true };

      const semester = pageContext.semesters[Number(selected)];
      if (!semester) throw new Error("选择的学期无效");
      bridge.showToast("正在读取 EAMS5 课表数据...");

      let snapshot;
      let courses;
      let units;
      let fallbackUsed = false;
      try {
        snapshot = await fetchEams5Snapshot(rootObject, pageContext, semester);
        units = normalizeCourseUnits(snapshot.courseUnits);
        if (units.length === 0 && semester.id === pageContext.selectedSemesterId) {
          units = renderedTimeSlots(rootObject.document);
        }
        courses = convertScheduleData({
          lessonList: snapshot.lessonList,
          scheduleList: snapshot.scheduleList,
          courseUnits: units,
          publishedFlags: snapshot.publishedFlags,
          semesterStartDate: semester.startDate,
        });
      } catch (apiError) {
        if (semester.id !== pageContext.selectedSemesterId) throw apiError;
        courses = parseRenderedSchedule(rootObject.document);
        units = renderedTimeSlots(rootObject.document);
        snapshot = { weekIndices: [] };
        fallbackUsed = courses.length > 0;
        if (!fallbackUsed) throw apiError;
      }

      if (courses.length === 0 && semester.id === pageContext.selectedSemesterId) {
        const renderedCourses = parseRenderedSchedule(rootObject.document);
        if (renderedCourses.length > 0) {
          courses = renderedCourses;
          if (units.length === 0) units = renderedTimeSlots(rootObject.document);
          fallbackUsed = true;
        }
      }

      if (courses.length === 0) {
        throw new Error("所选学期没有可导入的已发布课程");
      }

      await promiseBridge.saveImportedCourses(JSON.stringify(courses));
      const warnings = [];
      if (snapshot.layoutUnavailable) warnings.push("教务作息接口不可用，已按页面作息或实际时间导入");
      if (units.length > 0) {
        try {
          await promiseBridge.savePresetTimeSlots(JSON.stringify(units.map(function (unit) {
            return { number: unit.number, startTime: unit.startTime, endTime: unit.endTime };
          })));
        } catch (error) {
          warnings.push("作息时间保存失败");
        }
      }

      try {
        const config = buildCourseConfig(semester, snapshot, courses, units);
        await promiseBridge.saveCourseConfig(JSON.stringify(config));
      } catch (error) {
        warnings.push("学期配置保存失败");
      }

      if (fallbackUsed) warnings.push("接口不可用，已从当前页面导入（教师信息可能为空）");
      const weekendCount = courses.filter(function (course) {
        return course.day === 6 || course.day === 7;
      }).length;
      const warningText = warnings.length ? "\n\n注意：" + warnings.join("；") : "";
      await promiseBridge.showAlert(
        "导入完成",
        "已导入 " + courses.length + " 条课程安排" +
          (weekendCount ? "（含周末 " + weekendCount + " 条）" : "") + warningText,
        "好的"
      );
      bridge.showToast("课程导入成功");
      bridge.notifyTaskCompletion();
      return { success: true, courses: courses, fallbackUsed: fallbackUsed, warnings: warnings };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (bridge) bridge.showToast("导入失败：" + message);
      if (promiseBridge && promiseBridge.showAlert) {
        try {
          await promiseBridge.showAlert("导入失败", message, "知道了");
        } catch (_) {
          // 用户关闭错误弹窗不应掩盖原始错误。
        }
      }
      return { success: false, error: message };
    }
  }

  return {
    buildCourseConfig: buildCourseConfig,
    convertScheduleData: convertScheduleData,
    extractPageContext: extractPageContext,
    fetchEams5Snapshot: fetchEams5Snapshot,
    normalizeCourseUnits: normalizeCourseUnits,
    parseRenderedCardText: parseRenderedCardText,
    parseRenderedSchedule: parseRenderedSchedule,
    parseWeekText: parseWeekText,
    runImportFlow: runImportFlow,
    timeToMinutes: timeToMinutes,
  };
});
