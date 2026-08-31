// 郑州大学 (ZZU) 拾光课程表适配脚本
// 适用平台：郑州大学树维 EAMS 微服务教务系统 (jwxt.zzu.edu.cn)
// 包含全域 Token 提取、日历排课流自动抓取、周次与节次聚合算法及 12 节标准作息同步

(function () {
    const CAS_JWXT_REDIRECT = "https://cas.s.zzu.edu.cn/cas/login?service=https%3A%2F%2Fjwxt.zzu.edu.cn%2F";
    const API_BASE = "https://jwxt.zzu.edu.cn/eams-door/api/v1";

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
            console.log("[ZZU Adapter Toast]", message);
        }
    }

    async function alertUser(title, message) {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    function normalizeText(text) {
        return String(text || "")
            .replace(/\u00a0/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function cleanString(str) {
        const s = normalizeText(str);
        if (!s || s === "null" || s === "undefined" || s === "none" || s === "无" || s === "空") {
            return "";
        }
        return s;
    }

    /**
     * 深度扫描获取当前会话中的 JWT / UserToken
     */
    function extractUserToken() {
        try {
            // 1. 扫描 localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const v = localStorage.getItem(k) || "";
                if (["token", "userToken", "idToken", "X-Id-Token", "access_token", "jwt"].includes(k)) {
                    if (v && v.length > 20) return v;
                }
                if (v.startsWith("ey") && v.length > 50) return v;
            }
            // 2. 扫描 sessionStorage
            for (let j = 0; j < sessionStorage.length; j++) {
                const sk = sessionStorage.key(j);
                const sv = sessionStorage.getItem(sk) || "";
                if (["token", "userToken", "idToken", "X-Id-Token", "access_token", "jwt"].includes(sk)) {
                    if (sv && sv.length > 20) return sv;
                }
                if (sv.startsWith("ey") && sv.length > 50) return sv;
            }
            // 3. 扫描 Cookie
            const match = document.cookie.match(/(?:token|userToken|idToken|X-Id-Token|access_token)=([^;]+)/i);
            if (match) return decodeURIComponent(match[1]);
        } catch (e) {
            console.warn("[ZZU Adapter] extractUserToken error:", e);
        }
        return "";
    }

    /**
     * 将开始时间映射为郑大标准第 1~12 节
     */
    function mapTimeToSection(timeStr) {
        if (!timeStr) return 1;
        const clean = parseInt(timeStr.replace(/[^0-9]/g, ""), 10) || 800;
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

    /**
     * 计算单次课程所占节数 (如 2 节连上)
     */
    function calculateSectionCount(startTime, endTime) {
        if (!startTime || !endTime) return 2;
        const s = parseInt(startTime.replace(/[^0-9]/g, ""), 10) || 800;
        const e = parseInt(endTime.replace(/[^0-9]/g, ""), 10) || 940;
        const sMin = Math.floor(s / 100) * 60 + (s % 100);
        const eMin = Math.floor(e / 100) * 60 + (e % 100);
        const diff = eMin - sMin;
        if (diff <= 60) return 1;
        if (diff <= 120) return 2;
        if (diff <= 180) return 3;
        return 4;
    }

    /**
     * 生成当前学期需要查询的 6 个月时间跨度 (例如 2026-08 ~ 2027-01)
     */
    function getSemesterMonths() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1; // 1~12
        const months = [];

        let startYear = year;
        let startMonth = 8; // 秋季学期默认 8 月开始
        if (month >= 2 && month <= 7) {
            // 春季学期默认 2 月开始
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
     * 从郑大微服务接口拉取月度排课日历流 (支持双网关与 Token 注入)
     */
    async function fetchJwxtMonthSchedule(monthStr, userToken) {
        const candidateUrls = [
            `${API_BASE}/protal-schedule/getSchedules?date=${monthStr}`,
            `/eams-door/api/v1/protal-schedule/getSchedules?date=${monthStr}`,
            `https://info.s.zzu.edu.cn/portal-api/v1/protal-schedule/getSchedules?date=${monthStr}`
        ];

        const headers = {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "X-Device-Info": "Android",
            "X-Terminal-Info": "app"
        };
        if (userToken) {
            headers["Authorization"] = userToken.startsWith("Bearer ") ? userToken : `Bearer ${userToken}`;
            headers["token"] = userToken;
            headers["X-Id-Token"] = userToken;
        }

        for (const url of candidateUrls) {
            try {
                const res = await fetch(url, {
                    method: "GET",
                    credentials: "include",
                    headers: headers
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && (data.data || Object.keys(data).some(k => /^\d{4}-\d{2}-\d{2}$/.test(k)))) {
                        return data;
                    }
                }
            } catch (e) {
                // Ignore and try next endpoint
            }
        }
        return null;
    }

    /**
     * 解析 EAMS 日历流 JSON 并聚合为标准学期课程
     */
    function parseAndAggregateRawEvents(allMonthData) {
        const rawEvents = [];

        allMonthData.forEach(root => {
            if (!root || typeof root !== "object") return;
            const dataObj = root.data && typeof root.data === "object" ? root.data : root;

            Object.keys(dataObj).forEach(dateKey => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
                const arr = dataObj[dateKey];
                if (!Array.isArray(arr)) return;

                const dateObj = new Date(dateKey + "T00:00:00");
                let dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 0) dayOfWeek = 7; // 周日为 7

                arr.forEach(item => {
                    if (!item || typeof item !== "object") return;

                    let name = cleanString(item.context || item.courseName || item.kcmc || item.name || "");
                    if (!name) return;

                    let place = cleanString(item.place || item.classroom || item.cdmc || item.roomName || "");
                    if (!place) place = "教学楼";

                    let teacher = cleanString(item.teacher || item.teacherName || item.jsxm || item.js || "");
                    
                    // 课程名清洗与教师提取 (如 "数据结构与算法 (张教授)")
                    const m = name.match(/^(.*?)[(（]([^\d()（）\s]{2,6})[)）]$/);
                    if (m) {
                        name = m[1].trim();
                        if (!teacher) {
                            teacher = m[2].trim();
                        }
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

        // 1. 去重完全重复事件
        const uniqueMap = new Map();
        rawEvents.forEach(ev => {
            const key = `${ev.dateKey}_${ev.name}_${ev.teacher}_${ev.position}_${ev.day}_${ev.startSection}_${ev.weekIndex}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, ev);
            }
        });
        const distinctEvents = Array.from(uniqueMap.values());

        // 2. 按 课程名 + 教师 + 地点 + 星期 + 节次 聚合周次列表
        const groupMap = new Map();
        distinctEvents.forEach(ev => {
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

        // 3. 构建拾光标准课程对象列表
        const resultCourses = [];
        groupMap.forEach(group => {
            const sortedWeeks = Array.from(group.weeksSet).sort((a, b) => a - b);
            if (sortedWeeks.length === 0) {
                for (let w = 1; w <= 16; w++) sortedWeeks.push(w);
            }

            const sections = [];
            for (let s = group.startSection; s <= group.endSection; s++) {
                sections.push(s);
            }

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

        console.log("[ZZU Adapter] Output Courses:", JSON.stringify(courses, null, 2));
        return true;
    }

    /**
     * 执行导入主流程
     */
    async function runZzuImport() {
        try {
            const currentHref = window.location.href;
            console.log("[ZZU Adapter] 当前页面地址:", currentHref);

            // 1. 如果还在 CAS 登录页，提示用户先登录
            if (currentHref.includes("cas.s.zzu.edu.cn/cas/login") && !currentHref.includes("ticket=")) {
                const isLoginForm = !!document.querySelector("input[type='password']");
                if (isLoginForm) {
                    toast("请先在网页中输入账号密码登录统一身份认证");
                    return;
                }
            }

            toast("正在提取凭据并拉取郑大全学期排课流...");

            // 2. 提取用户 Token
            const token = extractUserToken();
            console.log("[ZZU Adapter] 提取到 Token 状态:", !!token);

            // 3. 并发拉取 6 个月日历排课
            const months = getSemesterMonths();
            const fetchPromises = months.map(m => fetchJwxtMonthSchedule(m, token));
            const monthResults = await Promise.all(fetchPromises);

            const validResults = monthResults.filter(Boolean);
            let courses = [];

            if (validResults.length > 0) {
                courses = parseAndAggregateRawEvents(validResults);
            }

            // 4. 若接口抓取为空且当前在门户页，自动引导跳转到教务主站获取 SSO Ticket
            if (courses.length === 0) {
                if (currentHref.includes("info.s.zzu.edu.cn") || currentHref.includes("cas.s.zzu.edu.cn")) {
                    toast("正在自动跳转到教务主站同步凭证...");
                    window.location.href = CAS_JWXT_REDIRECT;
                    return;
                }

                await alertUser(
                    "未获取到课表数据",
                    "请确认已成功登录并进入了郑州大学教务系统 (jwxt.zzu.edu.cn)。如果仍在门户页面，请点击页面内的【教务系统】图标进入后，再次点击【执行导入】。"
                );
                return;
            }

            const saved = await saveToShiguangApp(courses);
            if (!saved) {
                toast("保存课表失败，请稍后重试");
                return;
            }

            toast(`🎉 导入成功！共解析 ${courses.length} 门课程，已同步郑大 12 节作息时间`);
            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            console.error("[ZZU Adapter Error]", error);
            await alertUser("导入异常", error && error.message ? error.message : String(error));
        }
    }

    // 暴露核心解析方法供测试环境调用
    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            ZZU_TIME_SLOTS,
            mapTimeToSection,
            calculateSectionCount,
            parseAndAggregateRawEvents
        };
    } else {
        runZzuImport();
    }
})();
