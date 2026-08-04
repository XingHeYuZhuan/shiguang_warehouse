// 重庆电力高等专科学校(cqepc.edu.cn)拾光课程表适配脚本
// 基于正方教务 V9 学生课表接口适配

const SCHOOL_HOST = 'jwxt.cqepc.edu.cn';
const TIMETABLE_PATH = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html';
const TIMETABLE_URL = `${TIMETABLE_PATH}?gnmkdm=N2151&layout=default`;
const COURSE_API = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
const TIME_API = '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

async function requestText(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'accept': '*/*',
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest'
    },
    body
  });
  if (!response.ok) throw new Error(`教务系统请求失败: ${response.status}`);
  return response.text();
}

function parseWeeks(description) {
  const weeks = new Set();
  const segments = String(description || '').replace(/\s+/g, '').split(/[,，]/);

  for (const segment of segments) {
    const match = segment.replace(/周|\(|\)|单|双/g, '').match(/(\d+)(?:-(\d+))?/);
    if (!match) continue;

    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let week = start; week <= end; week++) {
      if (segment.includes('单') && week % 2 === 0) continue;
      if (segment.includes('双') && week % 2 !== 0) continue;
      weeks.add(week);
    }
  }
  return Array.from(weeks).sort((left, right) => left - right);
}

function parseSections(value) {
  const sections = (String(value || '').match(/\d+/g) || []).map(Number);
  if (!sections.length) return null;
  return {
    startSection: sections[0],
    endSection: sections[sections.length - 1]
  };
}

function parseCourses(data) {
  if (!data || !Array.isArray(data.kbList)) return [];

  const uniqueCourses = new Map();
  for (const raw of data.kbList) {
    if (!raw || typeof raw !== 'object') continue;

    const name = String(raw.kcmc || '').trim();
    const day = Number(raw.xqj);
    const sections = parseSections(raw.jcs || raw.jc);
    const weeks = parseWeeks(raw.zcd);
    if (!name || day < 1 || day > 7 || !sections || !weeks.length) continue;

    const course = {
      name,
      teacher: String(raw.xm || '未知').trim() || '未知',
      position: String(raw.cdmc || raw.cdbh || '未排地点').trim() || '未排地点',
      day,
      startSection: sections.startSection,
      endSection: sections.endSection,
      weeks
    };
    const key = [
      course.name,
      course.teacher,
      course.position,
      course.day,
      course.startSection,
      course.endSection,
      course.weeks.join(',')
    ].join('|');
    if (!uniqueCourses.has(key)) uniqueCourses.set(key, course);
  }
  return Array.from(uniqueCourses.values());
}

function readCurrentTerm() {
  const academicYear = String(document.querySelector('#xnm')?.value || '').trim();
  const semester = String(document.querySelector('#xqm')?.value || '').trim();
  if (!academicYear || !semester) throw new Error('请先选择学年和学期');
  return { academicYear, semester };
}

function readSelectOptions(selectElement) {
  const options = [];
  let selectedIndex = 0;
  if (!selectElement) return { options, selectedIndex };

  const elements = selectElement.querySelectorAll('option');
  for (let index = 0; index < elements.length; index++) {
    const option = elements[index];
    const value = String(option.value || '').trim();
    if (!value) continue;
    if (option.selected) selectedIndex = options.length;
    options.push({ value, label: String(option.textContent || '').trim() || value });
  }
  return { options, selectedIndex };
}

async function selectTermFromTimetablePage() {
  const html = await requestText(`${window.location.origin}${TIMETABLE_URL}`);
  const page = new DOMParser().parseFromString(html, 'text/html');
  const years = readSelectOptions(page.querySelector('#xnm'));
  const semesters = readSelectOptions(page.querySelector('#xqm'));
  if (!years.options.length || !semesters.options.length) {
    throw new Error('教务系统未返回可选学年学期');
  }

  const yearIndex = await window.AndroidBridgePromise.showSingleSelection(
    '选择学年',
    JSON.stringify(years.options.map(item => item.label)),
    years.selectedIndex
  );
  if (yearIndex === null || yearIndex === -1) throw new Error('已取消学年选择');

  const semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
    '选择学期',
    JSON.stringify(semesters.options.map(item => item.label)),
    semesters.selectedIndex
  );
  if (semesterIndex === null || semesterIndex === -1) throw new Error('已取消学期选择');

  return {
    academicYear: years.options[yearIndex].value,
    semester: semesters.options[semesterIndex].value
  };
}

async function resolveTerm() {
  if (window.location.hostname !== SCHOOL_HOST) {
    throw new Error('请先从统一门户进入教务系统');
  }
  if (window.location.pathname === TIMETABLE_PATH) return readCurrentTerm();
  return selectTermFromTimetablePage();
}

async function fetchCourses(academicYear, semester) {
  const body = [
    `xnm=${encodeURIComponent(academicYear)}`,
    `xqm=${encodeURIComponent(semester)}`,
    'kzlx=ck',
    'xsdm=',
    'kclbdm=',
    'kclxdm='
  ].join('&');
  const data = JSON.parse(await requestText(
    `${window.location.origin}${COURSE_API}`,
    'POST',
    body
  ));
  return parseCourses(data);
}

function parseTimeSlots(data) {
  if (!Array.isArray(data)) return [];
  const slots = [];
  for (const raw of data) {
    const slot = {
      number: Number(raw.jcdm || raw.jcmc),
      startTime: String(raw.qssj || '').trim(),
      endTime: String(raw.jssj || '').trim()
    };
    if (Number.isInteger(slot.number) && slot.number > 0 && slot.startTime && slot.endTime) {
      slots.push(slot);
    }
  }
  return slots;
}

async function fetchTimeSlots(academicYear, semester) {
  const body = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semester)}`;
  const data = JSON.parse(await requestText(
    `${window.location.origin}${TIME_API}`,
    'POST',
    body
  ));
  return parseTimeSlots(data);
}

function buildCourseConfig(courses) {
  let totalWeeks = 0;
  for (const course of courses) {
    for (const week of course.weeks) totalWeeks = Math.max(totalWeeks, week);
  }
  return {
    semesterStartDate: null,
    semesterTotalWeeks: totalWeeks || 20,
    firstDayOfWeek: 1
  };
}

async function runImport() {
  try {
    const { academicYear, semester } = await resolveTerm();
    AndroidBridge.showToast('正在获取课表数据...');

    const courses = await fetchCourses(academicYear, semester);
    if (!courses.length) throw new Error('未获取到课程，请检查学年学期或登录状态');

    const timeSlots = await fetchTimeSlots(academicYear, semester).catch((error) => {
      console.warn('CQEPC time slots unavailable', error);
      return [];
    });
    await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(buildCourseConfig(courses)));
    if (timeSlots.length) {
      await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    }
    await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
    AndroidBridge.showToast(`导入成功：${courses.length} 门`);
    AndroidBridge.notifyTaskCompletion();
  } catch (error) {
    console.error('CQEPC import failed', error);
    AndroidBridge.showToast(`导入失败: ${error.message}`);
  }
}

runImport();
