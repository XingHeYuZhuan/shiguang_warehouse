// 西南大学教务适配脚本（维护者：小漫君）
// 适配说明：登录 i.swu.edu.cn 后进入教务系统课表页面执行导入；
// 脚本会自动套用西南大学的节次时间。

(() => {
  const DEFAULT_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:45' },
    { number: 4, startTime: '10:55', endTime: '11:40' },
    { number: 5, startTime: '12:10', endTime: '12:55' },
    { number: 6, startTime: '13:05', endTime: '13:50' },
    { number: 7, startTime: '14:00', endTime: '14:45' },
    { number: 8, startTime: '14:55', endTime: '15:40' },
    { number: 9, startTime: '15:50', endTime: '16:35' },
    { number: 10, startTime: '16:55', endTime: '17:40' },
    { number: 11, startTime: '17:50', endTime: '18:35' },
    { number: 12, startTime: '19:20', endTime: '20:05' },
    { number: 13, startTime: '20:15', endTime: '21:00' },
    { number: 14, startTime: '21:10', endTime: '21:55' },
  ];

  const toast = (message) => {
    if (window.shiguangBridge?.showToast) {
      window.shiguangBridge.showToast(message);
    } else {
      console.log(message);
    }
  };

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const parseWeeks = (text) => {
    const source = normalize(text);
    const weeks = new Set();
    const rangePattern = /(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*周?/g;
    let rangeMatch;
    while ((rangeMatch = rangePattern.exec(source)) !== null) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
        weeks.add(week);
      }
    }
    const singlePattern = /第?\s*(\d{1,2})\s*周/g;
    let singleMatch;
    while ((singleMatch = singlePattern.exec(source)) !== null) {
      weeks.add(Number(singleMatch[1]));
    }
    return [...weeks].filter((week) => week > 0).sort((a, b) => a - b);
  };

  const parseDay = (text) => {
    const source = normalize(text);
    const names = ['一', '二', '三', '四', '五', '六', '日'];
    for (let i = 0; i < names.length; i += 1) {
      if (source.includes(`星期${names[i]}`) || source.includes(`周${names[i]}`)) return i + 1;
    }
    const digit = source.match(/(?:星期|周)\s*([1-7])/);
    return digit ? Number(digit[1]) : 0;
  };

  const parseSections = (text) => {
    const source = normalize(text);
    const range = source.match(/第?\s*(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*节/);
    if (range) return [Number(range[1]), Number(range[2])];
    const single = source.match(/第?\s*(\d{1,2})\s*节/);
    if (single) return [Number(single[1]), Number(single[1])];
    return [0, 0];
  };

  const collectCandidateText = () => {
    const selectors = [
      '[class*="course"]',
      '[class*="kb"]',
      '[class*="timetable"]',
      '[class*="schedule"]',
      'td',
      '.el-table__row',
      'tr',
    ];
    const elements = new Set();
    selectors.forEach((selector) => document.querySelectorAll(selector).forEach((element) => elements.add(element)));
    return [...elements].map((element) => normalize(element.innerText || element.textContent)).filter((text) => text.length >= 8);
  };

  const parseCoursesFromDom = () => {
    const rows = collectCandidateText();
    const courses = [];
    rows.forEach((text) => {
      const day = parseDay(text);
      const [startSection, endSection] = parseSections(text);
      if (!day || !startSection) return;
      const parts = text.split(/[\n;；,，]/).map(normalize).filter(Boolean);
      const name = parts.find((part) => !/(星期|周[一二三四五六日1-7]|节|校区|教室|教师|老师|周)/.test(part)) || parts[0] || '未命名课程';
      const room = parts.find((part) => /(楼|室|教室|校区|实验|馆)/.test(part)) || '';
      const teacher = parts.find((part) => /(老师|教师|讲师|教授)/.test(part))?.replace(/(老师|教师)[:：]?/, '') || '';
      courses.push({
        name,
        teacher,
        position: room,
        day,
        startSection,
        endSection,
        weeks: parseWeeks(text),
      });
    });
    const seen = new Set();
    return courses.filter((course) => {
      const key = `${course.name}-${course.day}-${course.startSection}-${course.endSection}-${course.position}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const readJsonFromPage = () => {
    const scripts = [...document.scripts].map((script) => script.textContent || '').join('\n');
    const matches = scripts.match(/\[[\s\S]{0,200000}?(?:course|kcmc|课程|teacher|jxcd|教室)[\s\S]{0,200000}?\]/gi) || [];
    for (const candidate of matches) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (_) {
      }
    }
    return [];
  };

  const parseCoursesFromJson = () => readJsonFromPage().map((item) => {
    const text = JSON.stringify(item);
    const day = Number(item.day || item.weekday || item.xq || item.xqj || parseDay(text));
    const start = Number(item.startSection || item.start || item.jc || item.ksjc || parseSections(text)[0]);
    const end = Number(item.endSection || item.end || item.jsjc || parseSections(text)[1] || start);
    return {
      name: item.name || item.courseName || item.kcmc || item.kcm || item['课程名称'] || '未命名课程',
      teacher: item.teacher || item.teacherName || item.xm || item.jsxm || item['教师'] || '',
      position: item.position || item.room || item.classroom || item.jxcd || item.cdmc || item['教室'] || '',
      day,
      startSection: start,
      endSection: end,
      weeks: Array.isArray(item.weeks) ? item.weeks : parseWeeks(text),
    };
  }).filter((course) => course.day && course.startSection);

  const main = async () => {
    if (!window.shiguangBridgePromise) {
      toast('当前环境不支持导入桥接，请在拾光课表 App 内执行。');
      return;
    }
    const courses = [...parseCoursesFromJson(), ...parseCoursesFromDom()];
    if (!courses.length) {
      toast('未能从当前页面识别课程表。请先完成登录并进入西南大学教务课表页面，再执行导入脚本。');
      return;
    }
    const totalWeeks = Math.max(20, ...courses.flatMap((course) => course.weeks || [0]));
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterStartDate: null,
      semesterTotalWeeks: totalWeeks,
    }));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(DEFAULT_TIME_SLOTS));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    window.shiguangBridge.notifyTaskCompletion();
  };

  main().catch((error) => {
    console.error(error);
    toast(`西南大学课表导入失败：${error.message || error}`);
  });
})();
