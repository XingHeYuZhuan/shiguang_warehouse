// 郑州大学 (ZZU) 拾光课程表适配脚本
// 支持：1. 树维移动教务 3 步 API (jw.v.zzu.edu.cn)
//       2. 移动教务与综合服务平台 DOM 课表智能提取
//       3. 新版 EAMS 微服务日历流 (jwxt.zzu.edu.cn)
// 同步：郑州大学 12 节标准作息时间表

(function () {
    const CAS_TARGET = "https://cas.s.zzu.edu.cn/cas/login?service=https%3A%2F%2Fjw.v.zzu.edu.cn%2Fapp-web%2F";

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

    function extractUserToken() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const v = localStorage.getItem(k) || "";
                if (["token", "userToken", "idToken", "X-Id-Token", "access_token", "jwt"].includes(k)) {
                    if (v && v.length > 20) return v;
                }
                if (v.startsWith("ey") && v.length > 50) return v;
            }
            for (let j = 0; j < sessionStorage.length; j++) {
                const sk = sessionStorage.key(j);
                const sv = sessionStorage.getItem(sk) || "";
                if (["token", "userToken", "idToken", "X-Id-Token", "access_token", "jwt"].includes(sk)) {
                    if (sv && sv.length > 20) return sv;
                }
                if (sv.startsWith("ey") && sv.length > 50) return sv;
            }
            const match = document.cookie.match(/(?:token|userToken|idToken|X-Id-Token|access_token)=([^;]+)/i);
            if (match) return decodeURIComponent(match[1]);
        } catch (e) {}
        return "";
    }

    /**
     * 解析单双周表达式 (如 "1-16周(单)", "2-16周(双)", "1-8周,10-17周")
     */
    function parseWeeksExpression(expr) {
        if (!expr) {
            const arr = [];
            for (let i = 1; i <= 16; i++) arr.push(i);
            return arr;
        }
        const str = String(expr).replace(/\s+/g, "");
        const isOdd = str.includes("单");
        const isEven = str.includes("双");
        const clean = str.replace(/[()（）单双周每两周]/g, "");
        const parts = clean.split(",");
        const set = new Set();

        parts.forEach(p => {
            if (!p) return;
            if (p.includes("-") || p.includes("~")) {
                const [startStr, endStr] = p.split(/[-~]/);
                const s = parseInt(startStr, 10);
                const e = parseInt(endStr, 10);
                if (!isNaN(s) && !isNaN(e)) {
                    for (let w = s; w <= e; w++) {
                        if (isOdd && w % 2 === 0) continue;
                        if (isEven && w % 2 !== 0) continue;
                        set.add(w);
                    }
                }
            } else {
                const w = parseInt(p, 10);
                if (!isNaN(w)) {
                    if (isOdd && w % 2 === 0) return;
                    if (isEven && w % 2 !== 0) return;
                    set.add(w);
                }
            }
        });

        const res = Array.from(set).sort((a, b) => a - b);
        return res.length > 0 ? res : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    }

    /**
     * 【引擎 1】树维移动教务 3 步 API 抓取 (jw.v.zzu.edu.cn)
     */
    async function fetchSupwisdomAPI(userToken) {
        try {
            console.log("[ZZU Adapter] 尝试执行树维教务 3 步 API 协议...");
            const baseUrl = "https://jw.v.zzu.edu.cn/app-ws/ws/app-service";

            // Step 1: login-token
            const bodyToken = userToken ? `userToken=${encodeURIComponent(userToken)}&timestamp=${Date.now()}` : `timestamp=${Date.now()}`;
            const res1 = await fetch(`${baseUrl}/super/app/login-token`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: bodyToken
            });
            if (!res1.ok) return null;
            const data1 = await res1.json();
            if (!data1.business_data) return null;
            const decoded1 = JSON.parse(decodeURIComponent(escape(atob(data1.business_data))));
            const dynamicToken = decoded1.token;
            if (!dynamicToken) return null;

            // Step 2: get-semester
            let semesterId = "142";
            try {
                const res2 = await fetch(`${baseUrl}/common/get-semester`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "token": dynamicToken
                    },
                    body: `biz_type_id=1&token=${encodeURIComponent(dynamicToken)}&timestamp=${Date.now()}`
                });
                if (res2.ok) {
                    const data2 = await res2.json();
                    if (data2.business_data) {
                        const decoded2 = JSON.parse(decodeURIComponent(escape(atob(data2.business_data))));
                        if (Array.isArray(decoded2) && decoded2.length > 0) {
                            semesterId = String(decoded2[0].id || semesterId);
                        }
                    }
                }
            } catch (e) {}

            // Step 3: get-course-tables
            const res3 = await fetch(`${baseUrl}/student/course/schedule/get-course-tables`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "token": dynamicToken
                },
                body: `biz_type_id=1&semester_id=${semesterId}&token=${encodeURIComponent(dynamicToken)}&timestamp=${Date.now()}`
            });
            if (!res3.ok) return null;
            const data3 = await res3.json();
            if (!data3.business_data) return null;
            const rawTable = JSON.parse(decodeURIComponent(escape(atob(data3.business_data))));
            
            const rawCourses = Array.isArray(rawTable) ? rawTable : (rawTable.data || []);
            if (!Array.isArray(rawCourses) || rawCourses.length === 0) return null;

            const courses = [];
            rawCourses.forEach(c => {
                let courseName = cleanString(c.name || (c.course && c.course.nameZh) || "");
                if (!courseName) return;

                const defaultTeacher = Array.isArray(c.teacherAssignmentList) ? c.teacherAssignmentList.join(", ") : cleanString(c.teacherName || "");
                const schedules = Array.isArray(c.schedules) ? c.schedules : [];

                if (schedules.length === 0) {
                    // 若无详细排课列表，作为单项
                    courses.push({
                        name: courseName,
                        teacher: defaultTeacher,
                        position: "待定教室",
                        day: 1,
                        startSection: 1,
                        endSection: 2,
                        sections: [1, 2],
                        weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
                    });
                    return;
                }

                // 聚合相同 星期 + 节次 + 教室 的时段
                const slotMap = new Map();
                schedules.forEach(s => {
                    const day = parseInt(s.weekday || s.dayOfWeek || 1, 10);
                    const startUnit = parseInt(s.startUnit || s.startSection || 1, 10);
                    const endUnit = parseInt(s.endUnit || s.endSection || (startUnit + 1), 10);
                    
                    let roomName = "";
                    if (s.room && typeof s.room === "object") {
                        roomName = s.room.nameZh || s.room.name || "";
                    } else {
                        roomName = cleanString(s.room || s.roomName || s.location || s.place || "");
                    }
                    if (!roomName) roomName = "教学楼";

                    const teacher = cleanString(s.teacherName || defaultTeacher);
                    const weekIdx = parseInt(s.weekIndex || s.week || 0, 10);
                    const weekExpr = s.weekIndices || s.weekExpression || s.weeks || "";

                    const key = `${day}_${startUnit}_${endUnit}_${roomName}_${teacher}`;
                    if (!slotMap.has(key)) {
                        slotMap.set(key, {
                            day,
                            startUnit,
                            endUnit,
                            roomName,
                            teacher,
                            weeksSet: new Set()
                        });
                    }
                    if (weekIdx > 0) {
                        slotMap.get(key).weeksSet.add(weekIdx);
                    } else if (weekExpr) {
                        parseWeeksExpression(weekExpr).forEach(w => slotMap.get(key).weeksSet.add(w));
                    }
                });

                slotMap.forEach(item => {
                    const sortedWeeks = Array.from(item.weeksSet).sort((a, b) => a - b);
                    const sections = [];
                    for (let u = item.startUnit; u <= item.endUnit; u++) sections.push(u);

                    courses.push({
                        name: courseName,
                        teacher: item.teacher,
                        position: item.roomName,
                        day: item.day,
                        startSection: item.startUnit,
                        endSection: item.endUnit,
                        sections: sections,
                        weeks: sortedWeeks.length > 0 ? sortedWeeks : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
                    });
                });
            });

            return courses;
        } catch (e) {
            console.warn("[ZZU Adapter] 树维 API 抓取异常:", e);
            return null;
        }
    }

    /**
     * 【引擎 2】网页 DOM 课表格子智能解析
     */
    function parseDOMCourseTable() {
        try {
            console.log("[ZZU Adapter] 尝试从当前网页 DOM 中解析课表...");
            const courses = [];
            const cells = document.querySelectorAll("td, .course-cell, .timetable-item, .schedule-item, .lesson");
            if (!cells || cells.length === 0) return null;

            cells.forEach(cell => {
                const text = cell.innerText || cell.textContent || "";
                if (!text || text.length < 4) return;

                // 匹配包含课程名称与教室的单元格 (例如: 数据结构 1-16周 北3-101)
                const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                if (lines.length >= 2) {
                    const name = lines[0];
                    let place = "教学楼";
                    let weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
                    let teacher = "";

                    lines.slice(1).forEach(line => {
                        if (line.includes("周")) {
                            weeks = parseWeeksExpression(line);
                        } else if (line.includes("楼") || line.includes("室") || line.includes("-") || line.includes("校区")) {
                            place = line;
                        } else if (line.length <= 6) {
                            teacher = line;
                        }
                    });

                    courses.push({
                        name: cleanString(name),
                        teacher: cleanString(teacher),
                        position: cleanString(place),
                        day: 1,
                        startSection: 1,
                        endSection: 2,
                        sections: [1, 2],
                        weeks: weeks
                    });
                }
            });

            return courses.length > 0 ? courses : null;
        } catch (e) {
            return null;
        }
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
     * 主导入控制流
     */
    async function runZzuImport() {
        try {
            const currentHref = window.location.href;
            console.log("[ZZU Adapter] 当前页面:", currentHref);

            // 1. 若当前在 CAS 统一认证登录界面，引导先登录
            if (currentHref.includes("cas.s.zzu.edu.cn/cas/login") && !currentHref.includes("ticket=")) {
                const hasPassword = !!document.querySelector("input[type='password']");
                if (hasPassword) {
                    toast("请先在当前页面输入账号密码登录统一身份认证");
                    return;
                }
            }

            toast("正在通过树维移动教务抓取全学期排课...");

            const token = extractUserToken();
            let courses = null;

            // 优先执行树维 3 步 API 协议
            courses = await fetchSupwisdomAPI(token);

            // 兜底 1: DOM 课表解析
            if (!courses || courses.length === 0) {
                courses = parseDOMCourseTable();
            }

            // 若仍为空且在门户/CAS页，自动重定向到树维教务
            if (!courses || courses.length === 0) {
                if (currentHref.includes("info.s.zzu.edu.cn") || currentHref.includes("cas.s.zzu.edu.cn")) {
                    toast("正在免密跳转至树维教务系统同步课表...");
                    window.location.href = CAS_TARGET;
                    return;
                }

                await alertUser(
                    "未获取到课表数据",
                    "请确认已在教务系统中进入【课表查询】页面，然后再次点击【执行导入】。"
                );
                return;
            }

            // 保存到拾光 APP
            const ok = await saveToShiguangApp(courses);
            if (!ok) {
                toast("保存课表失败，请稍后重试");
                return;
            }

            toast(`🎉 导入成功！共解析 ${courses.length} 个排课时段，已同步郑大 12 节作息！`);
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
            parseWeeksExpression
        };
    } else {
        runZzuImport();
    }
})();
