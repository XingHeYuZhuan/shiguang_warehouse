// 南京邮电大学正方教务（V9）拾光课程表适配脚本
// 通过正方 API 获取课程与学期第一周日期，不依赖课表页面 HTML 结构。

const NJUPT_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:50", endTime: "10:35" },
    { number: 4, startTime: "10:40", endTime: "11:25" },
    { number: 5, startTime: "11:30", endTime: "12:15" },
    { number: 6, startTime: "13:45", endTime: "14:30" },
    { number: 7, startTime: "14:35", endTime: "15:20" },
    { number: 8, startTime: "15:35", endTime: "16:20" },
    { number: 9, startTime: "16:25", endTime: "17:10" },
    { number: 10, startTime: "18:30", endTime: "19:15" },
    { number: 11, startTime: "19:25", endTime: "20:10" },
    { number: 12, startTime: "20:20", endTime: "21:05" }
];

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(course => ({
        ...course,
        name: course.name || "",
        teacher: course.teacher || "",
        position: course.position || "",
        weeks: Array.isArray(course.weeks)
            ? [...course.weeks].sort((a, b) => a - b)
            : []
    }));

    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        a.day - b.day ||
        a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
        a.startSection - b.startSection
    );

    const sectionMerged = [];
    let current = list[0];
    for (let index = 1; index < list.length; index++) {
        const next = list[index];
        const sameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(",") === next.weeks.join(",");
        const continuous = current.endSection + 1 === next.startSection;
        const duplicate =
            current.startSection === next.startSection &&
            current.endSection === next.endSection;

        if (sameCourseAndWeeks && continuous) {
            current.endSection = next.endSection;
        } else if (!sameCourseAndWeeks || !duplicate) {
            sectionMerged.push(current);
            current = next;
        }
    }
    sectionMerged.push(current);

    sectionMerged.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.endSection - b.endSection
    );

    const result = [];
    let merged = sectionMerged[0];
    for (let index = 1; index < sectionMerged.length; index++) {
        const next = sectionMerged[index];
        const sameCourseAndSections =
            merged.name === next.name &&
            merged.teacher === next.teacher &&
            merged.position === next.position &&
            merged.day === next.day &&
            merged.startSection === next.startSection &&
            merged.endSection === next.endSection;

        if (sameCourseAndSections) {
            merged.weeks = [...new Set([...merged.weeks, ...next.weeks])]
                .sort((a, b) => a - b);
        } else {
            result.push(merged);
            merged = next;
        }
    }
    result.push(merged);
    return result;
}

function parseWeeks(weekText) {
    if (!weekText) return [];

    const weeks = [];
    for (const segment of String(weekText).split(/[，,]/)) {
        const normalized = segment.trim().replace(/（/g, "(").replace(/）/g, ")");
        const match = normalized.match(/(\d+)(?:-(\d+))?\s*周?/);
        if (!match) continue;

        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : start;
        const oddOnly = normalized.includes("(单)");
        const evenOnly = normalized.includes("(双)");

        for (let week = start; week <= end; week++) {
            if (oddOnly && week % 2 === 0) continue;
            if (evenOnly && week % 2 !== 0) continue;
            weeks.push(week);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: API 数据中缺少 kbList。");
        return [];
    }

    const courses = [];
    for (const rawCourse of jsonData.kbList) {
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeks = parseWeeks(rawCourse.zcd);
        const sectionNumbers = String(rawCourse.jcs).match(/\d+/g)?.map(Number) || [];
        const day = Number(rawCourse.xqj);
        const startSection = sectionNumbers[0];
        const endSection = sectionNumbers[sectionNumbers.length - 1];

        if (
            weeks.length === 0 ||
            !Number.isInteger(day) || day < 1 || day > 7 ||
            !Number.isInteger(startSection) || !Number.isInteger(endSection) ||
            startSection < 1 || startSection > endSection
        ) {
            continue;
        }

        courses.push({
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day,
            startSection,
            endSection,
            weeks
        });
    }

    return mergeAndDistinctCourses(courses);
}

function validateYearInput(input) {
    return /^\d{4}$/.test(input) ? false : "请输入四位数字的学年！";
}

async function getAcademicYear() {
    const now = new Date();
    const defaultYear = (now.getMonth() + 1 < 8 ? now.getFullYear() - 1 : now.getFullYear()).toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入学年起始年份（例如 2025-2026 学年请输入 2025）：",
        defaultYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    return await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期"]),
        0
    );
}

function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

function getNjuptApiBasePath() {
    const markers = ["/kbcx/", "/xtgl/"];
    const markerIndex = markers
        .map(marker => window.location.pathname.indexOf(marker))
        .filter(index => index >= 0)
        .sort((a, b) => a - b)[0];
    if (markerIndex === undefined) return null;

    // 南邮 WebVPN 会拦截并改写根相对请求。若传入已经带 WebVPN
    // 哈希前缀的完整 URL，会被二次改写成“当前页面.htm/kbcx/...”。
    return "";
}

function isNjuptPortalPage() {
    return (
        window.location.pathname.includes("/portal") ||
        window.location.pathname.includes("/mob/home")
    );
}

let mobileTeachingSystemSearchTriggered = false;
let mobileTeachingSystemExpandTriggered = false;

function normalizeTeachingSystemUrl(targetUrl) {
    if (!targetUrl) return null;
    try {
        const parsedUrl = new URL(targetUrl);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
            return parsedUrl.href;
        }
    } catch (error) {
        console.warn("JS: 智慧校园教务入口 URL 无效：", error);
    }
    return null;
}

