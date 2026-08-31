// 郑州大学 (ZZU) 拾光课程表适配脚本
// 支持树维新一代智慧教务系统（jwxt.zzu.edu.cn）与移动综合信息门户（info.s.zzu.edu.cn）双流水线

(function () {
    const JWXT_BASE_URLS = [
        "https://jwxt.zzu.edu.cn",
        "https://info.s.zzu.edu.cn",
        ""
    ];

    const API_BASES = [
        "https://jwxt.zzu.edu.cn/eams-door/api/v1",
        "https://info.s.zzu.edu.cn/portal-api/v1",
        "https://info.s.zzu.edu.cn/eams-door/api/v1",
        "/eams-door/api/v1",
        "/portal-api/v1"
    ];

    // 郑州大学标准 12 节作息时间（第 1-4 节上午，第 5-8 节下午，第 9-12 节晚上）
    const ZZU_TIME_SLOTS = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:10", endTime: "10:55" },
        { number: 4, startTime: "11:05", endTime: "11:50" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:55", endTime: "15:40" },
        { number: 7, startTime: "16:10", endTime: "16:55" },
        { number: 8, startTime: "17:05", endTime: "17:50" },
        { number: 9, startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" },
        { number: 11, startTime: "20:50", endTime: "21:35" },
        { number: 12, startTime: "21:40", endTime: "22:25" }
    ];

    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        } else {
            console.log("[ZZU Toast]", message);
        }
    }

    async function alertUser(title, message) {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    function cleanString(str) {
        if (!str) return "";
        const s = String(str)
            .replace(/\u00a0/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (s === "null" || s === "undefined" || s === "none" || s === "无" || s === "空") {
            return "";
        }
        return s;
    }

    function calculateTotalWeeks(startDate, endDate) {
        if (!startDate || !endDate) return 20;
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffMs = end.getTime() - start.getTime();
        if (diffMs <= 0) return 20;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return Math.min(Math.max(Math.ceil(diffDays / 7), 16), 30);
    }

    // ──────────────────────────────────────────────────────────
    // 树维新一代智慧教务系统流水线 (student/for-std/course-table)
    // ──────────────────────────────────────────────────────────

    async function fetchSemesters(baseUrl = "") {
        try {
            const res = await fetch(`${baseUrl}/student/for-std/course-table`, {
                headers: {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "x-requested-with": "XMLHttpRequest"
                },
                method: "GET",
                credentials: "include"
            });
            if (!res.ok) return null;

            const htmlText = await res.text();
            if (!htmlText || !htmlText.includes("allSemesters")) return null;

            let options = [];
            if (typeof DOMParser !== "undefined") {
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, "text/html");
                const select = doc.getElementById("allSemesters") || doc.querySelector("#allSemesters");
                if (select) {
                    options = Array.from(select.querySelectorAll("option")).map(opt => ({
                        label: opt.textContent.trim(),
                        value: opt.value.trim(),
                        selected: opt.hasAttribute("selected") || opt.selected
                    })).filter(o => o.value && o.label);
                }
            }

            if (options.length === 0) {
                const selectMatch = htmlText.match(/<select[^>]*id=["']allSemesters["'][^>]*>([\s\S]*?)<\/select>/i);
                if (selectMatch) {
                    const optRegex = /<option[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
                    let m;
                    while ((m = optRegex.exec(selectMatch[1])) !== null) {
                        const val = m[1].trim();
                        const label = m[2].replace(/<[^>]*>/g, "").trim();
                        if (val && label) {
                            options.push({ label, value: val, selected: m[0].includes("selected") });
                        }
                    }
                }
            }

            if (options.length === 0) return null;

            let studentId = null;
            const dataIdMatch = htmlText.match(/var\s+dataId\s*=\s*(\d+)/) || htmlText.match(/dataId\s*[:=]\s*["']?(\d+)["']?/);
            if (dataIdMatch) studentId = dataIdMatch[1];

            return {
                options,
                studentId
            };
        } catch (e) {
            return null;
        }
    }

    async function fetchSemesterMetadata(baseUrl, semesterId) {
        try {
            const res = await fetch(`${baseUrl}/student/ws/semester/get/${semesterId}`, {
                headers: {
                    "accept": "*/*",
                    "x-requested-with": "XMLHttpRequest"
                },
                method: "GET",
                credentials: "include"
            });
            if (!res.ok) return { startDate: null, endDate: null };
            const data = await res.json();
            return {
                startDate: data.startDate || null,
                endDate: data.endDate || null
            };
        } catch (e) {
            return { startDate: null, endDate: null };
        }
    }

    async function fetchAndParseNewJwxtCourses(baseUrl, semesterId, studentId = null) {
        const urls = [
            `${baseUrl}/student/for-std/course-table/semester/${semesterId}/print-data?semesterId=${semesterId}&hasExperiment=true`
        ];
        if (studentId) {
            urls.push(`${baseUrl}/student/for-std/course-table/semester/${semesterId}/print-data/${studentId}`);
        }

        for (const url of urls) {
            try {
                const res = await fetch(url, {
                    headers: {
                        "accept": "*/*",
                        "x-requested-with": "XMLHttpRequest"
                    },
                    method: "GET",
                    credentials: "include"
                });
                if (!res.ok) continue;
                const data = await res.json();
                if (!data) continue;

                const rawActivities = (data.studentTableVms && data.studentTableVms[0] ? data.studentTableVms[0].activities : (data.studentTableVm ? data.studentTableVm.activities : (data.activities || []))) || [];
                if (!Array.isArray(rawActivities) || rawActivities.length === 0) continue;

                const parsedCourses = [];
                for (const act of rawActivities) {
                    if (!act.courseName || !act.weekday || !act.startUnit || !act.endUnit || !Array.isArray(act.weekIndexes)) {
                        continue;
                    }

                    const teacherName = Array.isArray(act.teachers) && act.teachers.length > 0
                        ? act.teachers.map(t => String(t).replace(/\(\d+\)/g, "").replace(/\[\d+\]/g, "").trim()).filter(Boolean).join(",")
                        : (typeof act.teachers === "string" ? act.teachers.replace(/\(\d+\)/g, "").trim() : "");

                    const weeks = act.weekIndexes.map(Number).filter(w => Number.isInteger(w) && w > 0).sort((a, b) => a - b);
                    if (weeks.length === 0) continue;

                    const startSection = Number(act.startUnit);
                    const endSection = Number(act.endUnit);
                    const sections = [];
                    for (let s = startSection; s <= endSection; s++) sections.push(s);

                    parsedCourses.push({
                        name: cleanString(act.courseName),
                        teacher: cleanString(teacherName),
                        position: cleanString(act.room || act.building || "未知地点"),
                        day: Number(act.weekday),
                        startSection: startSection,
                        endSection: endSection,
                        sections: sections,
                        weeks: weeks
                    });
                }

                if (parsedCourses.length > 0) {
                    return parsedCourses;
                }
            } catch (e) {}
        }
        return null;
    }

    async function runNewJwxtFlow() {
        for (const base of JWXT_BASE_URLS) {
            try {
                const semData = await fetchSemesters(base);
                if (!semData || !semData.options || semData.options.length === 0) continue;

                const labels = semData.options.map(s => s.label);
                let defaultIndex = semData.options.findIndex(s => s.selected);
                if (defaultIndex < 0) defaultIndex = 0;

                const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                    "选择学期",
                    JSON.stringify(labels),
                    defaultIndex
                );

                if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= semData.options.length) {
                    toast("操作已取消");
                    return true;
                }

                const selectedSemester = semData.options[selectedIndex];
                toast("正在拉取课表数据...");

                const [meta, courses] = await Promise.all([
                    fetchSemesterMetadata(base, selectedSemester.value),
                    fetchAndParseNewJwxtCourses(base, selectedSemester.value, semData.studentId)
                ]);

                if (!courses || courses.length === 0) {
                    toast("未查询到有效课程数据");
                    return false;
                }

                let totalWeeks = 20;
                if (meta && meta.startDate && meta.endDate) {
                    totalWeeks = calculateTotalWeeks(meta.startDate, meta.endDate);
                } else {
                    const allWeeks = courses.flatMap(c => c.weeks || []);
                    if (allWeeks.length > 0) totalWeeks = Math.max(...allWeeks);
                }

                const configData = {
                    semesterStartDate: meta && meta.startDate ? meta.startDate : "",
                    semesterTotalWeeks: Math.max(totalWeeks, 18),
                    firstDayOfWeek: 1,
                    defaultClassDuration: 45,
                    defaultBreakDuration: 10
                };

                if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
                    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
                }

                if (window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
                    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(ZZU_TIME_SLOTS));
                }

                if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
                    const saveOk = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
                    if (!saveOk) {
                        toast("课程保存失败");
                        return true;
                    }
                }

                toast(`导入成功！共解析 ${courses.length} 门课程，已同步学期日期与作息时间。`);
                if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                    window.shiguangBridge.notifyTaskCompletion();
                }
                return true;
            } catch (e) {
                console.warn("[ZZU New Jwxt Pipeline Exception]", e);
            }
        }
        return false;
    }

    // ──────────────────────────────────────────────────────────
    // 移动微服务日历排课兜底流水线 (info.s.zzu.edu.cn)
    // ──────────────────────────────────────────────────────────

    function scanTokens() {
        const tokens = new Set();
        const jwtRegex = /ey[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]+/g;

        function scanValue(val) {
            if (!val || typeof val !== "string") return;
            let m;
            while ((m = jwtRegex.exec(val)) !== null) {
                tokens.add(m[0]);
            }
            if (val.length > 25 && !val.includes("{") && !val.includes("[")) {
                tokens.add(val.trim());
            }
        }

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                scanValue(localStorage.getItem(k));
            }
            for (let j = 0; j < sessionStorage.length; j++) {
                const sk = sessionStorage.key(j);
                scanValue(sessionStorage.getItem(sk));
            }
            scanValue(document.cookie);
        } catch (e) {
            console.warn("[ZZU Adapter] scan tokens error:", e);
        }

        return Array.from(tokens);
    }

    function mapTimeToSection(timeStr) {
        if (!timeStr) return 1;
        const clean = parseInt(String(timeStr).replace(/[^0-9]/g, ""), 10) || 800;
        if (clean < 850) return 1;
        if (clean < 1000) return 2;
        if (clean < 1100) return 3;
        if (clean < 1200) return 4;
        if (clean < 1450) return 5;
        if (clean < 1550) return 6;
        if (clean < 1650) return 7;
        if (clean < 1750) return 8;
        if (clean < 1950) return 9;
        if (clean < 2050) return 10;
        if (clean < 2140) return 11;
        return 12;
    }

    function calculateSectionCount(startTime, endTime) {
        if (!startTime || !endTime) return 2;
        const s = parseInt(String(startTime).replace(/[^0-9]/g, ""), 10) || 800;
        const e = parseInt(String(endTime).replace(/[^0-9]/g, ""), 10) || 940;
        const sMin = Math.floor(s / 100) * 60 + (s % 100);
        const eMin = Math.floor(e / 100) * 60 + (e % 100);
        const diff = eMin - sMin;
        if (diff <= 60) return 1;
        if (diff <= 120) return 2;
        if (diff <= 180) return 3;
        return 4;
    }

    function getSemesterMonths() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const months = [];

        let startYear = year;
        let startMonth = 8;
        if (month >= 2 && month <= 7) {
            startMonth = 2;
        }

        for (let i = 0; i < 6; i++) {
            let m = startMonth + i;
            let y = startYear;
            if (m > 12) {
                m -= 12;
                y += 1;
            }
            const mStr = m < 10 ? "0" + m : "" + m;
            months.push(`${y}-${mStr}`);
        }
        return months;
    }

    async function fetchOneMonthSchedule(monthStr, token) {
        const headers = {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "X-Device-Info": "Android",
            "X-Terminal-Info": "app"
        };
        if (token) {
            headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
            headers["token"] = token;
            headers["X-Id-Token"] = token;
        }

        for (const base of API_BASES) {
            try {
                const url = `${base}/protal-schedule/getSchedules?date=${monthStr}`;
                const res = await fetch(url, {
                    method: "GET",
                    credentials: "include",
                    headers: headers
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === "object") {
                        const payload = data.data && typeof data.data === "object" ? data.data : data;
                        if (Object.keys(payload).some(k => /^\d{4}-\d{2}-\d{2}$/.test(k))) {
                            return payload;
                        }
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    function aggregateEventsToCourses(monthPayloads) {
        const rawEvents = [];

        monthPayloads.forEach(dataObj => {
            if (!dataObj || typeof dataObj !== "object") return;

            Object.keys(dataObj).forEach(dateKey => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
                const arr = dataObj[dateKey];
                if (!Array.isArray(arr)) return;

                const dateObj = new Date(dateKey + "T00:00:00");
                let dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 0) dayOfWeek = 7;

                arr.forEach(item => {
                    if (!item || typeof item !== "object") return;

                    let name = cleanString(item.context || item.courseName || item.kcmc || item.name || "");
                    if (!name) return;

                    let place = cleanString(item.place || item.classroom || item.cdmc || item.roomName || "");
                    if (!place) place = "教学楼";

                    let teacher = cleanString(item.teacher || item.teacherName || item.jsxm || item.js || "");

                    const m = name.match(/^(.*?)[(（]([^\d()（）\s]{2,6})[)）]$/);
                    if (m) {
                        name = m[1].trim();
                        if (!teacher) teacher = m[2].trim();
                    }

                    const startTime = item.startTime || "08:00";
                    const endTime = item.endTime || "09:40";
                    const weekIndex = parseInt(item.weekIndex || item.week || 1, 10);

                    const startSection = mapTimeToSection(startTime);
                    const sectionCount = calculateSectionCount(startTime, endTime);
                    const endSection = startSection + sectionCount - 1;

                    rawEvents.push({
                        dateKey,
                        name,
                        teacher,
                        position: place,
                        day: dayOfWeek,
                        startSection,
                        endSection,
                        weekIndex
                    });
                });
            });
        });

        const uniqueMap = new Map();
        rawEvents.forEach(ev => {
            const key = `${ev.dateKey}_${ev.name}_${ev.teacher}_${ev.position}_${ev.day}_${ev.startSection}_${ev.weekIndex}`;
            if (!uniqueMap.has(key)) uniqueMap.set(key, ev);
        });

        const groupMap = new Map();
        Array.from(uniqueMap.values()).forEach(ev => {
            const groupKey = `${ev.name}|${ev.teacher}|${ev.position}|${ev.day}|${ev.startSection}|${ev.endSection}`;
            if (!groupMap.has(groupKey)) {
                groupMap.set(groupKey, {
                    name: ev.name,
                    teacher: ev.teacher,
                    position: ev.position,
                    day: ev.day,
                    startSection: ev.startSection,
                    endSection: ev.endSection,
                    weeksSet: new Set()
                });
            }
            if (ev.weekIndex > 0 && ev.weekIndex <= 30) {
                groupMap.get(groupKey).weeksSet.add(ev.weekIndex);
            }
        });

        const resultCourses = [];
        groupMap.forEach(group => {
            const sortedWeeks = Array.from(group.weeksSet).sort((a, b) => a - b);
            if (sortedWeeks.length === 0) {
                for (let w = 1; w <= 16; w++) sortedWeeks.push(w);
            }

            const sections = [];
            for (let s = group.startSection; s <= group.endSection; s++) sections.push(s);

            resultCourses.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: group.startSection,
                endSection: group.endSection,
                sections: sections,
                weeks: sortedWeeks
            });
        });

        return resultCourses;
    }

    function parseUniAppDOM() {
        const courses = [];
        try {
            const elements = document.querySelectorAll(".uni-card, .schedule-card, .course-item, .lesson-item, .grid-item, tr, td");
            elements.forEach(el => {
                const text = el.innerText || el.textContent || "";
                if (!text || text.length < 5 || text.length > 200) return;

                const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                if (lines.length >= 2) {
                    const name = lines[0];
                    if (name.includes("星期") || name.includes("节次") || name.includes("学期")) return;

                    let place = "教学楼";
                    let teacher = "";
                    lines.slice(1).forEach(l => {
                        if (l.includes("楼") || l.includes("室") || l.includes("-")) place = l;
                        else if (l.length <= 5 && !l.includes("周") && !l.includes(":")) teacher = l;
                    });

                    courses.push({
                        name: cleanString(name),
                        teacher: cleanString(teacher),
                        position: cleanString(place),
                        day: 1,
                        startSection: 1,
                        endSection: 2,
                        sections: [1, 2],
                        weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
                    });
                }
            });
        } catch (e) {}
        return courses.length > 0 ? courses : null;
    }

    async function saveToShiguangApp(courses) {
        const allWeeks = courses.flatMap(c => c.weeks || []);
        const maxWeek = allWeeks.length > 0 ? Math.max(...allWeeks) : 20;

        const config = {
            semesterTotalWeeks: Math.max(maxWeek, 18),
            firstDayOfWeek: 1,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(ZZU_TIME_SLOTS));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
            return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        }

        return true;
    }

    async function runMicroserviceFallback() {
        toast("正在尝试微服务排课接口拉取...");
        const tokenList = scanTokens();
        const months = getSemesterMonths();
        let validMonthData = [];

        const tokensToTry = tokenList.length > 0 ? tokenList : [""];
        for (const t of tokensToTry) {
            const fetchPromises = months.map(m => fetchOneMonthSchedule(m, t));
            const results = (await Promise.all(fetchPromises)).filter(Boolean);
            if (results.length > 0) {
                validMonthData = results;
                break;
            }
        }

        let courses = [];
        if (validMonthData.length > 0) {
            courses = aggregateEventsToCourses(validMonthData);
        }

        if (courses.length === 0) {
            const domCourses = parseUniAppDOM();
            if (domCourses && domCourses.length > 0) {
                courses = domCourses;
            }
        }

        if (courses.length === 0) {
            return false;
        }

        const ok = await saveToShiguangApp(courses);
        if (!ok) {
            toast("保存课表失败，请稍后重试");
            return true;
        }

        toast(`导入成功！共解析 ${courses.length} 门课程。提示：在设置开学日期后，课表才会正常显示！`);
        if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
            window.shiguangBridge.notifyTaskCompletion();
        }
        return true;
    }

    // ──────────────────────────────────────────────────────────
    // 主执行入口
    // ──────────────────────────────────────────────────────────

    async function runZzuImport() {
        try {
            const currentUrl = window.location.href;

            if (currentUrl.includes("cas.s.zzu.edu.cn/cas/login") && !currentUrl.includes("ticket=")) {
                const hasPassword = !!document.querySelector("input[type='password']");
                if (hasPassword) {
                    toast("请先输入账号密码与短信验证码登录统一身份认证");
                    return;
                }
            }

            toast("正在探测郑大教务系统参数...");
            const jwxtSuccess = await runNewJwxtFlow();

            if (!jwxtSuccess) {
                const fallbackOk = await runMicroserviceFallback();
                if (!fallbackOk) {
                    await alertUser(
                        "未获取到课表数据",
                        "请确认已成功登录郑大新一代智慧教务系统或信息门户。"
                    );
                }
            }
        } catch (error) {
            console.error("[ZZU 导入异常]", error);
            await alertUser("导入异常", error && error.message ? error.message : String(error));
        }
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            ZZU_TIME_SLOTS,
            cleanString,
            calculateTotalWeeks,
            fetchSemesters,
            fetchSemesterMetadata,
            fetchAndParseNewJwxtCourses,
            runNewJwxtFlow,
            scanTokens,
            calculateSectionCount,
            mapTimeToSection,
            aggregateEventsToCourses,
            runZzuImport
        };
    } else {
        runZzuImport();
    }
})();

