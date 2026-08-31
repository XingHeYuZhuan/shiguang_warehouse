// 郑州大学 (ZZU) 拾光课程表适配脚本
// 适配树维新一代智慧教务系统（jwxt.zzu.edu.cn）

(function () {
    const JWXT_BASE_URLS = [
        "https://jwxt.zzu.edu.cn",
        ""
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
                await alertUser(
                    "未获取到课表数据",
                    "请确认已成功登录郑大智慧教务系统并在课表页面点击导入。"
                );
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
            runZzuImport
        };
    } else {
        runZzuImport();
    }
})();