function findMobileTeachingSystemSsoUrl() {
    if (!window.location.pathname.includes("/mob/home")) return null;

    const title = document.querySelector('[title="教务系统"]');
    const card = title?.closest(".bottom-box");
    if (card) {
        let capturedUrl = null;
        const originalOpen = window.open;
        try {
            window.open = targetUrl => {
                capturedUrl = targetUrl;
                return null;
            };
            card.click();
        } catch (error) {
            console.warn("JS: 无法捕获移动端教务入口：", error);
        } finally {
            try {
                window.open = originalOpen;
            } catch (_) {}
        }
        return normalizeTeachingSystemUrl(capturedUrl);
    }

    if (!mobileTeachingSystemExpandTriggered) {
        const moreButton = Array.from(
            document.querySelectorAll(".work-car .bottom-box")
        ).find(element => element.textContent.includes("更多"));
        if (moreButton) {
            mobileTeachingSystemExpandTriggered = true;
            moreButton.click();
            return null;
        }
    }

    if (!mobileTeachingSystemSearchTriggered) {
        mobileTeachingSystemSearchTriggered = true;
        const searchInput = document.querySelector('input[placeholder*="系统"]');
        if (searchInput) {
            searchInput.value = "教务";
            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true
            }));
        }
    }
    return null;
}

function findTeachingSystemSsoUrl() {
    const mobileTargetUrl = findMobileTeachingSystemSsoUrl();
    if (mobileTargetUrl) return mobileTargetUrl;

    const documents = [document];
    for (const iframe of document.querySelectorAll("iframe")) {
        try {
            if (iframe.contentDocument) documents.push(iframe.contentDocument);
        } catch (error) {
            console.warn("JS: 无法读取 portal iframe：", error);
        }
    }

    for (const currentDocument of documents) {
        for (const card of currentDocument.querySelectorAll("li.card[data-url]")) {
            const link = card.querySelector('a[title="教务系统"]');
            if (!link && !card.textContent.includes("教务系统")) continue;

            const targetUrl = normalizeTeachingSystemUrl(card.dataset.url);
            if (targetUrl) return targetUrl;
        }
    }
    return null;
}

async function waitForTeachingSystemSsoUrl() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const targetUrl = findTeachingSystemSsoUrl();
        if (targetUrl) return targetUrl;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
}

async function initializeTeachingSystemFromPortal(ssoUrl) {
    window.shiguangBridge.showToast("正在通过智慧校园连接教务系统...");
    const response = await fetch(ssoUrl, {
        method: "GET",
        credentials: "include",
        redirect: "follow"
    });
    if (!response.ok) throw new Error(`教务系统单点登录失败：HTTP ${response.status}`);

    const finalUrl = response.url || "";
    if (finalUrl.includes("/enlink/sso/login")) {
        throw new Error("WebVPN 登录状态已失效，请重新登录智慧校园");
    }
}

async function postForm(url, requestBody) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: requestBody,
        credentials: "include"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
}

async function fetchSemesterStartDate(appBasePath, academicYear, semesterCode) {
    const url = `${appBasePath}/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154`;
    try {
        const response = await postForm(url, `xnm=${academicYear}&xqm=${semesterCode}`);
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) return null;

        const firstWeek = data.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || data[0];
        if (firstWeek.rq) {
            const date = String(firstWeek.rq).split("/")[0];
            if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        }
        if (firstWeek.zcrq) {
            const match = String(firstWeek.zcrq).match(/\d{4}-\d{2}-\d{2}/);
            if (match) return match[0];
        }
    } catch (error) {
        console.error("JS: 获取开学日期失败：", error);
    }
    return null;
}

async function fetchCourses(appBasePath, academicYear, semesterCode) {
    const url = `${appBasePath}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;
    const body = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const response = await postForm(url, body);
    const data = await response.json();
    return parseJsonData(data);
}

async function saveImportResult(courses, semesterStartDate) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

    const config = { semesterTotalWeeks: 20 };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(NJUPT_TIME_SLOTS));
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "南京邮电大学课表导入",
        "请先完成 WebVPN 登录。可以直接在智慧校园主页导入，也可以进入教务系统后导入。",
        "好的，开始导入"
    );
    if (!confirmed) return;

    let appBasePath = getNjuptApiBasePath();
    let teachingSystemSsoUrl = null;

    if (appBasePath === null && isNjuptPortalPage()) {
        teachingSystemSsoUrl = await waitForTeachingSystemSsoUrl();
        if (teachingSystemSsoUrl) {
            appBasePath = new URL(teachingSystemSsoUrl).origin;
        }
    }

    if (appBasePath === null) {
        await window.shiguangBridgePromise.showAlert(
            "无法识别当前页面",
            "请打开南邮智慧校园主页，或从智慧校园进入教务系统后重试。",
            "确定"
        );
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) return;

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) return;

    const semesterCode = getSemesterCode(semesterIndex);
    window.shiguangBridge.showToast("正在从教务系统获取课表...");

    try {
        if (teachingSystemSsoUrl) {
            await initializeTeachingSystemFromPortal(teachingSystemSsoUrl);
        }

        const [courses, semesterStartDate] = await Promise.all([
            fetchCourses(appBasePath, academicYear, semesterCode),
            fetchSemesterStartDate(appBasePath, academicYear, semesterCode)
        ]);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "未获取到课程",
                "请确认已登录本科教务系统，并检查所选学年、学期是否正确。",
                "确定"
            );
            return;
        }

        await saveImportResult(courses, semesterStartDate);
        const dateMessage = semesterStartDate ? `，开学日期 ${semesterStartDate}` : "";
        window.shiguangBridge.showToast(`导入成功：${courses.length} 门课程${dateMessage}`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("JS: API 课表导入失败：", error);
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            `无法从教务系统 API 获取或保存数据：${error.message}`,
            "确定"
        );
    }
}

runImportFlow();
