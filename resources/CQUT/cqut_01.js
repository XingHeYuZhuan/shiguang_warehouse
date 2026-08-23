/**
 * 重庆理工大学课表导入脚本
 * author: Dawn Drizzle
 */
const API_BASE = 'https://timetable-cfc.cqut.edu.cn/api/courseSchedule';
const MAX_WEEK_REQUEST_CONCURRENCY = 5;
const REQUEST_RETRY_COUNT = 1;
const RETRY_DELAY_MS = 300;

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

// 仅允许在课表站点内执行，避免跨站点误触发
const checkLogin = () => window.location.hostname === 'timetable-cfc.cqut.edu.cn';

// 统一的接口请求封装：POST + JSON + 携带 Cookie；网络错误、限流和服务端错误会重试一次
const baseFetch = async (path, body, description) => {
    const requestBody = body === undefined ? undefined : JSON.stringify(body);

    for (let attempt = 0; attempt <= REQUEST_RETRY_COUNT; attempt++) {
        let response;

        try {
            response = await fetch(`${API_BASE}/${path}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: requestBody,
            });
        } catch (error) {
            if (attempt < REQUEST_RETRY_COUNT) {
                await wait(RETRY_DELAY_MS * (attempt + 1));
                continue;
            }

            throw new Error(`获取${description}失败: ${error.message}`);
        }

        if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;

            if (retryable && attempt < REQUEST_RETRY_COUNT) {
                await wait(RETRY_DELAY_MS * (attempt + 1));
                continue;
            }

            throw new Error(`获取${description}失败: ${response.status} ${response.statusText}`);
        }

        try {
            return await response.json();
        } catch (error) {
            throw new Error(`解析${description}失败: ${error.message}`);
        }
    }

    throw new Error(`获取${description}失败`);
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

// 使用固定数量的工作协程处理每周请求，避免短时间内向教务接口发出过多请求
const mapWithConcurrency = async (items, concurrency, mapper) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
};

const normalizePositiveIntegerList = (values) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0)
)].sort((left, right) => left - right);

const normalizeWeekList = (weekList) => normalizePositiveIntegerList(weekList);

// 检查接口响应中的学期是否与用户选择一致，防止服务端忽略 yearTerm 参数
const assertMatchingYearTerm = (weekData, expectedYearTerm, description, required = false) => {
    const actualYearTerm = String(weekData?.yearTerm ?? '').trim();

    if (!actualYearTerm) {
        if (required) {
            throw new Error(`${description}缺少学期标识`);
        }

        return;
    }

    if (actualYearTerm !== expectedYearTerm) {
        throw new Error(`${description}返回了错误学期: ${actualYearTerm}`);
    }
};

// 将接口中的学期标识转换为更易读的选项文本
const formatYearTerm = (yearTerm) => {
    const value = String(yearTerm ?? '').trim();
    const match = value.match(/^(\d{4})-(\d{4})-(\d+)$/);

    return match ? `${match[1]}-${match[2]}学年 第${match[3]}学期` : value;
};

// 从当前周接口返回值中读取可用学期，并让用户选择要导入的学期
const selectYearTerm = async (weekData) => {
    const currentYearTerm = String(weekData?.yearTerm ?? '').trim();
    const yearTermList = Array.isArray(weekData?.yearTermList)
        ? weekData.yearTermList.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [];
    const yearTerms = [...new Set(yearTermList)];

    // 兼容接口暂未返回 yearTermList 的情况，仍允许导入当前学期
    if (currentYearTerm && !yearTerms.includes(currentYearTerm)) {
        yearTerms.unshift(currentYearTerm);
    }

    if (yearTerms.length === 0) {
        throw new Error('学期列表为空');
    }

    const currentIndex = yearTerms.indexOf(currentYearTerm);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期',
        JSON.stringify(yearTerms.map(formatYearTerm)),
        currentIndex >= 0 ? currentIndex : 0,
    );

    if (selectedIndex === null || Number(selectedIndex) === -1) {
        window.shiguangBridge.showToast('已取消课程导入');
        return null;
    }

    const normalizedIndex = Number(selectedIndex);

    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= yearTerms.length) {
        throw new Error(`无效的学期选项索引: ${selectedIndex}`);
    }

    return yearTerms[normalizedIndex];
};

const normalizeTime = (value) => {
    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);

    if (!match) {
        return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const timeToMinutes = (value) => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
};

// 将接口的节次时间转换为统一结构，过滤无效项、按节次去重并升序排序
const parseTimeSlots = (timeSlots) => {
    const parsedTimeSlots = new Map();

    for (const timeSlot of Array.isArray(timeSlots) ? timeSlots : []) {
        const number = Number(timeSlot?.sessionNum);
        const startTime = normalizeTime(timeSlot?.startTime);
        const endTime = normalizeTime(timeSlot?.endTime);

        if (
            !Number.isInteger(number)
            || number <= 0
            || !startTime
            || !endTime
            || timeToMinutes(endTime) <= timeToMinutes(startTime)
        ) {
            continue;
        }

        if (!parsedTimeSlots.has(number)) {
            parsedTimeSlots.set(number, { number, startTime, endTime });
        }
    }

    return [...parsedTimeSlots.values()].sort((left, right) => left.number - right.number);
};

// 推算学期开始日期（YYYY-MM-DD）：使用 weekDayList 第一条的月/日 + yearTerm 中的学年信息
const parseSemesterStartDate = (yearTerm, weekDayList) => {
    const firstWeekDate = weekDayList?.[0]?.weekDate;

    if (!yearTerm || !firstWeekDate) {
        return null;
    }

    const yearTermMatch = String(yearTerm).match(/^(\d{4})-(\d{4})-([12])$/);
    const weekDateMatch = String(firstWeekDate).trim().match(/^(\d{1,2})\/(\d{1,2})$/);

    if (!yearTermMatch || !weekDateMatch) {
        return null;
    }

    const [, startYear, endYear, termPart] = yearTermMatch;
    const month = Number(weekDateMatch[1]);
    const day = Number(weekDateMatch[2]);
    const year = termPart === '1' ? Number(startYear) : Number(endYear);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        Number.isNaN(date.getTime())
        || date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }

    return date.toISOString().split('T')[0];
};

// 将接口的 event 解析为课程结构（节次、星期、周次等）
const parseCourse = (event) => {
    if (!event || typeof event !== 'object') {
        return null;
    }

    const sessionList = normalizePositiveIntegerList(event.sessionList);
    const declaredStartSection = Number(event.sessionStart);
    const startSection = Number.isInteger(declaredStartSection) && declaredStartSection > 0
        ? declaredStartSection
        : sessionList[0];
    const declaredDuration = Number(event.sessionLast);
    const duration = Number.isInteger(declaredDuration) && declaredDuration > 0 ? declaredDuration : 1;
    const endSection = sessionList[sessionList.length - 1] ?? startSection + duration - 1;
    const name = String(event.eventName ?? '').trim();
    const day = Number(event.weekDay);
    const weeks = normalizeWeekList(event.weekList);

    if (
        !name
        || !Number.isInteger(day)
        || day < 1
        || day > 7
        || !Number.isInteger(startSection)
        || startSection <= 0
        || !Number.isInteger(endSection)
        || endSection < startSection
        || weeks.length === 0
    ) {
        return null;
    }

    return {
        name,
        teacher: String(event.memberName ?? '').trim(),
        position: String(event.address ?? '').trim(),
        day,
        startSection,
        endSection,
        weeks,
    };
};

// 合并完全相同（课程名/老师/地点/星期/节次范围一致）的课程，将周次去重合并
const mergeCourses = (events) => {
    const mergedCourses = new Map();

    for (const event of events) {
        const course = parseCourse(event);

        if (!course) {
            continue;
        }

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

const saveBridgeData = async (description, saveAction) => {
    try {
        const result = await saveAction();

        if (result !== true) {
            throw new Error(`返回值异常: ${String(result)}`);
        }
    } catch (error) {
        throw new Error(`${description}保存失败: ${error?.message || String(error)}`);
    }
};

// 顺序保存，并将课程放在最后，避免配置或作息保存失败时提前覆盖现有课程
const saveSchedule = async (parsedSchedule) => {
    await saveBridgeData(
        '课表配置',
        () => window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(parsedSchedule.courseConfig)),
    );
    await saveBridgeData(
        '节次时间',
        () => window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parsedSchedule.timeSlots)),
    );
    await saveBridgeData(
        '课程数据',
        () => window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedSchedule.courses)),
    );
};

// 主流程：校验页面 → 拉取用户/校区 → 获取并选择学期 → 拉取所选学期每周课程 → 合并保存
const runImportFlow = async () => {
    if (!checkLogin()) {
        throw new Error('当前不在重庆理工大学课表页面');
    }

    const userInfo = await getUserInfo();
    const userID = userInfo?.username;
    const campusName = userInfo?.userCustomSetting?.campusName;

    if (!userID || !campusName) {
        throw new Error('用户信息不完整');
    }

    const [timeSlotData, semesterOverview] = await Promise.all([
        getCampusTimeInfo(campusName),
        getWeekEvents(userID, null, null, '学期信息'),
    ]);

    const yearTerm = await selectYearTerm(semesterOverview);

    if (yearTerm === null) {
        return;
    }

    // 选择当前学期时复用首次请求；选择其他学期时重新获取其周次和日期信息
    const selectedWeekData = String(semesterOverview?.yearTerm ?? '').trim() === yearTerm
        ? semesterOverview
        : await getWeekEvents(userID, null, yearTerm, `${formatYearTerm(yearTerm)}信息`);
    assertMatchingYearTerm(selectedWeekData, yearTerm, '所选学期信息', true);
    const weekList = normalizeWeekList(selectedWeekData?.weekList);
    const timeSlots = parseTimeSlots(timeSlotData);

    if (weekList.length === 0) {
        throw new Error(`学期信息不完整: ${yearTerm}`);
    }

    if (timeSlots.length === 0) {
        throw new Error('未获取到有效的节次时间');
    }

    // semesterStartDate 必须取自第一周；首次接口可能返回的是当前周，不能直接使用其中的日期
    const firstWeekNum = weekList[0];
    const selectedWeekNum = Number(selectedWeekData?.weekNum);
    const firstWeekData = selectedWeekNum === firstWeekNum
        ? selectedWeekData
        : await getWeekEvents(userID, String(firstWeekNum), yearTerm, `第${firstWeekNum}周课程`);
    assertMatchingYearTerm(firstWeekData, yearTerm, `第${firstWeekNum}周课程`);
    const semesterStartDate = parseSemesterStartDate(yearTerm, firstWeekData?.weekDayList);
    const preloadedWeekData = new Map([[String(firstWeekNum), firstWeekData]]);

    if (weekList.includes(selectedWeekNum)) {
        preloadedWeekData.set(String(selectedWeekNum), selectedWeekData);
    }

    const weekResults = await mapWithConcurrency(
        weekList,
        MAX_WEEK_REQUEST_CONCURRENCY,
        (weekNum) => preloadedWeekData.get(String(weekNum))
            ?? getWeekEvents(userID, String(weekNum), yearTerm, `第${weekNum}周课程`),
    );

    weekResults.forEach((result, index) => {
        assertMatchingYearTerm(result, yearTerm, `第${weekList[index]}周课程`);
    });

    const events = weekResults.flatMap((result) => Array.isArray(result?.eventList) ? result.eventList : []);
    const courses = mergeCourses(events);

    if (courses.length === 0) {
        window.shiguangBridge.showToast(`${formatYearTerm(yearTerm)}未找到课程，未修改现有课表`);
        return;
    }

    await saveSchedule({
        courseConfig: {
            semesterStartDate,
            semesterTotalWeeks: weekList[weekList.length - 1],
        },
        timeSlots,
        courses,
    });

    window.shiguangBridge.notifyTaskCompletion();
};

// 所有非用户取消类错误都在入口统一反馈，避免未处理的 Promise 拒绝
const runImportFlowSafely = async () => {
    try {
        await runImportFlow();
    } catch (error) {
        const message = error?.message || String(error);
        console.error(`[课程导入失败] ${message}`);
        window.shiguangBridge.showToast(`课程导入失败：${message}`);
    }
};

runImportFlowSafely();
