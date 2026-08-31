async page => {
  return await page.evaluate(async () => {
    function parseWeeks(str) {
      if (!str) return [];
      return String(str).split(',').map(s => s.trim()).reduce((acc, part) => {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(Number);
          for (let i = start; i <= end; i++) acc.push(i);
        } else {
          const n = Number(part);
          if (!isNaN(n)) acc.push(n);
        }
        return acc;
      }, []).sort((a, b) => a - b);
    }

    function mergeAndDistinctCourses(courses) {
      if (!Array.isArray(courses) || courses.length <= 1) return courses;
      const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
      }));
      list.sort((a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) || a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) || a.weeks.join(',').localeCompare(b.weeks.join(',')) || (a.startSection || 0) - (b.startSection || 0));
      const step1 = [];
      let current = list[0];
      for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const same = current.name === next.name && current.teacher === next.teacher && current.position === next.position && current.day === next.day && current.weeks.join(',') === next.weeks.join(',');
        if (same && current.endSection + 1 === next.startSection) {
          current.endSection = next.endSection;
        } else if (same && current.startSection === next.startSection && current.endSection === next.endSection) {
          continue;
        } else {
          step1.push(current);
          current = next;
        }
      }
      step1.push(current);
      step1.sort((a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) || a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) || (a.startSection || 0) - (b.startSection || 0) || (a.endSection || 0) - (b.endSection || 0));
      const step2 = [];
      let cur = step1[0];
      for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameSection = cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position && cur.day === nxt.day && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection;
        if (sameSection) {
          cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
          step2.push(cur);
          cur = nxt;
        }
      }
      step2.push(cur);
      return step2;
    }

    async function runImportFlow() {
      const baseUrl = window.location.origin;
      const semesterRes = await fetch(baseUrl + '/api/baseInfo/semester/selectCurrentXnXq?_t=' + Date.now(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const semesterJson = await semesterRes.json();
      let semester = '2026-2027-1';
      let semesterStartDate = '2026-09-01';
      if (semesterJson.code === 200 && semesterJson.data) {
        semester = semesterJson.data.semester || semester;
        if (semesterJson.data.ksrq) {
          semesterStartDate = semesterJson.data.ksrq.split(' ')[0];
        }
      }

      const qwRes = await fetch(baseUrl + '/api/arrange/teacherServer/queryWeek?schoolYear=' + encodeURIComponent(semester) + '&_t=' + Date.now());
      const qwJson = await qwRes.json();
      const weeks = qwJson.code === 200 && Array.isArray(qwJson.data) ? qwJson.data : [];

      const allData = [];
      for (const w of weeks) {
        const res = await fetch(baseUrl + '/api/arrange/CourseScheduleAllQuery/studentCourseSchedule?_t=' + Date.now(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': baseUrl,
            'Referer': baseUrl + '/'
          },
          body: JSON.stringify({ studentId: '', oddOrDouble: 1, source: 'xs', semester, weeks: [w], queryType: 'single' })
        });
        const json = await res.json();
        if (json.code === 200 && Array.isArray(json.data)) {
          allData.push(...json.data);
        }
      }

      const courses = [];
      const timeSlotsMap = new Map();
      for (const slot of allData) {
        const timeCode = slot.time.timeCode;
        const parts = timeCode.split('_');
        const startSection = Number(parts[0]);
        const endSection = Number(parts[1]);
        const day = slot.week.weekCode == 1 ? 7 : slot.week.weekCode - 1;

        if (!timeSlotsMap.has(timeCode)) {
          timeSlotsMap.set(timeCode, { number: startSection, startTime: slot.time.startTime, endTime: slot.time.endTime });
        }

        for (const c of slot.courseList) {
          courses.push({
            name: c.courseName,
            teacher: c.teacherName || '',
            position: c.classroomName || '',
            day,
            startSection,
            endSection,
            weeks: parseWeeks(c.weeks),
            isCustomTime: false
          });
        }
      }

      const merged = mergeAndDistinctCourses(courses);
      const timeSlots = Array.from(timeSlotsMap.values()).sort((a, b) => a.number - b.number);

      return JSON.stringify({
        courses: merged,
        timeSlots: timeSlots,
        config: {
          semesterStartDate,
          semesterTotalWeeks: weeks.length || 20,
          firstDayOfWeek: 1
        }
      }, null, 2);
    }

    return await runImportFlow();
  });
}