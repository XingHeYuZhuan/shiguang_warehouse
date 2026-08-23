/**
 * 重庆理工大学课表导入脚本
 * author: Dawn Drizzle
 */
const API_BASE = 'https://timetable-cfc.cqut.edu.cn/api/courseSchedule';

// 仅允许在课表站点内执行，避免跨站点误触发
const checkLogin = () => window.location.hostname === 'timetable-cfc.cqut.edu.cn';

// 统一的接口请求封装：POST + JSON + 携带 Cookie，并在失败时提示原因
const baseFetch = async (path, body, description) => {
    const response = await fetch(`${API_BASE}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
        window.shiguangBridge.showToast(`获取${description}失败，请确认已登录后重试`);
        throw new Error(`获取${description}失败: ${response.status} ${response.statusText}`);
    }

    try {
        return await response.json();
    } catch (error) {
        window.shiguangBridge.showToast(`解析${description}失败，请确认当前页面登录状态`);
        throw new Error(`解析${description}失败: ${error.message}`);
    }
};

// 获取当前登录用户信息（包含 username、校区等）
const getUserInfo = async () => await baseFetch('getUserInfo', {}, '用户信息');

// 获取指定校区的节次时间表
const getCampusTimeInfo = async (campusName) => await baseFetch('getCampusTimeInfo', { campusName }, '时间表');

// 获取指定周课程事件列表；weekNum/yearTerm 为空时，接口返回当前学期/当前周信息
const getWeekEvents = async (userID, weekNum, yearTerm, description) => await baseFetch(
    'listWeekEvents',
    {
        userID: String(userID),
        weekNum,
        yearTerm,
    },
    description,
);

// 将接口的节次时间转换为统一结构，并按节次序号升序排序
const parseTimeSlots = (timeSlots) => timeSlots
    .slice()
    .sort((left, right) => Number(left.sessionNum) - Number(right.sessionNum))
    .map((timeSlot) => ({
        number: Number(timeSlot.sessionNum) || 0,
        startTime: timeSlot.startTime ?? '',
        endTime: timeSlot.endTime ?? '',
    }));

// 推算学期开始日期（YYYY-MM-DD）：使用 weekDayList 第一条的月/日 + yearTerm 中的学年信息
const parseSemesterStartDate = (yearTerm, weekDayList) => {
    const firstWeekDate = weekDayList?.[0]?.weekDate;

    if (!yearTerm || !firstWeekDate) {
        return null;
    }

    const [startYear, endYear, termPart] = String(yearTerm).split('-');
    const [month, day] = String(firstWeekDate).split('/').map(Number);

    if (!startYear || !endYear || !termPart || Number.isNaN(month) || Number.isNaN(day)) {
        return null;
    }

    const year = termPart === '1' ? Number(startYear) : Number(endYear);

    if (Number.isNaN(year)) {
        return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().split('T')[0];
};

// 将接口的 event 解析为课程结构（节次、星期、周次等）
const parseCourse = (event) => {
    const sessionList = (event.sessionList ?? []).map(Number).filter((session) => !Number.isNaN(session));
    const startSection = Number(event.sessionStart) || sessionList[0] || 0;
    const endSection = sessionList[sessionList.length - 1] || startSection + (Number(event.sessionLast) || 1) - 1;

    return {
        name: event.eventName ?? '',
        teacher: event.memberName ?? '',
        position: event.address ?? '',
        day: Number(event.weekDay) || 0,
        startSection,
        endSection,
        weeks: (event.weekList ?? []).map(Number).filter((week) => !Number.isNaN(week)),
    };
};

// 合并完全相同（课程名/老师/地点/星期/节次范围一致）的课程，将周次去重合并
const mergeCourses = (events) => {
    const mergedCourses = new Map();

    for (const event of events) {
        const course = parseCourse(event);
        const key = [
            course.name,
            course.teacher,
            course.position,
            course.day,
            course.startSection,
            course.endSection,
        ].join('||');

        if (!mergedCourses.has(key)) {
            mergedCourses.set(key, course);
            continue;
        }

        const existingCourse = mergedCourses.get(key);
        existingCourse.weeks = [...new Set([...existingCourse.weeks, ...course.weeks])].sort((left, right) => left - right);
    }

    return [...mergedCourses.values()];
};

// 将解析后的结构写入 App（配置、课程列表、节次时间表）
const saveSchedule = (parsedSchedule) => Promise.all([
    window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(parsedSchedule.courseConfig)),
    window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedSchedule.courses)),
    window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parsedSchedule.timeSlots)),
]);

// 主流程：校验页面 → 拉取用户/校区 → 拉取节次/当前学期信息 → 拉取全学期每周课程 → 合并保存
(async () => {
    if (!checkLogin()) {
        window.shiguangBridge.showToast('请先打开重庆理工大学课表页面并登录');
        throw new Error('当前不在重庆理工大学课表页面');
    }

    const userInfo = await getUserInfo();
    const userID = userInfo?.username;
    const campusName = userInfo?.userCustomSetting?.campusName;

    if (!userID || !campusName) {
        window.shiguangBridge.showToast('未获取到完整的用户信息，请确认已登录');
        throw new Error('用户信息不完整');
    }

    const [timeSlotData, currentWeekData] = await Promise.all([
        getCampusTimeInfo(campusName),
        getWeekEvents(userID, null, null, '当前学期信息'),
    ]);

    const yearTerm = currentWeekData?.yearTerm;
    const weekList = Array.isArray(currentWeekData?.weekList) ? currentWeekData.weekList : [];
    const currentWeekNum = currentWeekData?.weekNum;
    const semesterStartDate = parseSemesterStartDate(yearTerm, currentWeekData?.weekDayList);

    if (!yearTerm || weekList.length === 0) {
        window.shiguangBridge.showToast('未获取到当前学期信息');
        throw new Error('当前学期信息不完整');
    }

    const weekResults = await Promise.all(
        weekList.map((weekNum) => String(weekNum) === String(currentWeekNum)
            ? currentWeekData
            : getWeekEvents(userID, String(weekNum), yearTerm, `第${weekNum}周课程`))
    );

    await saveSchedule({
        courseConfig: {
            semesterStartDate,
            semesterTotalWeeks: weekList.length,
        },
        timeSlots: parseTimeSlots(timeSlotData),
        courses: mergeCourses(weekResults.flatMap((result) => result?.eventList ?? [])),
    });

    window.shiguangBridge.notifyTaskCompletion();
})();
