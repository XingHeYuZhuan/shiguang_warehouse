// 郑州大学 (ZZU) 拾光课程表官方适配脚本
// 适用平台：郑州大学移动综合服务门户 (info.s.zzu.edu.cn / jwxt.zzu.edu.cn)
// 特性：深度 JWT 凭证扫描 + 全学期日历排课流智能聚合 + 郑大 12 节标准作息时间同步

(function () {
    const API_BASES = [
        "https://jwxt.zzu.edu.cn/eams-door/api/v1",
        "https://info.s.zzu.edu.cn/portal-api/v1",
        "https://info.s.zzu.edu.cn/eams-door/api/v1",
        "/eams-door/api/v1",
        "/portal-api/v1"
    ];

    // 郑州大学标准 12 节作息时间表 (冬季/常规作息)
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

    /**
     * 深度扫描获取当前会话中的 JWT / UserToken 列表 (含 Vuex/Pinia 嵌套解析)
     */
    function deepScanTokens() {
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
            // 1. 扫描 localStorage 全部字段
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                scanValue(localStorage.getItem(k));
            }
            // 2. 扫描 sessionStorage 全部字段
            for (let j = 0; j < sessionStorage.length; j++) {
                const sk = sessionStorage.key(j);
                scanValue(sessionStorage.getItem(sk));
            }
            // 3. 扫描 document.cookie
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

    /**
     * 并发拉取单个月度日历排课
     */
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

    /**
     * 聚合日历事件为学期标准排课
     */
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

        // 1. 去重完全相同事件
        const uniqueMap = new Map();
        rawEvents.forEach(ev => {
            const key = `${ev.dateKey}_${ev.name}_${ev.teacher}_${ev.position}_${ev.day}_${ev.startSection}_${ev.weekIndex}`;
            if (!uniqueMap.has(key)) uniqueMap.set(key, ev);
        });

        // 2. 聚合成周次区间
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

        // 3. 构建课程输出
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

    /**
     * DOM 页面智能扫描提取 (Uni-app H5 课表视图)
     */
    function parseUniAppDOM() {
        const courses = [];
        try {
            // 扫描常见 Uni-App 课程卡片与格子
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

    /**
     * 保存数据至拾光课表 APP
     */
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

        console.log("[ZZU Adapter] Courses Output:", courses);
        return true;
    }

    /**
     * 核心导入执行流
     */
    async function runZzuImport() {
        try {
            const currentUrl = window.location.href;
            console.log("[ZZU Adapter] 当前 URL:", currentUrl);

            // 1. CAS 登录页面拦截
            if (currentUrl.includes("cas.s.zzu.edu.cn/cas/login") && !currentUrl.includes("ticket=")) {
                const hasPassword = !!document.querySelector("input[type='password']");
                if (hasPassword) {
                    toast("请先在当前页面输入账号密码完成统一身份认证登录");
                    return;
                }
            }

            toast("正在深度提取鉴权凭证并拉取全学期课表...");

            // 2. 深度提取 Token
            const tokenList = deepScanTokens();
            console.log(`[ZZU Adapter] 扫描到 ${tokenList.length} 个候选凭证`);

            const months = getSemesterMonths();
            let validMonthData = [];

            // 3. 遍历候选 Token 并发请求月度排课日历流
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

            // 4. DOM 提取兜底
            if (courses.length === 0) {
                const domCourses = parseUniAppDOM();
                if (domCourses && domCourses.length > 0) {
                    courses = domCourses;
                }
            }

            // 5. 若均未获取到，弹窗提示用户进入【课表】模块
            if (courses.length === 0) {
                await alertUser(
                    "未获取到课表数据",
                    "请确认已成功登录郑大移动门户。\n\n提示：如果刚登录完成，请先在底部导航栏点击【课表】（或点击首页【今日课表/课表查询】），待课表页面加载完成后，再次点击右下角【执行导入】。"
                );
                return;
            }

            // 6. 保存至拾光
            const ok = await saveToShiguangApp(courses);
            if (!ok) {
                toast("保存课表失败，请稍后重试");
                return;
            }

            toast(`🎉 导入成功！共解析 ${courses.length} 门课程，已同步郑大 12 节标准作息！`);
            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            console.error("[ZZU Adapter Error]", error);
            await alertUser("导入异常", error && error.message ? error.message : String(error));
        }
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            ZZU_TIME_SLOTS,
            deepScanTokens,
            calculateSectionCount,
            mapTimeToSection,
            aggregateEventsToCourses
        };
    } else {
        runZzuImport();
    }
})();
